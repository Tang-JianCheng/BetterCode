import { AgentLoop } from '../agent/loop.js';
import { createEventStream } from '../agent/event-stream.js';
import { buildExecutePlanRequest } from '../agent/prompts.js';
import type {
  AgentEvent,
  AgentLoopOptions,
  AgentRunOptions,
  SavedPlan,
} from '../agent/types.js';
import type { LLMProvider, Message } from '../provider/types.js';
import type { SupplementalPromptContent } from '../prompt/types.js';
import type { PermissionManager } from '../permission/manager.js';
import type { PermissionDecider, PermissionMode, PermissionStatus } from '../permission/types.js';
import { ToolRegistry } from '../tool/registry.js';
import { ContextManager } from '../context/manager.js';
import type { ContextManagerOptions } from '../context/types.js';
import { FileHistory, type Snapshot } from '../filehistory/filehistory.js';
import * as promptHistory from '../history/history.js';
import { MemoryExtractor } from '../memory/extractor.js';
import { MemoryManager } from '../memory/manager.js';
import {
  cleanExpiredSessions,
  listSessions,
  loadSession,
  newSessionId,
  rebuildFromSession,
  saveCompactBoundary,
  saveMessage,
  type CompactBoundaryPayload,
  type RestoredMessage,
  type SessionInfo,
} from '../session/session.js';
import type { ToolCall } from '../tool/types.js';
import type { SkillManager } from '../skill/manager.js';
import type { SkillRunner } from '../skill/runner.js';

export interface ChatManagerMemoryOptions {
  autoExtract?: boolean;
  userHome?: string;
  sessionPersistence?: boolean;
}

export interface ChatManagerSkillOptions {
  manager?: SkillManager;
  runner?: SkillRunner;
}

export interface MemoryStatus {
  userDirectory: string;
  projectDirectory: string;
  userCount: number;
  projectCount: number;
}

export type RewindMode = 'code_and_conversation' | 'conversation_only' | 'code_only';

export interface RewindResult {
  snapshot: Snapshot;
  changedFiles: string[];
  history: Message[];
}

type MemorySavedListener = (names: readonly string[]) => void;

export class NoPlanError extends Error {
  constructor() {
    super('当前会话没有可执行的计划，请先使用 /plan <任务>');
    this.name = 'NoPlanError';
  }
}

export class ChatManager {
  private history: Message[] = [];
  private latestPlan: SavedPlan | undefined;
  private active = false;
  private closed = false;
  private readonly loop: AgentLoop;
  private readonly contextManager: ContextManager;
  private readonly rootDir: string;
  private readonly memoryManager: MemoryManager;
  private memoryExtractor: MemoryExtractor;
  private readonly autoExtract: boolean;
  private readonly sessionPersistence: boolean;
  private readonly memorySavedListeners = new Set<MemorySavedListener>();
  private readonly backgroundTasks = new Set<Promise<void>>();
  private sessionId = newSessionId();
  private fileHistory: FileHistory;
  private memoryCursor = 0;
  private memoryGeneration = 0;

  constructor(
    toolRegistry: ToolRegistry,
    private readonly permissionManager: PermissionManager,
    options: Partial<AgentLoopOptions> = {},
    supplemental: SupplementalPromptContent = {},
    contextOptions: Partial<ContextManagerOptions> = {},
    memoryOptions: ChatManagerMemoryOptions = {},
    private readonly skillOptions: ChatManagerSkillOptions = {},
  ) {
    this.rootDir = toolRegistry.rootDir;
    this.autoExtract = memoryOptions.autoExtract ?? false;
    this.sessionPersistence = memoryOptions.sessionPersistence ?? true;
    this.memoryManager = new MemoryManager(this.rootDir, { userHome: memoryOptions.userHome });
    this.memoryExtractor = new MemoryExtractor(this.memoryManager);
    this.fileHistory = new FileHistory(this.rootDir, this.sessionId);
    this.contextManager = new ContextManager(this.rootDir, contextOptions);
    this.loop = new AgentLoop(
      toolRegistry,
      permissionManager,
      options,
      supplemental,
      this.contextManager,
      {
        beforeToolExecution: call => this.trackToolEdit(call),
        onLoopComplete: (history, provider) => this.scheduleMemoryExtraction(history, provider),
      },
      {
        supplemental: skillOptions.manager
          ? () => skillOptions.manager!.promptContent()
          : undefined,
        visibleToolNames: skillOptions.manager
          ? () => skillOptions.manager!.visibleTools().names
          : undefined,
        transformToolResult: skillOptions.runner
          ? async input => skillOptions.runner!.transformToolResult({
              call: input.call,
              result: input.result,
              history: input.history,
              currentProvider: input.request.provider,
              options: {
                mode: input.request.mode,
                signal: input.request.signal,
                permissionDecider: input.request.permissionDecider,
              },
            })
          : undefined,
      },
    );
    Promise.resolve().then(() => cleanExpiredSessions(this.rootDir)).catch(() => {});
  }

