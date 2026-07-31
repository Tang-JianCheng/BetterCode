import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type { SupplementalPromptContent } from '../prompt/types.js';
import { ToolRegistry } from '../tool/registry.js';
import type { Tool } from '../tool/types.js';
import { LoadSkillTool, LOAD_SKILL_TOOL_NAME } from './load-tool.js';
import { SkillLoader, type SkillLoaderOptions } from './loader.js';
import { renderSkillBody } from './parser.js';
import type {
  ActiveSkill,
  LoadedSkills,
  SkillDefinition,
  SkillDiagnostic,
  SkillExecutionScope,
  SkillLoadResolution,
  SkillMetadata,
  SkillSnapshot,
  SkillVisibility,
} from './types.js';
import { AGENT_TOOL_NAME } from '../subagent/types.js';

const SKILL_TOOL_OWNER = 'bettercode:skills';

export interface SkillManagerOptions extends SkillLoaderOptions {
  providerNames?: readonly string[];
  reservedCommandNames?: readonly string[];
  watchIntervalMs?: number;
}

export interface SkillReloadResult {
  updated: boolean;
  revision: number;
  error?: string;
}

type Listener = (snapshot: SkillSnapshot) => void;

function emptySnapshot(): SkillSnapshot {
  return {
    revision: 0,
    skills: new Map(),
    disabledNames: new Set(),
    diagnostics: [],
    dedicatedToolNames: new Set(),
  };
}

export class SkillManager {
  private readonly loader: SkillLoader;
  private readonly baseToolNames: ReadonlySet<string>;
  private readonly providerNames: ReadonlySet<string>;
  private readonly reservedCommandNames: ReadonlySet<string>;
  private readonly watchIntervalMs: number;
  private snapshot: SkillSnapshot = emptySnapshot();
  private readonly active = new Map<string, ActiveSkill>();
  private readonly listeners = new Set<Listener>();
  private watcher: NodeJS.Timeout | undefined;
  private fingerprint = '';
  private activationCounter = 0;
  private loadToolRegistered = false;
  private executionDepth = 0;
  private isolationDepth = 0;

  constructor(
    private readonly registry: ToolRegistry,
    rootDir: string,
    options: SkillManagerOptions = {},
  ) {
    this.loader = new SkillLoader(rootDir, options);
    this.baseToolNames = new Set(registry.names());
    this.providerNames = new Set(options.providerNames ?? []);
    this.reservedCommandNames = new Set(
      (options.reservedCommandNames ?? []).map(name => name.trim().toLowerCase()),
    );
    this.watchIntervalMs = Math.max(100, options.watchIntervalMs ?? 750);
  }

  initialize(): SkillSnapshot {
    if (!this.loadToolRegistered) {
      this.registry.register(new LoadSkillTool(this), { system: true });
      this.loadToolRegistered = true;
    }
    const loaded = this.loader.load();
    this.publish(this.prepare(loaded, true));
    this.fingerprint = this.computeFingerprint();
    return this.getSnapshot();
  }

