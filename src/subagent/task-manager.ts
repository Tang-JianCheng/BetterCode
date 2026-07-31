import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentOutcome } from '../agent/types.js';
import type { TokenUsage } from '../provider/types.js';
import { truncateUtf8 } from '../tool/output-limit.js';
import type {
  SubAgentBackgroundReason,
  SubAgentEvent,
  SubAgentKind,
  SubAgentTaskRecord,
  SubAgentTaskSnapshot,
  SubAgentWorktreeState,
} from './types.js';

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};
const MAX_TASK_RESULT_BYTES = 64 * 1024;

export interface StartSubAgentTaskInput {
  kind: SubAgentKind;
  role?: string;
  task: string;
  origin: 'tool' | 'hook';
  sessionId: string;
  parentTurnId?: string;
  background?: SubAgentBackgroundReason;
  isolation?: 'worktree';
}

export type ForegroundWaitResult =
  | { status: 'finished'; task: SubAgentTaskSnapshot }
  | { status: 'backgrounded'; task: SubAgentTaskSnapshot };

interface TaskControl {
  record: SubAgentTaskRecord;
  controller: AbortController;
  operation: Promise<void>;
  completion: Promise<SubAgentTaskSnapshot>;
  resolveCompletion(task: SubAgentTaskSnapshot): void;
  backgroundWait: Promise<SubAgentTaskSnapshot>;
  resolveBackground(task: SubAgentTaskSnapshot): void;
}

type Listener = (event: SubAgentEvent) => void;

function snapshot(record: SubAgentTaskRecord): SubAgentTaskSnapshot {
  return Object.freeze(structuredClone(record));
}

function isTerminal(record: SubAgentTaskRecord): boolean {
  return record.state === 'completed' || record.state === 'failed' || record.state === 'cancelled';
}

export class SubAgentTaskManager {
  private readonly tasks = new Map<string, TaskControl>();
  private readonly foregroundBySession = new Map<string, string>();
  private readonly listeners = new Set<Listener>();
  private closed = false;

  constructor(
    private readonly foregroundTimeoutMs: number,
    private readonly retainedTasks: number,
  ) {}

  start(
    input: StartSubAgentTaskInput,
    operation: (signal: AbortSignal, emit: (event: AgentEvent) => void) => Promise<AgentOutcome>,
  ): SubAgentTaskSnapshot {
    if (this.closed) throw new Error('子 Agent 任务管理器已关闭');
    if (!input.background && this.foregroundBySession.has(input.sessionId)) {
      throw new Error('当前会话已有前台子 Agent');
    }
    const now = new Date().toISOString();
    const taskId = `sa-${randomUUID()}`;
    const record: SubAgentTaskRecord = {
      id: taskId,
      kind: input.kind,
      ...(input.role ? { role: input.role } : {}),
      task: input.task,
      origin: input.origin,
      sessionId: input.sessionId,
      ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
      executionMode: input.background ? 'background' : 'foreground',
      ...(input.background ? { backgroundReason: input.background } : {}),
      state: 'waiting',
      createdAt: now,
      iterations: 0,
      usage: { ...EMPTY_USAGE },
      ...(input.isolation === 'worktree' && input.role ? {
        worktree: {
          isolation: 'worktree' as const,
          name: `${input.role}/${taskId}`,
          state: 'preparing' as const,
        },
      } : {}),
    };
    let resolveCompletion!: (task: SubAgentTaskSnapshot) => void;
    let resolveBackground!: (task: SubAgentTaskSnapshot) => void;
    const completion = new Promise<SubAgentTaskSnapshot>(resolve => { resolveCompletion = resolve; });
    const backgroundWait = new Promise<SubAgentTaskSnapshot>(resolve => { resolveBackground = resolve; });
    const control: TaskControl = {
      record,
      controller: new AbortController(),
      operation: Promise.resolve(),
      completion,
      resolveCompletion,
      backgroundWait,
      resolveBackground,
    };
    this.tasks.set(record.id, control);
    if (!input.background) this.foregroundBySession.set(record.sessionId, record.id);
    this.publish({ type: 'task_created', task: snapshot(record) });
    control.operation = Promise.resolve()
      .then(async () => {
        if (control.controller.signal.aborted) {
          this.finalizeCancelled(control, '任务在启动前已取消');
          return;
        }
        control.record.state = 'running';
        control.record.startedAt = new Date().toISOString();
        this.publish({ type: 'task_started', task: snapshot(control.record) });
        const outcome = await operation(
          control.controller.signal,
          event => this.handleAgentEvent(control, event),
        );
        this.finalizeOutcome(control, outcome);
      })
      .catch(error => this.finalizeFailed(
        control,
        control.record.worktree?.state === 'failed' ? 'SUBAGENT_WORKTREE_ERROR' : 'SUBAGENT_FAILED',
        error instanceof Error ? error.message : String(error),
      ));
    if (input.background) {
      queueMicrotask(() => this.publish({
        type: 'task_backgrounded',
        task: snapshot(record),
        reason: input.background!,
      }));
    }
    return snapshot(record);
  }