  run(
    userInput: string,
    provider: LLMProvider,
    options: AgentRunOptions = {},
  ): AsyncIterable<AgentEvent> {
    const mode = options.mode ?? 'act';
    return this.start(
      userInput,
      provider,
      mode,
      options.signal,
      mode === 'plan' ? userInput : undefined,
      options.permissionDecider,
    );
  }

  runSkill(
    name: string,
    args: string,
    displayText: string,
    provider: LLMProvider,
    options: AgentRunOptions = {},
  ): AsyncIterable<AgentEvent> {
    const manager = this.skillOptions.manager;
    const runner = this.skillOptions.runner;
    if (!manager || !runner) throw new Error('Skill 系统未初始化');
    if (this.closed) throw new Error('ChatManager 已关闭');
    if (this.active) throw new Error('已有 Agent 任务正在运行');
    const skill = manager.get(name);
    if (!skill) throw new Error(`Skill 不存在或不可用: ${name}`);
    if (skill.mode === 'shared') {
      manager.activateShared(skill.name, args);
      const task = args.trim() || `执行 Skill ${skill.name}`;
      return this.run(task, provider, options);
    }

    return createEventStream(async emit => {
      if (this.closed) {
        emit({ type: 'error', iteration: 0, message: 'ChatManager 已关闭' });
        return;
      }
      if (this.active) {
        emit({ type: 'error', iteration: 0, message: '已有 Agent 任务正在运行' });
        return;
      }
      this.active = true;
      manager.beginExecution();
      let terminal: Extract<AgentEvent, { type: 'stopped' }> | undefined;
      try {
        this.fileHistory.makeSnapshot(this.history.length, displayText);
        this.persistMessage('user', displayText);
        const sourceHistory = [...this.history];
        this.history.push({ role: 'user', content: displayText });
        for await (const event of runner.run(skill.name, args, sourceHistory, provider, options)) {
          if (event.type === 'stopped') terminal = event;
          else emit(event);
        }
        const summary = terminal?.finalText.trim() ?? '';
        if (summary) {
          this.history.push({ role: 'assistant', content: summary });
          this.persistMessage('assistant', summary);
        }
      } catch (error) {
        emit({
          type: 'error',
          iteration: 0,
          message: error instanceof Error ? error.message : String(error),
        });
        terminal = { type: 'stopped', reason: 'stream_error', iterations: 0, finalText: '' };
      } finally {
        manager.endExecution();
        this.active = false;
      }
      if (terminal) emit(terminal);
    });
  }

  executeLatestPlan(
    provider: LLMProvider,
    signal?: AbortSignal,
    permissionDecider?: PermissionDecider,
  ): AsyncIterable<AgentEvent> {
    if (this.closed) throw new Error('ChatManager 已关闭');
    if (!this.latestPlan) throw new NoPlanError();
    const plan = { ...this.latestPlan };
    return this.start(buildExecutePlanRequest(plan), provider, 'act', signal, undefined, permissionDecider);
  }

  getHistory(): ReadonlyArray<Message> {
    return [...this.history];
  }

