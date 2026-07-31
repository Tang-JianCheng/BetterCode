import { executeHookCommand } from './command-executor.js';
import { executeHookHttp } from './http-executor.js';
import type {
  HookActionExecutor as HookActionExecutorContract,
  HookActionResult,
  HookDecision,
  HookEventContext,
  CompiledHookRule,
} from './types.js';

function parseDecision(output: string | undefined): HookDecision {
  if (!output?.trim()) throw new Error('执行前 Hook 没有返回决定');
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    throw new Error('执行前 Hook 返回的决定不是合法 JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('执行前 Hook 决定必须是对象');
  }
  const value = raw as Record<string, unknown>;
  const unknown = Object.keys(value).filter(key => key !== 'decision' && key !== 'reason');
  if (unknown.length) throw new Error(`执行前 Hook 决定包含未知字段: ${unknown.join(', ')}`);
  if (value.decision === 'allow') {
    if (value.reason !== undefined && value.reason !== '') throw new Error('allow 决定不能包含拒绝原因');
    return { decision: 'allow' };
  }
  if (value.decision === 'deny') {
    if (typeof value.reason !== 'string' || !value.reason.trim()) throw new Error('deny 决定必须包含拒绝原因');
    const reason = value.reason.replace(/[\r\n\t\u0000-\u001F\u007F]+/gu, ' ').trim().slice(0, 500);
    return { decision: 'deny', reason };
  }
  throw new Error('执行前 Hook decision 必须是 allow 或 deny');
}

export class DefaultHookActionExecutor implements HookActionExecutorContract {
  constructor(private readonly rootDir: string) {}

  async execute(
    rule: CompiledHookRule,
    context: HookEventContext,
    signal: AbortSignal,
  ): Promise<HookActionResult> {
    try {
      if (rule.action.type === 'prompt') {
        return { status: 'success', prompt: rule.action.prompt.render(context) };
      }
      if (rule.action.type === 'agent') {
        rule.action.prompt.render(context);
        return { status: 'failed', code: 'NOT_IMPLEMENTED', message: '子 Agent Hook 动作尚未实现' };
      }
      const result = rule.action.type === 'command'
        ? await executeHookCommand({
            command: rule.action.command,
            rootDir: this.rootDir,
            context,
            timeoutMs: rule.timeoutMs,
            signal,
          })
        : await executeHookHttp({
            rule: rule as CompiledHookRule & {
              action: Extract<CompiledHookRule['action'], { type: 'http' }>;
            },
            context,
            signal,
          });
      if (result.status === 'failed' || context.event !== 'pre_tool_use') return result;
      try {
        if (result.truncated) throw new Error('执行前 Hook 决定超过输出上限');
        return { ...result, decision: parseDecision(result.output) };
      } catch (error) {
        return {
          status: 'failed',
          code: 'INVALID_DECISION',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    } catch (error) {
      return {
        status: 'failed',
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
