import type { Message, ProviderRequest, TokenUsage } from '../provider/types.js';
import { resolveContextOptions } from './constants.js';
import { HistoryPlanner } from './history-planner.js';
import { LightweightCompactor } from './lightweight-compactor.js';
import { ContextSummarizer, SummaryCancelledError } from './summarizer.js';
import { TokenEstimator } from './token-estimator.js';
import { ToolResultStore } from './tool-result-store.js';
import type {
  ContextErrorCode,
  ContextManageInput,
  ContextManageResult,
  ContextManagerOptions,
  ContextStatus,
} from './types.js';

export class ContextManager {
  private readonly options: ContextManagerOptions;
  private readonly estimator = new TokenEstimator();
  private readonly store: ToolResultStore;
  private readonly lightweight: LightweightCompactor;
  private readonly planner: HistoryPlanner;
  private readonly summarizer: ContextSummarizer;
  private queue: Promise<void> = Promise.resolve();
  private consecutiveSummaryFailures = 0;
  private circuitOpen = false;
  private offloadedResults = 0;
  private estimatedTokens?: number;
  private closed = false;

  constructor(rootDir: string, options: Partial<ContextManagerOptions> = {}) {
    this.options = resolveContextOptions(options);
    this.store = new ToolResultStore(rootDir);
    this.lightweight = new LightweightCompactor(this.estimator, this.store, this.options);
    this.planner = new HistoryPlanner(this.estimator, this.options);
    this.summarizer = new ContextSummarizer(this.estimator, this.options);
  }

  manage(input: ContextManageInput): Promise<ContextManageResult> {
    return this.exclusive(() => this.manageUnlocked(input));
  }

  recordUsage(request: ProviderRequest, usage?: TokenUsage): void {
    if (usage) this.estimator.recordUsage(request, usage.inputTokens);
  }

  getStatus(): ContextStatus {
    return {
      ...(this.estimatedTokens === undefined ? {} : { estimatedTokens: this.estimatedTokens }),
      consecutiveSummaryFailures: this.consecutiveSummaryFailures,
      circuitOpen: this.circuitOpen,
      offloadedResults: this.offloadedResults,
    };
  }

  clear(): Promise<void> {
    return this.exclusive(async () => {
      await this.store.clear();
      this.estimator.reset();
      this.consecutiveSummaryFailures = 0;
      this.circuitOpen = false;
      this.offloadedResults = 0;
      this.estimatedTokens = undefined;
    });
  }

  close(): Promise<void> {
    return this.exclusive(async () => {
      if (this.closed) return;
      await this.store.close();
      this.estimator.reset();
      this.closed = true;
    });
  }