  getLatestPlan(): Readonly<SavedPlan> | undefined {
    return this.latestPlan ? { ...this.latestPlan } : undefined;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  listSessions(): SessionInfo[] {
    return listSessions(this.rootDir);
  }

  async resumeSession(sessionId: string): Promise<RestoredMessage[]> {
    if (this.closed) throw new Error('ChatManager 已关闭');
    if (this.active) throw new Error('Agent 运行期间不能恢复会话');
    const saved = loadSession(this.rootDir, sessionId);
    if (saved.length === 0) throw new Error(`会话不存在或为空: ${sessionId}`);
    const restored = rebuildFromSession(saved);
    if (restored.length === 0) throw new Error(`会话没有可恢复的消息: ${sessionId}`);
    await this.contextManager.clear();
    this.history = restored.map(message => ({ ...message }));
    this.latestPlan = undefined;
    this.memoryGeneration += 1;
    this.memoryCursor = this.history.length;
    this.memoryExtractor = new MemoryExtractor(this.memoryManager);
    this.sessionId = sessionId;
    this.fileHistory = new FileHistory(this.rootDir, sessionId);
    this.permissionManager.clearSessionRules();
    this.skillOptions.manager?.clearActive();
    return restored;
  }

  recordPrompt(text: string): void {
    try {
      promptHistory.append(this.rootDir, text);
    } catch {
      // 输入历史写入失败不影响用户提交任务。
    }
  }

  getPromptHistory(): string[] {
    return promptHistory.load(this.rootDir);
  }

  getMemoryStatus(): MemoryStatus {
    const memories = this.memoryManager.getMemories();
    return {
      userDirectory: this.memoryManager.userDir,
      projectDirectory: this.memoryManager.projectDir,
      userCount: memories.filter(memory => memory.scope === 'user').length,
      projectCount: memories.filter(memory => memory.scope === 'project').length,
    };
  }

  subscribeMemorySaved(listener: MemorySavedListener): () => void {
    this.memorySavedListeners.add(listener);
    return () => this.memorySavedListeners.delete(listener);
  }

  getSnapshots(): Snapshot[] {
    return this.fileHistory.getSnapshots();
  }

  rewind(snapshotIndex: number, mode: RewindMode): RewindResult {
    if (this.closed) throw new Error('ChatManager 已关闭');
    if (this.active) throw new Error('Agent 运行期间不能回滚');
    const snapshot = this.fileHistory.getSnapshots()[snapshotIndex];
    if (!snapshot) throw new Error('文件快照不存在');
    const changedFiles = mode === 'conversation_only'
      ? []
      : this.fileHistory.rewind(snapshotIndex);
    if (mode !== 'code_only') {
      this.history = this.history.slice(0, snapshot.messageIndex);
      this.latestPlan = undefined;
    }
    return { snapshot, changedFiles, history: [...this.history] };
  }

  compact(
    provider: LLMProvider,
    signal = new AbortController().signal,
  ): AsyncIterable<AgentEvent> {
    return createEventStream(async emit => {
      if (this.closed) {
        emit({ type: 'error', iteration: 0, message: 'ChatManager 已关闭' });
        return;
      }
      if (this.active) {
        emit({ type: 'error', iteration: 0, message: 'Agent 运行期间不能压缩上下文' });
        return;
      }
      this.active = true;
      this.skillOptions.manager?.beginExecution();
      try {
        let compacted = false;
        const result = await this.loop.compactHistory(this.history, provider, signal, emit);
        this.history = [...result.history];
        compacted = result.status === 'ready' && result.summarizedMessages > 0;
        if (compacted) this.persistCompactBoundary(this.history);
        if (result.status === 'skipped') {
          emit({
            type: 'context_failed',
            iteration: 0,
            trigger: 'manual',
            code: 'CONTEXT_NOTHING_TO_COMPACT',
            message: '当前会话没有可压缩的较早模型消息',
            consecutiveFailures: this.contextManager.getStatus().consecutiveSummaryFailures,
            circuitOpen: this.contextManager.getStatus().circuitOpen,
          });
        }
      } finally {
        this.skillOptions.manager?.endExecution();
        this.active = false;
      }
    });
  }

  async clear(): Promise<void> {
    if (this.closed) throw new Error('ChatManager 已关闭');
    if (this.active) throw new Error('Agent 运行期间不能清空会话');
    await this.contextManager.clear();
    this.history = [];
    this.latestPlan = undefined;
    this.memoryGeneration += 1;
    this.memoryCursor = 0;
    this.memoryExtractor = new MemoryExtractor(this.memoryManager);
    this.sessionId = newSessionId();
    this.fileHistory = new FileHistory(this.rootDir, this.sessionId);
    this.permissionManager.clearSessionRules();
    this.skillOptions.manager?.clearActive();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.active) throw new Error('Agent 运行期间不能关闭 ChatManager');
    await Promise.allSettled([...this.backgroundTasks]);
    await this.contextManager.close();
    this.closed = true;
  }

  getPermissionStatus(): PermissionStatus {
    return this.permissionManager.getStatus();
  }

  setPermissionMode(mode: PermissionMode): void {
    if (this.active) throw new Error('Agent 运行期间不能切换权限模式');
    this.permissionManager.setMode(mode);
  }

  get turnCount(): number {
    return this.history.filter(message => message.role === 'user').length;
  }

