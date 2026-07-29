import assert from 'node:assert/strict';
import test from 'node:test';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { CONTEXT_SUMMARY_HEADINGS, resolveContextOptions } from './constants.js';
import { ContextSummarizer, SummaryCancelledError } from './summarizer.js';
import { TokenEstimator } from './token-estimator.js';

function summaryFor(request: ProviderRequest): string {
  const content = request.messages[0]?.content ?? '';
  const nonce = /<context-source id="([^"]+)">/.exec(content)?.[1];
  assert.ok(nonce);
  const sections = CONTEXT_SUMMARY_HEADINGS.map(heading => `## ${heading}\n无`).join('\n');
  return `<context-draft id="${nonce}">草稿秘密</context-draft>` +
    `<context-summary id="${nonce}">${sections}</context-summary>`;
}

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly contextWindow: number;
  readonly contextWindowIsDefault = false;
  requests: ProviderRequest[] = [];

  constructor(
    private readonly handler: (request: ProviderRequest, emit: (event: StreamEvent) => void, signal?: AbortSignal) => Promise<void> | void,
    contextWindow = 20_000,
  ) {
    this.contextWindow = contextWindow;
  }

  async chat(request: ProviderRequest, emit: (event: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
    this.requests.push(request);
    await this.handler(request, emit, signal);
  }
}

function summarizer(): ContextSummarizer {
  return new ContextSummarizer(new TokenEstimator(), resolveContextOptions());
}

test('摘要成功路径丢弃 thinking、usage 和草稿', async () => {
  const provider = new FakeProvider((request, emit) => {
    const response = summaryFor(request);
    emit({ type: 'thinking_delta', content: '不可见思考' });
    emit({ type: 'usage', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } });
    emit({ type: 'text_delta', content: response.slice(0, 30) });
    emit({ type: 'text_delta', content: response.slice(30) });
    emit({ type: 'done', content: '' });
  });
  const result = await summarizer().summarize(
    provider,
    [{ role: 'assistant', content: '旧回答' }],
    'automatic',
    new AbortController().signal,
  );
  assert.equal(result.sourceMessageCount, 1);
  assert.doesNotMatch(result.summary, /草稿秘密|不可见思考/);
  assert.deepEqual(provider.requests[0].tools, []);
  assert.equal(provider.requests[0].maxOutputTokens, 2_048);
});

test('摘要拒绝流错误、缺 done、工具调用和非法格式', async () => {
  const cases: Array<[FakeProvider, RegExp]> = [
    [new FakeProvider((_request, emit) => emit({ type: 'error', content: '连接断开' })), /流错误/],
    [new FakeProvider((_request, emit) => emit({ type: 'text_delta', content: '部分' })), /提前结束/],
    [new FakeProvider((_request, emit) => {
      emit({ type: 'tool_call', call: { id: 'one', name: 'bash', arguments: {} } });
      emit({ type: 'done', content: '' });
    }), /禁止的工具调用/],
    [new FakeProvider((_request, emit) => {
      emit({ type: 'text_delta', content: '非法格式' });
      emit({ type: 'done', content: '' });
    }), /缺少草稿或正式摘要/],
  ];
  for (const [provider, pattern] of cases) {
    await assert.rejects(
      summarizer().summarize(provider, [{ role: 'assistant', content: '旧回答' }], 'automatic', new AbortController().signal),
      pattern,
    );
  }
});

test('摘要取消和请求容量不足不会返回部分文本', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    summarizer().summarize(
      new FakeProvider(() => undefined),
      [{ role: 'assistant', content: '旧回答' }],
      'manual',
      controller.signal,
    ),
    SummaryCancelledError,
  );

  await assert.rejects(
    summarizer().summarize(
      new FakeProvider(() => undefined, 100),
      [{ role: 'assistant', content: 'x'.repeat(1_000) }],
      'manual',
      new AbortController().signal,
    ),
    /超过可用上下文容量/,
  );
});
