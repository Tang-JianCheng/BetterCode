import type { ToolResultTransformInput } from '../agent/loop.js';
import type { PermissionMode } from '../permission/types.js';
import type { LLMProvider } from '../provider/types.js';
import type { ToolRegistry } from '../tool/registry.js';
import type { ToolCall, ToolResult } from '../tool/types.js';
import { createToolError, createToolSuccess } from '../tool/types.js';
import type { AgentDefinitionManager } from './definition-manager.js';
import type { SubAgentResultInbox } from './result-inbox.js';
import type { SubAgentRunner } from './runner.js';
import type { SubAgentTaskManager } from './task-manager.js';
import { resolveDefinedToolSnapshot, resolveForkToolDefinitions } from './tool-filter.js';
import {
  AGENT_TOOL_NAME,
  type AgentProviderResolver,
  type HookAgentRunInput,
  type HookAgentRunResult,
  type HookAgentRunner,
  type ResolvedSubAgentOptions,
  type SubAgentEvent,
  type SubAgentTaskSnapshot,
} from './types.js';

const MAX_FOREGROUND_RESULT_BYTES = 64 * 1024;

export interface SubAgentDispatchContext {
  sessionId: string;
  parentTurnId?: string;
  permissionMode: PermissionMode;
  trackToolEdit?: (call: ToolCall) => void;
}

export interface SubAgentCoordinatorOptions {
  defaultProvider(): LLMProvider;
}

function bounded(value: string): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= MAX_FOREGROUND_RESULT_BYTES) return value;
  return bytes.subarray(0, MAX_FOREGROUND_RESULT_BYTES).toString('utf8');
}