  private start(
    userMessage: string,
    provider: LLMProvider,
    mode: 'act' | 'plan',
    signal = new AbortController().signal,
    planTask?: string,
    permissionDecider?: PermissionDecider,
  ): AsyncIterable<AgentEvent> {
    return createEventStream(async emit => {
      if (this.closed) {
        emit({ type: 'error', iteration: 0, message: 'ChatManager 已关闭' });
        emit({
          type: 'stopped',
          reason: 'context_error',
          iterations: 0,
          finalText: '',
        });
        return;
      }
      if (this.active) {
        emit({ type: 'error', iteration: 0, message: '已有 Agent 任务正在运行' });
        emit({
          type: 'stopped',
          reason: 'stream_error',
          iterations: 0,
          finalText: '',
        });
        return;
      }

      this.active = true;
      this.skillOptions.manager?.beginExecution();
      let terminalEvent: Extract<AgentEvent, { type: 'stopped' }> | undefined;
      let compacted = false;
      try {
        this.fileHistory.makeSnapshot(this.history.length, userMessage);
        this.persistMessage('user', userMessage);
        const outcome = await this.loop.execute({
          history: this.history,
          userMessage,
          mode,
          provider,
          signal,
          permissionDecider,
        }, event => {
          if (event.type === 'stopped') terminalEvent = event;
          else {
            if (event.type === 'context_compacted') compacted = true;
            emit(event);
          }
        });

        this.history = [...outcome.history];
        if (compacted) this.persistCompactBoundary(this.history);
        if (outcome.finalText.trim()) this.persistMessage('assistant', outcome.finalText);
        if (mode === 'plan' && planTask !== undefined &&
            outcome.reason === 'completed' && outcome.finalText.trim()) {
          this.latestPlan = { task: planTask, content: outcome.finalText };
        }
      } catch (error) {
        emit({
          type: 'error',
          iteration: 0,
          message: error instanceof Error ? error.message : String(error),
        });
        terminalEvent = {
          type: 'stopped',
          reason: 'stream_error',
          iterations: 0,
          finalText: '',
        };
      } finally {
        this.skillOptions.manager?.endExecution();
        this.active = false;
      }

      if (terminalEvent) emit(terminalEvent);
    });
  }

  private persistMessage(role: 'user' | 'assistant', content: string): void {
    if (!this.sessionPersistence || !content.trim()) return;
    try {
      saveMessage(this.rootDir, this.sessionId, {
        role,
        content,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // 会话存档失败不影响当前 Agent 任务。
    }
  }

  private persistCompactBoundary(history: readonly Message[]): void {
    if (!this.sessionPersistence) return;
    const payload = this.buildCompactBoundary(history);
    if (!payload) return;
    try {
      saveCompactBoundary(this.rootDir, this.sessionId, payload);
    } catch {
      // 压缩边界存档失败时仍保留内存中的压缩结果。
    }
  }

  private buildCompactBoundary(history: readonly Message[]): CompactBoundaryPayload | undefined {
    const summary = [...history].reverse().find(message =>
      message.role === 'instruction' && message.instructionKind === 'context_summary');
    if (!summary?.content.trim()) return undefined;
    const keep = history.flatMap(message => {
      if ((message.role !== 'user' && message.role !== 'assistant') || !message.content.trim()) return [];
      return [{ role: message.role, content: message.content }];
    });
    return { summary: summary.content, keep };
  }

  private trackToolEdit(call: ToolCall): void {
    if (call.name !== 'write_file' && call.name !== 'edit_file') return;
    const filePath = call.arguments.path;
    if (typeof filePath === 'string' && filePath.trim()) this.fileHistory.trackEdit(filePath);
  }

  private scheduleMemoryExtraction(history: readonly Message[], provider: LLMProvider): void {
    if (!this.autoExtract || this.closed) return;
    if (history.length - this.memoryCursor < 2) return;
    const context = this.buildExtractionContext(history);
    if (!context) return;
    const cursor = history.length;
    const generation = this.memoryGeneration;
    let task: Promise<void>;
    task = this.memoryExtractor.extract(context, provider)
      .then(names => {
        if (generation !== this.memoryGeneration) return;
        this.memoryCursor = Math.max(this.memoryCursor, cursor);
        if (names.length === 0) return;
        for (const listener of this.memorySavedListeners) {
          try {
            listener(names);
          } catch {
            // 单个界面订阅异常不影响其他通知。
          }
        }
      })
      .catch(() => {})
      .finally(() => this.backgroundTasks.delete(task));
    this.backgroundTasks.add(task);
  }

  private buildExtractionContext(history: readonly Message[]): string {
    const lines = history.slice(-40).flatMap(message => {
      if (message.role === 'instruction') return [];
      const content = message.content.trim();
      if (content.length < 12) return [];
      const role = message.role === 'tool' ? `tool:${message.toolName}` : message.role;
      return [`[${role}] ${content}`];
    });
    return lines.join('\n').slice(-24_000);
  }
}
