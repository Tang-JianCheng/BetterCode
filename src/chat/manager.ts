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

  constructor(
    toolRegistry: ToolRegistry,
    private readonly permissionManager: PermissionManager,
    options: Partial<AgentLoopOptions> = {},
    supplemental: SupplementalPromptContent = {},
    contextOptions: Partial<ContextManagerOptions> = {},
  ) {
    this.contextManager = new ContextManager(toolRegistry.rootDir, contextOptions);
    this.loop = new AgentLoop(
      toolRegistry,
      permissionManager,
      options,
      supplemental,
      this.contextManager,
    );
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
      try {
        const result = await this.loop.compactHistory(this.history, provider, signal, emit);
        this.history = [...result.history];
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
    this.permissionManager.clearSessionRules();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.active) throw new Error('Agent 运行期间不能关闭 ChatManager');
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
      let terminalEvent: Extract<AgentEvent, { type: 'stopped' }> | undefined;
      try {
        const outcome = await this.loop.execute({
          history: this.history,
          userMessage,
          mode,
          provider,
          signal,
          permissionDecider,
        }, event => {
          if (event.type === 'stopped') terminalEvent = event;
          else emit(event);
        });

        this.history = [...outcome.history];
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
        this.active = false;
      }

      if (terminalEvent) emit(terminalEvent);
    });
  }
}