  reload(): SkillReloadResult {
    if (this.executionDepth > 0) {
      return { updated: false, revision: this.snapshot.revision, error: 'Agent 运行期间延后 Skill 热更新' };
    }
    try {
      const loaded = this.loader.load();
      if (loaded.diagnostics.length > 0) {
        throw new Error(loaded.diagnostics.map(item => item.message).join('; '));
      }
      const next = this.prepare(loaded, false);
      this.publish(next);
      this.fingerprint = this.computeFingerprint();
      return { updated: true, revision: this.snapshot.revision };
    } catch (error) {
      return {
        updated: false,
        revision: this.snapshot.revision,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  startWatching(): void {
    if (this.watcher) return;
    this.fingerprint = this.computeFingerprint();
    this.watcher = setInterval(() => {
      const next = this.computeFingerprint();
      if (next === this.fingerprint) return;
      const result = this.reload();
      if (result.updated) this.fingerprint = next;
    }, this.watchIntervalMs);
    this.watcher.unref();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): SkillMetadata[] {
    return [...this.snapshot.skills.values()].map(skill => ({
      name: skill.name,
      description: skill.description,
      tools: [...skill.tools],
      mode: skill.mode,
      history: skill.history,
      ...(skill.model ? { model: skill.model } : {}),
    }));
  }

  get(name: string): SkillDefinition | undefined {
    return this.snapshot.skills.get(name.trim().toLowerCase());
  }

  getSnapshot(): SkillSnapshot {
    return {
      revision: this.snapshot.revision,
      skills: new Map(this.snapshot.skills),
      disabledNames: new Set(this.snapshot.disabledNames),
      diagnostics: this.snapshot.diagnostics.map(item => ({ ...item })),
      dedicatedToolNames: new Set(this.snapshot.dedicatedToolNames),
    };
  }

  getActiveNames(): string[] {
    return [...this.active.keys()];
  }

  activateShared(name: string, args: string): ActiveSkill {
    const skill = this.get(name);
    if (!skill) throw new Error(`Skill 不存在或不可用: ${name}`);
    if (skill.mode !== 'shared') throw new Error(`Skill ${skill.name} 使用独立模式，不能持续激活`);
    const existing = this.active.get(skill.name);
    const active: ActiveSkill = {
      name: skill.name,
      args,
      content: renderSkillBody(skill.body, args),
      tools: [...skill.tools],
      activatedAt: existing?.activatedAt ?? ++this.activationCounter,
    };
    this.active.set(skill.name, active);
    return { ...active, tools: [...active.tools] };
  }

  resolveLoad(name: string, args: string): SkillLoadResolution {
    const skill = this.get(name);
    if (!skill) throw new Error(`Skill 不存在或不可用: ${name}`);
    if (this.isolationDepth > 0) throw new Error('独立 Skill 内不支持继续加载其他 Skill');
    if (skill.mode === 'shared') {
      return { status: 'shared', skill, active: this.activateShared(skill.name, args) };
    }
    return { status: 'isolated', skill, args };
  }

  clearActive(): void {
    this.active.clear();
  }

  beginExecution(): void {
    this.executionDepth += 1;
  }

  endExecution(): void {
    this.executionDepth = Math.max(0, this.executionDepth - 1);
  }

  async withIsolation<T>(run: () => Promise<T>): Promise<T> {
    this.isolationDepth += 1;
    try {
      return await run();
    } finally {
      this.isolationDepth = Math.max(0, this.isolationDepth - 1);
    }
  }

  promptContent(scope?: SkillExecutionScope): Pick<SupplementalPromptContent, 'availableSkills' | 'activeSkills'> {
    const availableSkills = this.list().map(skill => ({
      name: skill.name,
      description: skill.description,
    }));
    if (scope) {
      const skill = this.get(scope.name);
      return {
        availableSkills,
        activeSkills: skill ? [{ name: skill.name, content: renderSkillBody(skill.body, scope.args) }] : [],
      };
    }
    return {
      availableSkills,
      activeSkills: [...this.active.values()]
        .sort((left, right) => left.activatedAt - right.activatedAt)
        .map(skill => ({ name: skill.name, content: skill.content })),
    };
  }

  visibleTools(scope?: SkillExecutionScope): SkillVisibility {
    if (scope) {
      const skill = this.get(scope.name);
      return {
        names: new Set([
          ...(skill?.tools ?? []).filter(name => name !== AGENT_TOOL_NAME),
          LOAD_SKILL_TOOL_NAME,
        ]),
        restricted: true,
      };
    }
    if (this.active.size === 0) {
      return {
        names: new Set([...this.baseToolNames, LOAD_SKILL_TOOL_NAME]),
        restricted: false,
      };
    }
    return {
      names: new Set([
        ...[...this.active.values()].flatMap(skill => [...skill.tools]),
        ...(this.baseToolNames.has(AGENT_TOOL_NAME) ? [AGENT_TOOL_NAME] : []),
        LOAD_SKILL_TOOL_NAME,
      ]),
      restricted: true,
    };
  }

  close(): Promise<void> {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = undefined;
    this.listeners.clear();
    return Promise.resolve();
  }

  private prepare(loaded: LoadedSkills, coldStart: boolean): SkillSnapshot {
    const skills = new Map(loaded.skills);
    const disabledNames = new Set(loaded.disabledNames);
    const diagnostics = [...loaded.diagnostics];
    for (const [name, skill] of skills) {
      if (skill.model && !this.providerNames.has(skill.model)) {
        if (!coldStart) throw new Error(`Skill ${skill.name} 引用不存在 Provider: ${skill.model}`);
        skills.delete(name);
        disabledNames.add(name);
        diagnostics.push(this.diagnostic(skill, 'UNKNOWN_PROVIDER', `未找到 Provider 配置: ${skill.model}`));
      }
    }

    const dedicatedTools: Tool[] = [];
    const dedicatedNames = new Set<string>();
    for (const skill of skills.values()) {
      if (this.reservedCommandNames.has(skill.name)) {
        throw new Error(`Skill 命令与内置命令或别名冲突: ${skill.name}`);
      }
      for (const tool of skill.dedicatedTools) {
        if (this.baseToolNames.has(tool.name) || dedicatedNames.has(tool.name) || tool.name === LOAD_SKILL_TOOL_NAME) {
          throw new Error(`Skill ${skill.name} 的专属工具名称冲突: ${tool.name}`);
        }
        dedicatedNames.add(tool.name);
        dedicatedTools.push(tool);
      }
    }

    const knownTools = new Set([...this.baseToolNames, ...dedicatedNames, LOAD_SKILL_TOOL_NAME]);
    for (const skill of skills.values()) {
      for (const tool of skill.tools) {
        if (!knownTools.has(tool)) {
          const message = `Skill ${skill.name} 的白名单引用不存在工具: ${tool}`;
          if (coldStart) throw new Error(message);
          throw new Error(message);
        }
      }
    }

    this.registry.replaceOwned(SKILL_TOOL_OWNER, dedicatedTools);
    return {
      revision: this.snapshot.revision + 1,
      skills,
      disabledNames,
      diagnostics,
      dedicatedToolNames: dedicatedNames,
    };
  }

  private publish(snapshot: SkillSnapshot): void {
    this.snapshot = snapshot;
    for (const [name, active] of this.active) {
      const skill = snapshot.skills.get(name);
      if (!skill || skill.mode !== 'shared') this.active.delete(name);
      else this.active.set(name, {
        ...active,
        content: renderSkillBody(skill.body, active.args),
        tools: [...skill.tools],
      });
    }
    for (const listener of this.listeners) {
      try {
        listener(this.getSnapshot());
      } catch {}
    }
  }

  private diagnostic(skill: SkillDefinition, code: string, message: string): SkillDiagnostic {
    return { scope: skill.scope, file: skill.entryPath, name: skill.name, code, message };
  }

  private computeFingerprint(): string {
    const values: string[] = [];
    for (const directory of Object.values(this.loader.directories)) {
      if (!existsSync(directory)) {
        values.push(`${directory}:missing`);
        continue;
      }
      const files = fg.sync(['*.md', '*/SKILL.md', '*/tools/*'], {
        cwd: directory,
        absolute: true,
        onlyFiles: true,
      }).sort();
      values.push(`${directory}:${files.map(file => {
        const stat = statSync(file);
        return `${path.relative(directory, file)}:${stat.size}:${stat.mtimeMs}`;
      }).join('|')}`);
    }
    return values.join('\n');
  }
}
