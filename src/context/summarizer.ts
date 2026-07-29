import type { LLMProvider, StreamEvent } from '../provider/types.js';
import { buildSummaryPrompt, parseSummaryResponse } from './summary-prompt.js';
import type { TokenEstimator } from './token-estimator.js';
import type {
  ContextManagerOptions,
  ContextTrigger,
  SummaryResult,
} from './types.js';

export class SummaryCancelledError extends Error {
  constructor() {
    super('上下文摘要已取消');
    this.name = 'SummaryCancelledError';
  }
}

export class ContextSummarizer {
  constructor(
    private readonly estimator: TokenEstimator,
    private readonly options: ContextManagerOptions,
  ) {}

  async summarize(
    provider: LLMProvider,
    source: readonly import('../provider/types.js').Message[],
    _trigger: ContextTrigger,
    signal: AbortSignal,
  ): Promise<SummaryResult> {
    if (signal.aborted) throw new SummaryCancelledError();
    const prompt = buildSummaryPrompt(source, this.options.summaryMaxOutputTokens);
    const estimate = this.estimator.estimateRequest(prompt.request).tokens;
    if (estimate >= provider.contextWindow - this.options.manualReserveTokens) {
      throw new Error(`摘要请求估算 ${estimate} Token，超过可用上下文容量`);
    }

    let text = '';
    let sawDone = false;
    let streamError: string | undefined;
    let receivedToolCall = false;
    try {
      await provider.chat(prompt.request, (event: StreamEvent) => {
        if (streamError || sawDone) return;
        switch (event.type) {
          case 'text_delta':
            text += event.content;
            break;
          case 'tool_call':
            receivedToolCall = true;
            break;
          case 'error':
            streamError = event.content;
            break;
          case 'done':
            sawDone = true;
            break;
          case 'thinking_delta':
          case 'usage':
            break;
        }
      }, signal);
    } catch (error) {
      if (signal.aborted) throw new SummaryCancelledError();
      throw new Error(`摘要请求失败: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (signal.aborted) throw new SummaryCancelledError();
    if (receivedToolCall) throw new Error('摘要模型返回了禁止的工具调用');
    if (streamError) throw new Error(`摘要响应流错误: ${streamError}`);
    if (!sawDone) throw new Error('摘要响应流提前结束');
    const parsed = parseSummaryResponse(text, prompt.nonce);
    return { summary: parsed.summary, sourceMessageCount: source.length };
  }
}
