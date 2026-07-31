import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AgentStopReason } from '../agent/types.js';
import type { ToolCall, ToolResult } from '../tool/types.js';
import type {
  CompiledHookRule,
  HookActionExecutor,
  HookActionResult,
  HookDispatchResult,
  HookEventContext,
  HookEventName,
  HookLogger,
  HookRuntime,
  HookTurnStartInput,
  PreparedHookPromptBatch,
} from './types.js';

interface ActiveTurn extends HookTurnStartInput {
  id: string;
}

interface PromptEntry {
  id: number;
  content: string;
}

const MAX_CONTEXT_TEXT_BYTES = 64 * 1024;

function limitText(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= MAX_CONTEXT_TEXT_BYTES) return value;
  return Buffer.from(value, 'utf8').subarray(0, MAX_CONTEXT_TEXT_BYTES).toString('utf8');
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return value;
}

function cloneFrozen<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export class HookManager implements HookRuntime {
  private systemStarted = false;
  private sessionActive = false;
  private closing = false;
  private closed = false;
  private sessionId = '';
  private turn?: ActiveTurn;
  private promptSequence = 0;
  private readonly prompts: PromptEntry[] = [];
  private readonly onceStates = new Map<string, 'running' | 'completed'>();
  private readonly backgroundTasks = new Set<Promise<void>>();
  private readonly shutdown = new AbortController();
  private closePromise?: Promise<void>;

  constructor(
    readonly rootDir: string,
    private readonly rules: readonly CompiledHookRule[],
    private readonly executor: HookActionExecutor,
    private readonly logger: HookLogger,
  ) {
    this.rootDir = path.resolve(rootDir);
  }

  async startSystem(sessionId: string, reason = 'startup'): Promise<void> {
    if (this.systemStarted || this.closed) return;
    this.systemStarted = true;
    this.sessionId = sessionId;
    await this.dispatchContext(this.context('system_start', { system: { reason } }), this.shutdown.signal);
  }

  async startSession(sessionId: string, reason: string): Promise<void> {
    if (this.closed || this.sessionActive) return;
    this.sessionId = sessionId;
    this.sessionActive = true;
    await this.dispatchContext(this.context('session_start', { session: { id: sessionId, reason } }), this.shutdown.signal);
  }

  async endSession(reason: string): Promise<void> {
    if (!this.sessionActive) return;
    await this.dispatchContext(this.context('session_end', {
      session: { id: this.sessionId, reason },
    }), this.shutdown.signal);
    this.sessionActive = false;
  }

  async startTurn(input: HookTurnStartInput, signal: AbortSignal): Promise<string> {
    if (this.turn) throw new Error('Hook turn 已开始');
    this.turn = { ...input, id: randomUUID() };
    await this.dispatchContext(this.context('turn_start'), signal);
    return this.turn.id;
  }

  async endTurn(reason: AgentStopReason, signal: AbortSignal): Promise<void> {
    if (!this.turn) return;
    const turn = this.turn;
    await this.dispatchContext(this.context('turn_end', {
      turn: { ...turn, stopReason: reason },
    }), signal);
    this.turn = undefined;
  }

  async emitUserMessage(content: string, signal: AbortSignal): Promise<void> {
    if (!this.turn) return;
    await this.dispatchContext(this.context('user_message', {
      message: { role: 'user', content: limitText(content) },
    }), signal);
  }

  async emitAssistantMessage(
    input: { content: string; toolCalls: readonly ToolCall[] },
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.turn) return;
    await this.dispatchContext(this.context('assistant_message', {
      message: {
        role: 'assistant',
        content: limitText(input.content),
        toolCalls: input.toolCalls.map(call => ({ id: call.id, name: call.name })),
      },
    }), signal);
  }

  beforeToolUse(call: ToolCall, signal: AbortSignal): Promise<HookDispatchResult> {
    return this.dispatchContext(this.context('pre_tool_use', {
      tool: { id: call.id, name: call.name, arguments: cloneFrozen(call.arguments) },
    }), signal);
  }

  async afterToolUse(call: ToolCall, result: ToolResult, signal: AbortSignal): Promise<void> {
    await this.dispatchContext(this.context('post_tool_use', {
      tool: {
        id: call.id,
        name: call.name,
        arguments: cloneFrozen(call.arguments),
        result: cloneFrozen(result),
      },
    }), signal);
  }

  preparePromptBatch(): PreparedHookPromptBatch | undefined {
    const last = this.prompts.at(-1);
    if (!last) return undefined;
    return {
      throughId: last.id,
      content: this.prompts.map(item => item.content).join('\n\n'),
    };
  }

  commitPromptBatch(throughId: number): void {
    while (this.prompts[0]?.id !== undefined && this.prompts[0].id <= throughId) this.prompts.shift();
  }

  close(reason = 'shutdown'): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeInternal(reason);
    return this.closePromise;
  }

  private async closeInternal(reason: string): Promise<void> {
    if (this.closed) return;
    if (this.turn) await this.endTurn('cancelled', this.shutdown.signal);
    await this.endSession(reason);
    this.closing = true;
    this.shutdown.abort();
    await this.waitForBackgroundTasks();
    if (this.systemStarted) {
      const stopController = new AbortController();
      await this.dispatchContext(this.context('system_stop', { system: { reason } }), stopController.signal);
      await this.waitForBackgroundTasks();
      stopController.abort();
    }
    this.closed = true;
    await Promise.resolve(this.logger.close?.()).catch(() => {});
  }

  private async waitForBackgroundTasks(): Promise<void> {
    if (this.backgroundTasks.size === 0) return;
    await Promise.race([
      Promise.allSettled([...this.backgroundTasks]),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
  }

  private context(event: HookEventName, extra: Partial<HookEventContext> = {}): HookEventContext {
    const base = {
      event,
      projectRoot: this.rootDir,
      session: { id: this.sessionId },
      timestamp: new Date().toISOString(),
      ...(this.turn ? { turn: { ...this.turn } } : {}),
      ...extra,
    };
    return cloneFrozen(base) as HookEventContext;
  }

  private async dispatchContext(
    context: HookEventContext,
    signal: AbortSignal,
  ): Promise<HookDispatchResult> {
    if ((this.closed || this.closing) && context.event !== 'system_stop') {
      return { matched: 0, completed: 0 };
    }
    let matched = 0;
    let completed = 0;
    for (const rule of this.rules) {
      if (rule.event !== context.event || signal.aborted) continue;
      let conditionMatches = false;
      try {
        conditionMatches = rule.condition?.matches(context) ?? true;
      } catch (error) {
        this.logFailure(rule, context, {
          status: 'failed',
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (!conditionMatches) continue;
      matched += 1;
      if (rule.once && this.onceStates.has(rule.source.id)) continue;
      if (rule.once) this.onceStates.set(rule.source.id, 'running');

      if (rule.background) {
        const taskSignal = context.event === 'system_stop'
          ? signal
          : AbortSignal.any([signal, this.shutdown.signal]);
        let task: Promise<void>;
        task = this.runRule(rule, context, taskSignal)
          .then(result => this.handleResult(rule, context, result))
          .then(success => {
            if (rule.once) {
              if (success) this.onceStates.set(rule.source.id, 'completed');
              else this.onceStates.delete(rule.source.id);
            }
          })
          .catch(error => {
            if (rule.once) this.onceStates.delete(rule.source.id);
            this.logFailure(rule, context, {
              status: 'failed',
              code: 'INTERNAL_ERROR',
              message: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => this.backgroundTasks.delete(task));
        this.backgroundTasks.add(task);
        completed += 1;
        continue;
      }

      const actionSignal = context.event === 'system_stop'
        ? signal
        : AbortSignal.any([signal, this.shutdown.signal]);
      const result = await this.runRule(rule, context, actionSignal);
      const success = this.handleResult(rule, context, result);
      if (rule.once) {
        if (success) this.onceStates.set(rule.source.id, 'completed');
        else this.onceStates.delete(rule.source.id);
      }
      if (!success) continue;
      completed += 1;
      if (result.status === 'success' && result.decision?.decision === 'deny' &&
          (rule.action.type === 'command' || rule.action.type === 'http')) {
        return {
          matched,
          completed,
          denied: {
            reason: result.decision.reason,
            source: rule.source,
            actionType: rule.action.type,
          },
        };
      }
    }
    return { matched, completed };
  }

  private runRule(
    rule: CompiledHookRule,
    context: HookEventContext,
    signal: AbortSignal,
  ): Promise<HookActionResult> {
    return Promise.resolve()
      .then(() => this.executor.execute(rule, context, signal))
      .catch(error => ({
        status: 'failed' as const,
        code: 'INTERNAL_ERROR' as const,
        message: error instanceof Error ? error.message : String(error),
      }));
  }

  private handleResult(
    rule: CompiledHookRule,
    context: HookEventContext,
    result: HookActionResult,
  ): boolean {
    if (result.status === 'failed') {
      this.logFailure(rule, context, result);
      return false;
    }
    if (result.prompt?.trim()) {
      this.prompts.push({ id: ++this.promptSequence, content: limitText(result.prompt.trim()) });
    }
    return true;
  }

  private logFailure(
    rule: CompiledHookRule,
    context: HookEventContext,
    result: Extract<HookActionResult, { status: 'failed' }>,
  ): void {
    try {
      void this.logger.write({
        timestamp: new Date().toISOString(),
        level: result.code === 'NOT_IMPLEMENTED' ? 'warning' : 'error',
        source: rule.source,
        event: context.event,
        actionType: rule.action.type,
        code: result.code,
        message: result.message,
      });
    } catch {
      // 钩子日志器异常同样不能影响主流程。
    }
  }
}