export class SubAgentCoordinator implements HookAgentRunner {
  private activeSessionId?: string;
  private closed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly definitions: AgentDefinitionManager,
    private readonly providers: AgentProviderResolver,
    private readonly runner: SubAgentRunner,
    private readonly tasks: SubAgentTaskManager,
    private readonly inbox: SubAgentResultInbox,
    private readonly subagentOptions: ResolvedSubAgentOptions,
    private readonly options: SubAgentCoordinatorOptions,
  ) {
    this.unsubscribe = tasks.subscribe(event => {
      if (event.type === 'task_finished') this.inbox.enqueue(event.task);
    });
  }

  setActiveSession(sessionId: string): void {
    if (this.closed) throw new Error('子 Agent 协调器已关闭');
    this.activeSessionId = sessionId;
  }

  async transformToolResult(
    input: ToolResultTransformInput,
    context: SubAgentDispatchContext,
  ): Promise<ToolResult> {
    if (input.call.name !== AGENT_TOOL_NAME || !input.result.ok ||
        input.result.metadata.subagentDispatch !== true) return input.result;
    if (!this.accepts(context.sessionId)) {
      return createToolError('SUBAGENT_UNAVAILABLE', '当前会话不再接受新的子 Agent 任务');
    }
    const type = input.call.arguments.type;
    const task = typeof input.call.arguments.task === 'string'
      ? input.call.arguments.task.trim()
      : '';
    if (!task) return createToolError('INVALID_ARGUMENTS', 'agent.task 必须是非空字符串');

    if (type === 'defined') return this.dispatchDefined(input, context, task);
    if (type === 'fork') return this.dispatchFork(input, context, task);
    return createToolError('INVALID_ARGUMENTS', 'agent.type 必须是 defined 或 fork');
  }

  async runHookAgent(input: HookAgentRunInput): Promise<HookAgentRunResult> {
    if (!this.accepts(input.sessionId)) {
      return { status: 'failed', code: 'SUBAGENT_UNAVAILABLE', message: '当前会话不再接受 Hook 子 Agent' };
    }
    const definition = this.definitions.get(input.role ?? 'general');
    if (!definition) {
      return {
        status: 'failed',
        code: 'SUBAGENT_UNAVAILABLE',
        message: `子 Agent 角色不存在或不可用: ${input.role ?? 'general'}`,
      };
    }
    let provider: LLMProvider;
    try {
      provider = this.resolveDefinedProvider(definition, this.options.defaultProvider());
    } catch (error) {
      return {
        status: 'failed',
        code: 'SUBAGENT_UNAVAILABLE',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const tools = resolveDefinedToolSnapshot({
      registryNames: this.registry.names(),
      definition,
      deniedTools: this.subagentOptions.deniedTools,
    });
    let taskId = '';
    const started = this.tasks.start({
      kind: 'defined',
      role: definition.name,
      task: input.prompt,
      origin: 'hook',
      sessionId: input.sessionId,
      ...(input.background ? { background: 'hook' as const } : {}),
    }, (signal, emit) => this.runner.run({
      kind: 'defined',
      definition,
      provider,
      task: input.prompt,
      mode: input.mode,
      foregroundTools: tools.foreground,
      backgroundTools: tools.background,
      isBackground: () => this.tasks.get(input.sessionId, taskId)?.executionMode === 'background',
    }, { taskId, sessionId: input.sessionId }, signal, emit));
    taskId = started.id;
    if (input.background) return { status: 'backgrounded', taskId };
    const waited = await this.tasks.waitForeground(taskId, input.signal);
    if (waited.status === 'backgrounded') return { status: 'backgrounded', taskId };
    if (waited.task.state === 'completed') {
      return { status: 'completed', output: waited.task.result ?? '' };
    }
    return {
      status: 'failed',
      code: waited.task.error?.code ?? 'SUBAGENT_FAILED',
      message: waited.task.error?.message ?? 'Hook 子 Agent 执行失败',
    };
  }

  moveForegroundToBackground(sessionId: string): SubAgentTaskSnapshot | undefined {
    return this.tasks.moveForegroundToBackground(sessionId, 'manual');
  }

  hasForeground(sessionId: string): boolean { return this.tasks.hasForeground(sessionId); }
  list(sessionId: string): SubAgentTaskSnapshot[] { return this.tasks.list(sessionId); }
  get(sessionId: string, taskId: string): SubAgentTaskSnapshot | undefined {
    return this.tasks.get(sessionId, taskId);
  }
  subscribe(listener: (event: SubAgentEvent) => void): () => void {
    return this.tasks.subscribe(listener);
  }

  async cancelSession(sessionId: string, reason: string): Promise<void> {
    await this.tasks.cancelSession(sessionId, reason);
    this.inbox.discardSession(sessionId);
    if (this.activeSessionId === sessionId) this.activeSessionId = undefined;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.activeSessionId = undefined;
    this.unsubscribe();
    await this.tasks.close();
    this.inbox.close();
  }

  private async dispatchDefined(
    input: ToolResultTransformInput,
    context: SubAgentDispatchContext,
    task: string,
  ): Promise<ToolResult> {
    const role = typeof input.call.arguments.role === 'string'
      ? input.call.arguments.role.trim().toLowerCase()
      : '';
    const definition = this.definitions.get(role);
    if (!definition) {
      return createToolError('SUBAGENT_UNAVAILABLE', `子 Agent 角色不存在或不可用: ${role || '(空)'}`);
    }
    let provider: LLMProvider;
    try {
      provider = this.resolveDefinedProvider(definition, input.request.provider);
    } catch (error) {
      return createToolError(
        'SUBAGENT_UNAVAILABLE',
        `无法解析子 Agent Provider: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const tools = resolveDefinedToolSnapshot({
      registryNames: this.registry.names(),
      definition,
      deniedTools: this.subagentOptions.deniedTools,
    });
    const background = input.call.arguments.background === true ? 'explicit' as const : undefined;
    let taskId = '';
    const started = this.tasks.start({
      kind: 'defined',
      role: definition.name,
      task,
      origin: 'tool',
      sessionId: context.sessionId,
      ...(context.parentTurnId ? { parentTurnId: context.parentTurnId } : {}),
      ...(background ? { background } : {}),
    }, (signal, emit) => this.runner.run({
      kind: 'defined',
      definition,
      provider,
      task,
      mode: input.request.mode,
      foregroundTools: tools.foreground,
      backgroundTools: tools.background,
      isBackground: () => this.tasks.get(context.sessionId, taskId)?.executionMode === 'background',
    }, {
      taskId,
      sessionId: context.sessionId,
      ...(context.parentTurnId ? { parentTurnId: context.parentTurnId } : {}),
      ...(context.trackToolEdit ? { trackToolEdit: context.trackToolEdit } : {}),
    }, signal, emit));
    taskId = started.id;
    return this.waitOrBackground(started, input.request.signal);
  }

  private dispatchFork(
    input: ToolResultTransformInput,
    context: SubAgentDispatchContext,
    task: string,
  ): ToolResult {
    let taskId = '';
    const started = this.tasks.start({
      kind: 'fork',
      task,
      origin: 'tool',
      sessionId: context.sessionId,
      ...(context.parentTurnId ? { parentTurnId: context.parentTurnId } : {}),
      background: 'fork',
    }, (signal, emit) => this.runner.run({
      kind: 'fork',
      provider: input.request.provider,
      task,
      mode: input.request.mode,
      parentRequest: input.providerRequest,
      toolDefinitions: resolveForkToolDefinitions({
        parentTools: input.providerRequest.tools,
        deniedTools: this.subagentOptions.deniedTools,
      }),
      maxIterations: this.subagentOptions.forkMaxIterations,
      permissionMode: context.permissionMode,
    }, {
      taskId,
      sessionId: context.sessionId,
      ...(context.parentTurnId ? { parentTurnId: context.parentTurnId } : {}),
      ...(context.trackToolEdit ? { trackToolEdit: context.trackToolEdit } : {}),
    }, signal, emit));
    taskId = started.id;
    return this.backgroundResult(started);
  }

  private resolveDefinedProvider(
    definition: Parameters<AgentDefinitionManager['resolveProviderName']>[0],
    inherited: LLMProvider,
  ): LLMProvider {
    const providerName = this.definitions.resolveProviderName(definition);
    return providerName ? this.providers.resolve(providerName) : inherited;
  }

  private accepts(sessionId: string): boolean {
    return !this.closed && this.activeSessionId === sessionId;
  }

  private async waitOrBackground(
    task: SubAgentTaskSnapshot,
    parentSignal: AbortSignal,
  ): Promise<ToolResult> {
    if (task.executionMode === 'background') return this.backgroundResult(task);
    const waited = await this.tasks.waitForeground(task.id, parentSignal);
    if (waited.status === 'backgrounded') return this.backgroundResult(waited.task);
    if (waited.task.state === 'completed') {
      return createToolSuccess(bounded(waited.task.result ?? ''), {
        subagentTaskId: waited.task.id,
        subagentState: waited.task.state,
      });
    }
    return createToolError(
      waited.task.error?.code === 'CANCELLED' ? 'CANCELLED' : 'SUBAGENT_FAILED',
      waited.task.error?.message ?? '子 Agent 执行失败',
      { subagentTaskId: waited.task.id, subagentState: waited.task.state },
    );
  }

  private backgroundResult(task: SubAgentTaskSnapshot): ToolResult {
    return createToolSuccess(`子 Agent 已在后台运行，任务 ID: ${task.id}`, {
      subagentTaskId: task.id,
      subagentState: task.state,
      background: true,
      backgroundReason: task.backgroundReason ?? 'explicit',
    });
  }
}
