import type { AgentModelAliases, AgentModelTier } from '../config/types.js';
import type { ToolRegistry } from '../tool/registry.js';
import { AgentDefinitionLoader, type AgentDefinitionLoaderOptions } from './loader.js';
import type {
  AgentDefinition,
  AgentDefinitionDiagnostic,
  AgentDefinitionSnapshot,
} from './types.js';

export interface AgentDefinitionManagerOptions extends AgentDefinitionLoaderOptions {
  modelAliases?: AgentModelAliases;
  providerNames?: readonly string[];
  deniedTools?: ReadonlySet<string>;
  watchIntervalMs?: number;
}

type Listener = (snapshot: AgentDefinitionSnapshot) => void;

function emptySnapshot(): AgentDefinitionSnapshot {
  return { revision: 0, definitions: new Map(), disabledNames: new Set(), diagnostics: [] };
}

export class AgentDefinitionManager {
  private readonly loader: AgentDefinitionLoader;
  private readonly aliases: AgentModelAliases;
  private readonly providerNames: ReadonlySet<string>;
  private readonly deniedTools: ReadonlySet<string>;
  private readonly watchIntervalMs: number;
  private snapshot = emptySnapshot();
  private fingerprint = '';
  private watcher?: NodeJS.Timeout;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly registry: ToolRegistry,
    rootDir: string,
    options: AgentDefinitionManagerOptions = {},
  ) {
    this.loader = new AgentDefinitionLoader(rootDir, options);
    this.aliases = { ...options.modelAliases };
    this.providerNames = new Set(options.providerNames ?? []);
    this.deniedTools = new Set(options.deniedTools ?? []);
    this.watchIntervalMs = Math.max(100, options.watchIntervalMs ?? 750);
  }

  initialize(): AgentDefinitionSnapshot {
    this.publish(this.prepare());
    this.fingerprint = this.loader.fingerprint();
    return this.getSnapshot();
  }

  reload(): AgentDefinitionSnapshot {
    this.publish(this.prepare());
    this.fingerprint = this.loader.fingerprint();
    return this.getSnapshot();
  }

  get(name: string): AgentDefinition | undefined {
    return this.snapshot.definitions.get(name.trim().toLowerCase());
  }

  getSnapshot(): AgentDefinitionSnapshot {
    return {
      revision: this.snapshot.revision,
      definitions: new Map(this.snapshot.definitions),
      disabledNames: new Set(this.snapshot.disabledNames),
      diagnostics: this.snapshot.diagnostics.map(item => ({ ...item })),
    };
  }

  resolveProviderName(definition: AgentDefinition): string | undefined {
    if (definition.model === 'inherit') return undefined;
    return this.aliases[definition.model];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  startWatching(): void {
    if (this.watcher) return;
    this.fingerprint = this.loader.fingerprint();
    this.watcher = setInterval(() => {
      const next = this.loader.fingerprint();
      if (next === this.fingerprint) return;
      this.reload();
    }, this.watchIntervalMs);
    this.watcher.unref();
  }

  close(): Promise<void> {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = undefined;
    this.listeners.clear();
    return Promise.resolve();
  }

  private prepare(): AgentDefinitionSnapshot {
    const loaded = this.loader.load();
    const definitions = new Map(loaded.definitions);
    const disabledNames = new Set(loaded.disabledNames);
    const diagnostics = [...loaded.diagnostics];
    const knownTools = new Set(this.registry.names());
    for (const [name, definition] of definitions) {
      const error = this.validateDefinition(definition, knownTools);
      if (!error) continue;
      definitions.delete(name);
      disabledNames.add(name);
      diagnostics.push(error);
    }
    return {
      revision: this.snapshot.revision + 1,
      definitions,
      disabledNames,
      diagnostics,
    };
  }

  private validateDefinition(
    definition: AgentDefinition,
    knownTools: ReadonlySet<string>,
  ): AgentDefinitionDiagnostic | undefined {
    for (const tool of [
      ...(definition.tools ?? []),
      ...definition.disallowedTools,
      ...definition.backgroundTools,
    ]) {
      if (this.deniedTools.has(tool)) {
        return this.diagnostic(definition, 'FORBIDDEN_TOOL', `Agent ${definition.name} 引用禁用工具: ${tool}`);
      }
      if (!knownTools.has(tool)) {
        return this.diagnostic(definition, 'UNKNOWN_TOOL', `Agent ${definition.name} 引用不存在工具: ${tool}`);
      }
    }
    if (definition.model !== 'inherit') {
      const providerName = this.aliases[definition.model as AgentModelTier];
      if (!providerName || !this.providerNames.has(providerName)) {
        return this.diagnostic(
          definition,
          'UNKNOWN_MODEL_ALIAS',
          `Agent ${definition.name} 的模型档位 ${definition.model} 未映射到可用 Provider`,
        );
      }
    }
    return undefined;
  }

  private diagnostic(
    definition: AgentDefinition,
    code: AgentDefinitionDiagnostic['code'],
    message: string,
  ): AgentDefinitionDiagnostic {
    return {
      scope: definition.scope,
      file: definition.entryPath,
      name: definition.name,
      code,
      message,
    };
  }

  private publish(snapshot: AgentDefinitionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      try {
        listener(this.getSnapshot());
      } catch {}
    }
  }
}
