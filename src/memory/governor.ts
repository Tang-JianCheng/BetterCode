import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { MemoryManager, type MemoryFile } from './manager.js';

export interface MemoryGovernanceOptions {
  /** 距上次成功整理的最小间隔，默认 24 小时 */
  minIntervalMs?: number;
  /** 距上次触发尝试的节流，默认 10 分钟 */
  scanThrottleMs?: number;
  /** 会话门：会话存档数达到该值才允许整理，默认 5 */
  minSessionCount?: number;
  /** 治理锁过期时间，默认 30 分钟 */
  lockTimeoutMs?: number;
  /** 一次整理最多交给 LLM 的记忆数（按修改时间倒序），默认 60 */
  maxCandidates?: number;
}

export interface GovernancePlanAction {
  action: 'keep' | 'delete' | 'merge' | 'update';
  /** 被处理记忆的文件名（不含 .md） */
  targets: string[];
  /** merge 的目标文件名（不含 .md） */
  into?: string;
  description?: string;
  /** merge / update 后的新正文 */
  content?: string;
  reason: string;
}

export interface GovernanceState {
  lastGovernedAt?: string;
  lastAttemptAt?: string;
  runCount: number;
  lastError?: string;
}

export interface GovernanceResult {
  ran: boolean;
  reason?: string;
  actions?: readonly GovernancePlanAction[];
  executed: {
    deleted: string[];
    merged: string[];
    updated: string[];
    kept: string[];
  };
  ignored: number;
  archiveCount: number;
  indexOverflow?: { overflow: boolean; droppedNames: string[] };
}

const DEFAULT_OPTIONS: Required<Omit<MemoryGovernanceOptions, never>> = {
  minIntervalMs: 24 * 60 * 60 * 1000,
  scanThrottleMs: 10 * 60 * 1000,
  minSessionCount: 5,
  lockTimeoutMs: 30 * 60 * 1000,
  maxCandidates: 60,
};

const STATE_FILE = '.governance.json';
const LOCK_FILE = '.governance.lock';
const ARCHIVE_DIR = '.archive';
const ARCHIVE_EXTENSION = '.md.bak';

const GOVERNANCE_SYSTEM_PROMPT = `你是 BetterCode 的记忆治理员。请分四个阶段处理给定的记忆清单，最后只输出一个 JSON 对象。

阶段 1 定位：列出每篇记忆（文件名 / 类型 / 描述 / 最后修改时间 / 正文）。
阶段 2 收集信号：识别重复或高度相似的条目（去重合并）、过时或错误或临时的条目（删除）、描述同一主题但内容矛盾的条目（合并协调或保留最新的 update）、无价值的碎片（删除）。
阶段 3 整理：产出操作清单，每条包含 action、targets、reason；需要改动正文的操作带上 content。
阶段 4 修剪索引：确保操作后的条目仍会被 MEMORY.md 收录，标记应删除的条目。

操作规则：
- action 只能是 keep、delete、merge、update。
- targets 必须是给定清单中的文件名（不含 .md 后缀），不得涉及清单之外的路径。
- merge：targets 是全部被合并的旧文件，into 是合并后的新文件名，content 是合并后的完整正文。
- update：targets 是单个文件，content 是覆盖后的新正文，可同时给出 description。
- keep：targets 是保持不变的文件。
- 合并与更新保持原作用域（project/reference 归项目级，user/feedback 归用户级）。
- 每条必须有非空 reason。

只输出 JSON，格式：{"actions":[{"action":"keep|delete|merge|update","targets":["文件名"],"into":"新文件名","description":"描述","content":"正文","reason":"原因"}]}`;

export class MemoryGovernor {
  private readonly options: Required<Omit<MemoryGovernanceOptions, never>>;