  async waitForeground(taskId: string, parentSignal: AbortSignal): Promise<ForegroundWaitResult> {
    const control = this.tasks.get(taskId);
    if (!control) throw new Error(`子 Agent 任务不存在: ${taskId}`);
    if (control.record.executionMode === 'background') {
      return { status: 'backgrounded', task: snapshot(control.record) };
    }
    const current = this.foregroundBySession.get(control.record.sessionId);
    if (current && current !== taskId) throw new Error('当前会话已有前台子 Agent');
    this.foregroundBySession.set(control.record.sessionId, taskId);
    const timer = setTimeout(() => {
      this.moveForegroundToBackground(control.record.sessionId, 'timeout');
    }, this.foregroundTimeoutMs);
    const onCancel = () => {
      if (control.record.executionMode === 'foreground') control.controller.abort();
    };
    parentSignal.addEventListener('abort', onCancel, { once: true });
    if (parentSignal.aborted) onCancel();
    try {
      const result = await Promise.race([
        control.completion.then(task => ({ status: 'finished' as const, task })),
        control.backgroundWait.then(task => ({ status: 'backgrounded' as const, task })),
      ]);
      if (result.status === 'backgrounded') parentSignal.removeEventListener('abort', onCancel);
      return result;
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onCancel);
      if (this.foregroundBySession.get(control.record.sessionId) === taskId) {
        this.foregroundBySession.delete(control.record.sessionId);
      }
    }
  }

  moveForegroundToBackground(
    sessionId: string,
    reason: 'manual' | 'timeout',
  ): SubAgentTaskSnapshot | undefined {
    const taskId = this.foregroundBySession.get(sessionId);
    const control = taskId ? this.tasks.get(taskId) : undefined;
    if (!control || control.record.executionMode !== 'foreground' || isTerminal(control.record)) {
      return undefined;
    }
    control.record.executionMode = 'background';
    control.record.backgroundReason = reason;
    this.foregroundBySession.delete(sessionId);
    const task = snapshot(control.record);
    control.resolveBackground(task);
    this.publish({ type: 'task_backgrounded', task, reason });
    return task;
  }

  hasForeground(sessionId: string): boolean {
    return this.foregroundBySession.has(sessionId);
  }

  list(sessionId: string): SubAgentTaskSnapshot[] {
    return [...this.tasks.values()]
      .filter(control => control.record.sessionId === sessionId)
      .sort((left, right) => right.record.createdAt.localeCompare(left.record.createdAt))
      .map(control => snapshot(control.record));
  }

  get(sessionId: string, taskId: string): SubAgentTaskSnapshot | undefined {
    const control = this.tasks.get(taskId);
    return control?.record.sessionId === sessionId ? snapshot(control.record) : undefined;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  updateWorktree(taskId: string, worktree: SubAgentWorktreeState): void {
    const control = this.tasks.get(taskId);
    if (!control || isTerminal(control.record)) return;
    control.record.worktree = structuredClone(worktree);
    this.publish({ type: 'task_worktree', taskId, worktree: structuredClone(worktree) });
  }

  async cancelSession(sessionId: string, reason: string): Promise<void> {
    const controls = [...this.tasks.values()].filter(control =>
      control.record.sessionId === sessionId && !isTerminal(control.record));
    for (const control of controls) {
      control.record.error = { code: 'CANCELLED', message: reason };
      control.controller.abort();
    }
    await Promise.allSettled(controls.map(control => control.operation));
    this.foregroundBySession.delete(sessionId);
  }

  async cancelAll(reason: string): Promise<void> {
    const sessions = new Set([...this.tasks.values()].map(control => control.record.sessionId));
    await Promise.all([...sessions].map(session => this.cancelSession(session, reason)));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.cancelAll('BetterCode 正在关闭');
    this.listeners.clear();
  }

  private handleAgentEvent(control: TaskControl, event: AgentEvent): void {
    if (isTerminal(control.record)) return;
    if (event.type === 'usage') {
      control.record.usage = { ...event.cumulative };
      this.publish({ type: 'task_usage', taskId: control.record.id, usage: { ...event.cumulative } });
    } else if (event.type === 'progress') {
      this.publish({
        type: 'task_progress',
        taskId: control.record.id,
        iteration: event.iteration,
        stage: event.stage,
        ...(event.toolName ? { toolName: event.toolName } : {}),
      });
    } else if (event.type === 'tool_call') {
      this.publish({ type: 'task_tool_call', taskId: control.record.id, iteration: event.iteration, call: structuredClone(event.call) });
    } else if (event.type === 'tool_result') {
      this.publish({
        type: 'task_tool_result',
        taskId: control.record.id,
        iteration: event.iteration,
        call: structuredClone(event.call),
        result: structuredClone(event.result),
      });
    }
  }

  private finalizeOutcome(control: TaskControl, outcome: AgentOutcome): void {
    if (isTerminal(control.record)) return;
    control.record.iterations = outcome.iterations;
    control.record.usage = { ...outcome.usage };
    control.record.stopReason = outcome.reason;
    const result = truncateUtf8(outcome.finalText, MAX_TASK_RESULT_BYTES).value;
    if (result) control.record.result = result;
    if (outcome.reason === 'completed' && result.trim()) {
      control.record.state = 'completed';
    } else if (outcome.reason === 'cancelled') {
      control.record.state = 'cancelled';
      control.record.error ??= { code: 'CANCELLED', message: '子 Agent 已取消' };
    } else {
      control.record.state = 'failed';
      control.record.error = {
        code: 'SUBAGENT_FAILED',
        message: `子 Agent 未正常完成: ${outcome.reason}`,
      };
    }
    this.finish(control);
  }

  private finalizeCancelled(control: TaskControl, message: string): void {
    if (isTerminal(control.record)) return;
    control.record.state = 'cancelled';
    control.record.stopReason = 'cancelled';
    control.record.error = { code: 'CANCELLED', message };
    this.finish(control);
  }

  private finalizeFailed(control: TaskControl, code: string, message: string): void {
    if (isTerminal(control.record)) return;
    control.record.state = control.controller.signal.aborted ? 'cancelled' : 'failed';
    control.record.stopReason = control.controller.signal.aborted ? 'cancelled' : 'stream_error';
    control.record.error = { code, message };
    this.finish(control);
  }

  private finish(control: TaskControl): void {
    control.record.finishedAt = new Date().toISOString();
    if (this.foregroundBySession.get(control.record.sessionId) === control.record.id) {
      this.foregroundBySession.delete(control.record.sessionId);
    }
    const task = snapshot(control.record);
    control.resolveCompletion(task);
    this.publish({ type: 'task_finished', task });
    this.evictTerminalTasks();
  }

  private evictTerminalTasks(): void {
    const terminal = [...this.tasks.values()]
      .filter(control => isTerminal(control.record))
      .sort((left, right) => left.record.finishedAt!.localeCompare(right.record.finishedAt!));
    while (terminal.length > this.retainedTasks) {
      const oldest = terminal.shift()!;
      this.tasks.delete(oldest.record.id);
    }
  }

  private publish(event: SubAgentEvent): void {
    const frozen = Object.freeze(structuredClone(event));
    for (const listener of this.listeners) {
      try {
        listener(frozen);
      } catch {}
    }
  }
}