  private async manageUnlocked(input: ContextManageInput): Promise<ContextManageResult> {
    if (input.signal.aborted) return { status: 'cancelled', history: [...input.history] };
    if (this.closed) {
      return this.blocked(input, [...input.history], 'CONTEXT_HISTORY_INVALID', '上下文管理器已关闭', 0);
    }
    input.emit({
      type: 'context_progress',
      iteration: input.iteration,
      trigger: input.trigger,
      stage: 'lightweight',
      contextWindow: input.provider.contextWindow,
    });
    const light = await this.lightweight.compact(input.history, input.signal);
    if (input.signal.aborted) return { status: 'cancelled', history: light.history };
    if (light.offloadedCount > 0) {
      this.offloadedResults += light.offloadedCount;
      input.emit({
        type: 'context_offloaded',
        iteration: input.iteration,
        trigger: input.trigger,
        count: light.offloadedCount,
      });
    }
    if (light.failed) {
      input.emit({
        type: 'context_failed',
        iteration: input.iteration,
        trigger: input.trigger,
        code: 'CONTEXT_STORAGE_FAILED',
        message: light.failed,
        consecutiveFailures: this.consecutiveSummaryFailures,
        circuitOpen: this.circuitOpen,
      });
    }

    const request = this.buildRequest(input, light.history);
    input.emit({
      type: 'context_progress',
      iteration: input.iteration,
      trigger: input.trigger,
      stage: 'estimating',
      contextWindow: input.provider.contextWindow,
    });
    const beforeTokens = this.estimator.estimateRequest(request).tokens;
    this.estimatedTokens = beforeTokens;
    input.emit({
      type: 'context_progress',
      iteration: input.iteration,
      trigger: input.trigger,
      stage: 'estimating',
      estimatedTokens: beforeTokens,
      contextWindow: input.provider.contextWindow,
    });
    const automaticLimit = input.provider.contextWindow - this.options.automaticReserveTokens;
    if (input.trigger === 'automatic' && beforeTokens < automaticLimit) {
      return {
        status: 'ready',
        history: light.history,
        request,
        beforeTokens,
        afterTokens: beforeTokens,
        offloadedResults: light.offloadedCount,
        summarizedMessages: 0,
      };
    }
    if (input.trigger === 'automatic' && this.circuitOpen) {
      return this.blocked(
        input,
        light.history,
        'CONTEXT_CIRCUIT_OPEN',
        '上下文摘要已连续失败 3 次，请使用 /compact 重试或 /clear 清空会话',
        beforeTokens,
      );
    }

    let plan;
    try {
      plan = this.planner.createPlan(light.history);
    } catch (error) {
      return this.blocked(
        input,
        light.history,
        'CONTEXT_HISTORY_INVALID',
        error instanceof Error ? error.message : String(error),
        beforeTokens,
      );
    }
    if (!plan) {
      if (input.trigger === 'manual') {
        return {
          status: 'skipped',
          history: light.history,
          reason: 'nothing_to_compact',
          estimatedTokens: beforeTokens,
          offloadedResults: light.offloadedCount,
        };
      }
      return this.blocked(
        input,
        light.history,
        'CONTEXT_CAPACITY_EXCEEDED',
        '上下文已接近窗口上限，但没有足够的较早模型消息可压缩',
        beforeTokens,
      );
    }

    input.emit({
      type: 'context_progress',
      iteration: input.iteration,
      trigger: input.trigger,
      stage: 'summarizing',
      estimatedTokens: beforeTokens,
      contextWindow: input.provider.contextWindow,
    });
    try {
      const summary = await this.summarizer.summarize(
        input.provider,
        plan.sourceMessages,
        input.trigger,
        input.signal,
      );
      if (input.signal.aborted) return { status: 'cancelled', history: light.history };
      input.emit({
        type: 'context_progress',
        iteration: input.iteration,
        trigger: input.trigger,
        stage: 'validating',
        contextWindow: input.provider.contextWindow,
      });
      const history = this.planner.applySummary(light.history, plan, summary.summary);
      this.estimator.invalidate();
      const compressedRequest = this.buildRequest(input, history);
      const afterTokens = this.estimator.estimateRequest(compressedRequest).tokens;
      this.estimatedTokens = afterTokens;
      this.consecutiveSummaryFailures = 0;
      this.circuitOpen = false;
      input.emit({
        type: 'context_compacted',
        iteration: input.iteration,
        trigger: input.trigger,
        beforeTokens,
        afterTokens,
        summarizedMessages: plan.summarizedMessageCount,
        offloadedResults: light.offloadedCount,
        consecutiveFailures: 0,
        circuitOpen: false,
      });
      if (input.trigger === 'automatic' && afterTokens >= automaticLimit) {
        return this.blocked(
          input,
          history,
          'CONTEXT_CAPACITY_EXCEEDED',
          '上下文摘要已完成，但用户原文或固定请求内容仍超过安全容量',
          afterTokens,
        );
      }
      return {
        status: 'ready',
        history,
        request: compressedRequest,
        beforeTokens,
        afterTokens,
        offloadedResults: light.offloadedCount,
        summarizedMessages: plan.summarizedMessageCount,
      };
    } catch (error) {
      if (error instanceof SummaryCancelledError || input.signal.aborted) {
        return { status: 'cancelled', history: light.history };
      }
      this.consecutiveSummaryFailures += 1;
      if (this.consecutiveSummaryFailures >= this.options.summaryFailureLimit) {
        this.circuitOpen = true;
      }
      return this.blocked(
        input,
        light.history,
        'CONTEXT_SUMMARY_FAILED',
        error instanceof Error ? error.message : String(error),
        beforeTokens,
      );
    }
  }

  private buildRequest(input: ContextManageInput, history: readonly Message[]): ProviderRequest {
    return {
      systemPrompt: input.systemPrompt,
      messages: [...history, ...input.runtimeMessages],
      tools: [...input.tools],
    };
  }

  private blocked(
    input: ContextManageInput,
    history: Message[],
    code: ContextErrorCode,
    message: string,
    estimatedTokens: number,
  ): ContextManageResult {
    input.emit({
      type: 'context_failed',
      iteration: input.iteration,
      trigger: input.trigger,
      code,
      message,
      consecutiveFailures: this.consecutiveSummaryFailures,
      circuitOpen: this.circuitOpen,
    });
    return { status: 'blocked', history, code, message, estimatedTokens };
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const previous = this.queue;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }
}