  constructor(
    private readonly manager: MemoryManager,
    options: MemoryGovernanceOptions = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 门控入口：满足全部条件才在后台执行整理。任一条件不满足立即返回 ran:false。
   * 顺序：有记忆 → 时间门（24h）→ 扫描节流（10min）→ 会话门（≥5）→ 治理锁。
   */
  async maybeRun(provider: LLMProvider): Promise<GovernanceResult> {
    const memories = this.manager.loadAll();
    if (memories.length === 0) {
      return skipped('no_memory_files');
    }
    const state = this.state();
    const now = Date.now();
    this.saveState({ ...state, lastAttemptAt: new Date(now).toISOString() });
    if (state.lastGovernedAt) {
      const elapsed = now - Date.parse(state.lastGovernedAt);
      if (Number.isFinite(elapsed) && elapsed < this.options.minIntervalMs) {
        return skipped('interval_not_elapsed');
      }
    }
    if (state.lastAttemptAt) {
      const sinceAttempt = now - Date.parse(state.lastAttemptAt);
      if (Number.isFinite(sinceAttempt) && sinceAttempt < this.options.scanThrottleMs) {
        return skipped('scan_throttled');
      }
    }
    if (this.sessionCount() < this.options.minSessionCount) {
      return skipped('insufficient_sessions');
    }
    if (!this.acquireLock(now)) {
      return skipped('lock_busy');
    }
    try {
      return await this.run(provider);
    } finally {
      this.releaseLock();
    }
  }

  /** 跳过门控直接执行整理（仍要求存在记忆）。 */
  async run(provider: LLMProvider): Promise<GovernanceResult> {
    const memories = this.manager.loadAll();
    if (memories.length === 0) {
      return skipped('no_memory_files');
    }
    const byFile = new Map<string, MemoryFile>();
    for (const memory of memories) {
      byFile.set(path.basename(memory.path, '.md'), memory);
    }
    const candidates = [...memories]
      .map(memory => ({ memory, mtimeMs: this.safeMtime(memory.path) }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, this.options.maxCandidates);
    const actions = await this.requestPlan(provider, candidates, byFile);
    if (actions.length === 0) {
      const result: GovernanceResult = {
        ran: true,
        actions: [],
        executed: emptyExecuted(),
        ignored: 0,
        archiveCount: 0,
      };
      this.finalizeState(result);
      return result;
    }
    return this.executePlan(actions, byFile);
  }

  /** 读取持久化治理状态，文件缺失或损坏回退空状态。 */
  state(): GovernanceState {
    const file = path.join(this.manager.projectDir, STATE_FILE);
    try {
      if (!existsSync(file)) return { runCount: 0 };
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<GovernanceState>;
      return {
        ...(typeof parsed.lastGovernedAt === 'string'
          ? { lastGovernedAt: parsed.lastGovernedAt } : {}),
        ...(typeof parsed.lastAttemptAt === 'string'
          ? { lastAttemptAt: parsed.lastAttemptAt } : {}),
        runCount: Number.isInteger(parsed.runCount) && (parsed.runCount ?? 0) > 0
          ? (parsed.runCount ?? 0)
          : 0,
        ...(typeof parsed.lastError === 'string' ? { lastError: parsed.lastError } : {}),
      };
    } catch {
      return { runCount: 0 };
    }
  }

  private saveState(state: GovernanceState): void {
    mkdirSync(this.manager.projectDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(this.manager.projectDir, STATE_FILE),
      JSON.stringify(state, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  private finalizeState(result: GovernanceResult): void {
    const state = this.state();
    this.saveState({
      ...state,
      lastGovernedAt: new Date().toISOString(),
      runCount: state.runCount + 1,
      ...(result.reason ? { lastError: result.reason } : {}),
    });
  }

  private acquireLock(now: number): boolean {
    const lockPath = path.join(this.manager.projectDir, LOCK_FILE);
    mkdirSync(this.manager.projectDir, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, timestamp: now }),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      return true;
    } catch {
      // 锁已存在：判断是否陈旧，陈旧则删除后重试一次。
      try {
        const raw = readFileSync(lockPath, 'utf8');
        const parsed = JSON.parse(raw) as { timestamp?: number };
        const stale = typeof parsed.timestamp === 'number'
          && Number.isFinite(parsed.timestamp)
          && now - parsed.timestamp > this.options.lockTimeoutMs;
        if (!stale) return false;
        rmSync(lockPath, { force: true });
      } catch {
        return false;
      }
      try {
        writeFileSync(
          lockPath,
          JSON.stringify({ pid: process.pid, timestamp: now }),
          { encoding: 'utf8', flag: 'wx', mode: 0o600 },
        );
        return true;
      } catch {
        return false;
      }
    }
  }

  private releaseLock(): void {
    try {
      rmSync(path.join(this.manager.projectDir, LOCK_FILE), { force: true });
    } catch {
      // 锁清理失败不阻塞。
    }
  }

  private sessionCount(): number {
    const dir = path.join(this.manager.workDir, '.bettercode', 'sessions');
    try {
      if (!existsSync(dir)) return 0;
      return readdirSync(dir).filter(name => name.endsWith('.jsonl')).length;
    } catch {
      return 0;
    }
  }

  private safeMtime(file: string): number {
    try {
      const stat = statSync(file);
      return stat.mtimeMs;
    } catch {
      return 0;
    }
  }

  private async requestPlan(
    provider: LLMProvider,
    candidates: readonly { memory: MemoryFile; mtimeMs: number }[],
    byFile: Map<string, MemoryFile>,
  ): Promise<GovernancePlanAction[]> {
    const catalog = candidates.map(({ memory, mtimeMs }) => {
      const filename = path.basename(memory.path, '.md');
      return {
        filename,
        name: memory.name,
        type: memory.type,
        description: memory.description || '无描述',
        mtime: new Date(mtimeMs).toISOString(),
        content: memory.content.slice(0, 5_000),
      };
    });
    const request: ProviderRequest = {
      systemPrompt: GOVERNANCE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify({ memories: catalog }),
      }],
      tools: [],
      maxOutputTokens: 4_096,
    };
    let text = '';
    let valid = true;
    let done = false;
    try {
      await provider.chat(request, (event: StreamEvent) => {
        if (event.type === 'text_delta') text += event.content;
        else if (event.type === 'done') done = true;
        else if (event.type === 'error' || event.type === 'tool_call') valid = false;
      });
      if (!valid || !done) return [];
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return [];
      const parsed = JSON.parse(text.slice(start, end + 1)) as { actions?: unknown };
      if (!Array.isArray(parsed.actions)) return [];
      const actions: GovernancePlanAction[] = [];
      const seen = new Set<string>();
      for (const item of parsed.actions) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const action = raw.action;
        if (action !== 'keep' && action !== 'delete' && action !== 'merge' && action !== 'update') {
          continue;
        }
        const targets = Array.isArray(raw.targets)
          ? raw.targets.filter((value): value is string =>
              typeof value === 'string' && byFile.has(value) && !seen.has(value))
          : [];
        if (targets.length === 0) continue;
        const reason = typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : '';
        if (!reason) continue;
        if (action === 'merge') {
          const into = typeof raw.into === 'string' && raw.into.trim() ? raw.into.trim() : '';
          const content = typeof raw.content === 'string' && raw.content.trim()
            ? raw.content.trim()
            : '';
          if (!into || !content) continue;
          targets.forEach(name => seen.add(name));
          actions.push({
            action, targets, into, content,
            ...(typeof raw.description === 'string' && raw.description.trim()
              ? { description: raw.description.trim() } : {}),
            reason,
          });
          continue;
        }
        if (action === 'update') {
          if (targets.length !== 1) continue;
          const content = typeof raw.content === 'string' && raw.content.trim()
            ? raw.content.trim()
            : '';
          if (!content) continue;
          targets.forEach(name => seen.add(name));
          actions.push({
            action, targets, content,
            ...(typeof raw.description === 'string' && raw.description.trim()
              ? { description: raw.description.trim() } : {}),
            reason,
          });
          continue;
        }
        targets.forEach(name => seen.add(name));
        actions.push({ action, targets, reason });
      }
      return actions;
    } catch {
      return [];
    }
  }

