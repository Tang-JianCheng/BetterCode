import { ToolRegistry } from '../tool/registry.js';
import {
  createToolError,
  type ToolCall,
  type ToolResult,
} from '../tool/types.js';
import type { AgentEvent, AgentMode } from './types.js';

export interface ScheduledToolResult {
  call: ToolCall;
  result: ToolResult;
}

export interface ToolBatchResult {
  results: ScheduledToolResult[];
  unknownToolStreak: number;
  unknownToolLimitReached: boolean;
  cancelled: boolean;
}

export interface ToolScheduleOptions {
  mode: AgentMode;
  initialUnknownToolStreak: number;
  unknownToolLimit: number;
  maxIterations: number;
  signal: AbortSignal;
  onProgress: (event: AgentEvent) => void;
}

interface IndexedCall {
  index: number;
  call: ToolCall;
}

const cancelledResult = (message: string): ToolResult =>
  createToolError('CANCELLED', message, { cancelled: true });

export class ToolScheduler {
  constructor(private readonly registry: ToolRegistry) {}

  async executeBatch(
    calls: ToolCall[],
    iteration: number,
    options: ToolScheduleOptions,
  ): Promise<ToolBatchResult> {
    const results = new Map<number, ToolResult>();
    const readOnly: IndexedCall[] = [];
    const sideEffects: IndexedCall[] = [];
    let unknownToolStreak = options.initialUnknownToolStreak;
    let unknownToolLimitReached = false;

    for (const [index, call] of calls.entries()) {
      if (unknownToolLimitReached) {
        results.set(index, cancelledResult('连续未知工具已达到上限，未执行该调用'));
        continue;
      }

      const effect = this.registry.effectOf(call.name);
      if (effect === undefined) {
        results.set(index, createToolError('TOOL_NOT_FOUND', `未找到工具: ${call.name}`));
        unknownToolStreak += 1;
      } else if (options.mode === 'plan' && effect === 'side_effect') {
        results.set(index, createToolError(
          'TOOL_UNAVAILABLE',
          `Plan Mode 不允许使用工具: ${call.name}`,
        ));
        unknownToolStreak += 1;
      } else {
        unknownToolStreak = 0;
        (effect === 'read_only' ? readOnly : sideEffects).push({ index, call });
      }

      if (unknownToolStreak >= options.unknownToolLimit) {
        unknownToolLimitReached = true;
      }
    }

    const execute = async ({ index, call }: IndexedCall): Promise<void> => {
      if (options.signal.aborted) {
        results.set(index, cancelledResult('工具执行已由用户取消'));
        return;
      }
      options.onProgress({
        type: 'progress',
        iteration,
        maxIterations: options.maxIterations,
        stage: 'executing_tools',
        toolName: call.name,
        toolCallId: call.id,
      });
      const result = await this.registry.execute(call, options.signal);
      results.set(index, result);
    };

    await Promise.all(readOnly.map(execute));

    for (const indexedCall of sideEffects) {
      if (options.signal.aborted) {
        results.set(indexedCall.index, cancelledResult('工具执行已由用户取消'));
        continue;
      }
      await execute(indexedCall);
    }

    for (const [index] of calls.entries()) {
      if (!results.has(index)) {
        results.set(index, cancelledResult('工具执行已由用户取消'));
      }
    }

    return {
      results: calls.map((call, index) => ({ call, result: results.get(index)! })),
      unknownToolStreak,
      unknownToolLimitReached,
      cancelled: options.signal.aborted,
    };
  }
}
