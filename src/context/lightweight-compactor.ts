import type { Message } from '../provider/types.js';
import { groupHistory } from './history-planner.js';
import type { TokenEstimator } from './token-estimator.js';
import type { ToolResultStore } from './tool-result-store.js';
import type {
  ContextManagerOptions,
  LightweightResult,
} from './types.js';

interface Candidate {
  index: number;
  order: number;
  message: Extract<Message, { role: 'tool' }>;
  tokens: number;
}

function boundedPreview(
  content: string,
  estimator: TokenEstimator,
  budget: number,
): { head: string; tail: string } {
  if (estimator.estimateText(content) <= budget) return { head: content, tail: '' };
  let size = Math.min(content.length, budget * 2);
  let head = content.slice(0, Math.ceil(size / 2));
  let tail = content.slice(-Math.floor(size / 2));
  while (size > 0 && estimator.estimateText(`${head}\n${tail}`) > budget) {
    size = Math.floor(size * 0.85);
    head = content.slice(0, Math.ceil(size / 2));
    tail = content.slice(-Math.floor(size / 2));
  }
  return { head, tail };
}

export class LightweightCompactor {
  constructor(
    private readonly estimator: TokenEstimator,
    private readonly store: ToolResultStore,
    private readonly options: ContextManagerOptions,
  ) {}

  async compact(
    history: readonly Message[],
    signal: AbortSignal,
  ): Promise<LightweightResult> {
    const units = groupHistory(history, this.estimator);
    const candidates: Candidate[] = [];
    let order = 0;
    for (const unit of units) {
      if (unit.kind !== 'tool_batch') continue;
      for (let offset = 1; offset < unit.messages.length; offset += 1) {
        const message = unit.messages[offset];
        if (message.role !== 'tool' || message.contextReference) continue;
        candidates.push({
          index: unit.start + offset,
          order: order++,
          message,
          tokens: this.estimator.estimateMessage(message),
        });
      }
    }

    const selected = new Set<number>(
      candidates
        .filter(candidate => candidate.tokens > this.options.singleToolResultTokens)
        .map(candidate => candidate.index),
    );
    const replacementEstimate = this.options.toolPreviewTokens + 256;
    for (const unit of units) {
      if (unit.kind !== 'tool_batch') continue;
      const batch = candidates.filter(candidate =>
        candidate.index > unit.start && candidate.index < unit.endExclusive);
      let total = batch.reduce((sum, candidate) =>
        sum + (selected.has(candidate.index) ? replacementEstimate : candidate.tokens), 0);
      if (total <= this.options.toolBatchTokens) continue;
      const remaining = batch
        .filter(candidate =>
          !selected.has(candidate.index) && candidate.tokens > replacementEstimate)
        .sort((left, right) => right.tokens - left.tokens || left.order - right.order);
      for (const candidate of remaining) {
        selected.add(candidate.index);
        total += replacementEstimate - candidate.tokens;
        if (total <= this.options.toolBatchTokens) break;
      }
    }
    if (selected.size === 0) return { history: [...history], offloadedCount: 0 };

    const chosen = candidates
      .filter(candidate => selected.has(candidate.index))
      .sort((left, right) => left.index - right.index);
    try {
      const stored = await this.store.writeBatch(chosen.map(candidate => ({
        toolCallId: candidate.message.toolCallId,
        toolName: candidate.message.toolName,
        content: candidate.message.content,
      })), signal);
      const result = [...history];
      chosen.forEach((candidate, index) => {
        const reference = stored[index];
        const preview = boundedPreview(
          candidate.message.content,
          this.estimator,
          this.options.toolPreviewTokens,
        );
        const content = [
          '[BetterCode 上下文管理：工具结果已落盘]',
          `工具: ${candidate.message.toolName}`,
          `调用标识: ${candidate.message.toolCallId}`,
          `相对路径: ${reference.relativePath}`,
          `原始字节数: ${reference.originalBytes}`,
          `估算 Token: ${candidate.tokens}`,
          `SHA-256: ${reference.sha256}`,
          '--- 开头预览 ---',
          preview.head,
          ...(preview.tail ? ['--- 结尾预览 ---', preview.tail] : []),
        ].join('\n');
        result[candidate.index] = {
          ...candidate.message,
          content,
          contextReference: {
            kind: 'offloaded_tool_result',
            relativePath: reference.relativePath,
            originalBytes: reference.originalBytes,
            estimatedTokens: candidate.tokens,
            sha256: reference.sha256,
          },
        };
      });
      return { history: result, offloadedCount: chosen.length };
    } catch (error) {
      return {
        history: [...history],
        offloadedCount: 0,
        failed: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