  private executePlan(
    actions: readonly GovernancePlanAction[],
    byFile: Map<string, MemoryFile>,
  ): GovernanceResult {
    const executed = emptyExecuted();
    let ignored = 0;
    let archiveCount = 0;
    const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
    // 先统一归档将被删除或被覆盖的原文，确保误删可恢复。
    const toArchive = new Set<string>();
    for (const action of actions) {
      for (const name of action.targets) {
        if (action.action === 'keep') continue;
        toArchive.add(name);
      }
    }
    const archiveDir = path.join(this.manager.projectDir, ARCHIVE_DIR, timestamp);
    mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    for (const name of toArchive) {
      const memory = byFile.get(name);
      if (!memory) continue;
      try {
        if (existsSync(memory.path)) {
          writeFileSync(
            path.join(archiveDir, `${name}${ARCHIVE_EXTENSION}`),
            readFileSync(memory.path, 'utf8'),
            { encoding: 'utf8', mode: 0o600 },
          );
          archiveCount += 1;
        }
      } catch {
        // 单文件归档失败不阻塞后续。
      }
    }
    for (const action of actions) {
      try {
        if (action.action === 'delete') {
          for (const name of action.targets) {
            const memory = byFile.get(name);
            if (!memory) continue;
            rmSync(memory.path, { force: true });
            executed.deleted.push(name);
          }
          continue;
        }
        if (action.action === 'merge') {
          const primary = byFile.get(action.targets[0]!);
          if (!primary || !action.into) continue;
          const type = primary.type;
          this.manager.saveMemory({
            name: action.into,
            description: action.description ?? primary.description,
            type,
            content: action.content ?? primary.content,
          });
          for (const name of action.targets) {
            const memory = byFile.get(name);
            if (!memory) continue;
            rmSync(memory.path, { force: true });
            executed.merged.push(name);
          }
          continue;
        }
        if (action.action === 'update') {
          const primary = byFile.get(action.targets[0]!);
          if (!primary) continue;
          this.manager.saveMemory({
            name: primary.name,
            description: action.description ?? primary.description,
            type: primary.type,
            content: action.content ?? primary.content,
          });
          executed.updated.push(action.targets[0]!);
          continue;
        }
        // keep
        for (const name of action.targets) executed.kept.push(name);
      } catch {
        ignored += 1;
      }
    }
    // 删除或合并后重建索引，并预计算是否发生超限截断。
    try {
      this.manager.rebuildIndex();
    } catch {
      ignored += 1;
    }
    const indexOverflow = this.checkIndexOverflow();
    const result: GovernanceResult = {
      ran: true,
      actions,
      executed,
      ignored,
      archiveCount,
      ...(indexOverflow.overflow
        ? { indexOverflow }
        : {}),
    };
    this.finalizeState(result);
    return result;
  }

