import type { Message } from '../provider/types.js';
import type { TokenEstimator } from './token-estimator.js';
import type {
  CompactionPlan,
  ContextManagerOptions,
  HistoryUnit,
} from './types.js';
import {
  buildContextBoundaryMessage,
  buildContextSummaryMessage,
} from './summary-prompt.js';

export function groupHistory(
  history: readonly Message[],
  estimator: TokenEstimator,
): HistoryUnit[] {
  const units: HistoryUnit[] = [];
  for (let index = 0; index < history.length;) {
    const message = history[index];
    if (message.role === 'tool') throw new Error(`发现孤立工具结果: ${message.toolCallId}`);
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      units.push({
        start: index,
        endExclusive: index + 1,
        messages: [message],
        estimatedTokens: estimator.estimateMessage(message),
        kind: 'single',
      });
      index += 1;
      continue;
    }

    const messages: Message[] = [message];
    for (const call of message.toolCalls) {
      const result = history[index + messages.length];
      if (result?.role !== 'tool' || result.toolCallId !== call.id) {
        throw new Error(`工具调用缺少顺序匹配的结果: ${call.id}`);
      }
      messages.push(result);
    }
    const ids = new Set(message.toolCalls.map(call => call.id));
    if (ids.size !== message.toolCalls.length) throw new Error('工具调用标识重复');
    units.push({
      start: index,
      endExclusive: index + messages.length,
      messages,
      estimatedTokens: messages.reduce((sum, item) => sum + estimator.estimateMessage(item), 0),
      kind: 'tool_batch',
    });
    index += messages.length;
  }
  return units;
}

function users(history: readonly Message[]): string[] {
  return history.filter(message => message.role === 'user').map(message => message.content);
}

export class HistoryPlanner {
  constructor(
    private readonly estimator: TokenEstimator,
    private readonly options: ContextManagerOptions,
  ) {}

  createPlan(history: readonly Message[]): CompactionPlan | undefined {
    const units = groupHistory(history, this.estimator);
    let tokens = 0;
    let messages = 0;
    let boundary = units.length;
    while (boundary > 0 &&
           (tokens < this.options.recentHistoryTokens ||
            messages < this.options.recentHistoryMessages)) {
      const unit = units[boundary - 1];
      tokens += unit.estimatedTokens;
      messages += unit.messages.length;
      boundary -= 1;
    }
    if (boundary === 0) return undefined;
    const sourceMessages = units.slice(0, boundary).flatMap(unit => unit.messages);
    const hasCompressible = sourceMessages.some(message => message.role !== 'user');
    if (!hasCompressible) return undefined;
    return {
      sourceMessages: [...sourceMessages],
      preservedUserMessages: sourceMessages.filter(message => message.role === 'user'),
      recentMessages: units.slice(boundary).flatMap(unit => unit.messages),
      summarizedMessageCount: sourceMessages.filter(message => message.role !== 'user').length,
    };
  }

  applySummary(
    original: readonly Message[],
    plan: CompactionPlan,
    summary: string,
  ): Message[] {
    const recent = plan.recentMessages.filter(message =>
      message.role !== 'instruction' ||
      (message.instructionKind !== 'context_summary' &&
       message.instructionKind !== 'context_boundary' &&
       message.instructionKind !== 'runtime'));
    const result = [
      ...plan.preservedUserMessages,
      buildContextSummaryMessage(summary),
      buildContextBoundaryMessage(),
      ...recent,
    ];
    this.validate(result);
    const beforeUsers = users(original);
    const afterUsers = users(result);
    if (beforeUsers.length !== afterUsers.length ||
        beforeUsers.some((value, index) => value !== afterUsers[index])) {
      throw new Error('上下文压缩改变了用户原始消息');
    }
    return result;
  }

  validate(history: readonly Message[]): void {
    groupHistory(history, this.estimator);
    const summaries = history.filter(message =>
      message.role === 'instruction' && message.instructionKind === 'context_summary');
    const boundaries = history.filter(message =>
      message.role === 'instruction' && message.instructionKind === 'context_boundary');
    if (summaries.length > 1 || boundaries.length > 1) {
      throw new Error('历史中存在重复上下文摘要或边界');
    }
    if (summaries.length !== boundaries.length) throw new Error('上下文摘要和边界不完整');
    if (summaries.length === 1) {
      const summaryIndex = history.indexOf(summaries[0]);
      if (history[summaryIndex + 1] !== boundaries[0]) throw new Error('上下文边界必须紧跟摘要');
    }
  }
}