  /**
   * 与 MemoryManager.rebuildIndex 相同的排序与截断规则，预计算会被
   * 200 行 / 25KB 上限挤掉的记忆名，让“静默截断”变成可见提示。
   */
  checkIndexOverflow(): { overflow: boolean; droppedNames: string[] } {
    const memories = this.manager.loadAll().sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    let lines = 0;
    let bytes = 0;
    for (const memory of memories) {
      const relative = memory.scope === 'project'
        ? path.relative(this.manager.projectDir, memory.path).split(path.sep).join('/')
        : `~/.bettercode/memory/${path.relative(this.manager.userDir, memory.path).split(path.sep).join('/')}`;
      const line = `- [${memory.name}](${relative}) — ${memory.description || '无描述'}`;
      const nextBytes = Buffer.byteLength(`${line}\n`, 'utf8');
      if (lines >= 200 || bytes + nextBytes > 25_000) break;
      lines += 1;
      bytes += nextBytes;
    }
    const droppedNames = memories.slice(lines).map(memory => memory.name);
    return { overflow: droppedNames.length > 0, droppedNames };
  }
}

function emptyExecuted(): GovernanceResult['executed'] {
  return { deleted: [], merged: [], updated: [], kept: [] };
}

function skipped(reason: string): GovernanceResult {
  return {
    ran: false,
    reason,
    executed: emptyExecuted(),
    ignored: 0,
    archiveCount: 0,
  };
}
