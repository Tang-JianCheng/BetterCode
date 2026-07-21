import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  LLMProvider,
  Message,
  StreamEvent,
  ToolDefinition,
} from '../provider/types.js';
import type { AgentEvent } from './types.js';
import { StreamCollector } from './stream-collector.js';

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';

  constructor(
    private readonly run: (
      onEvent: (event: StreamEvent) => void,
      signal?: AbortSignal,
    ) => Promise<void>,
  ) {}

  async chat(
    _messages: Message[],
    _tools: ToolDefinition[],
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.run(onEvent, signal);
  }
}

function collectWith(
  provider: LLMProvider,
  signal: AbortSignal = new AbortController().signal,
) {
  const events: AgentEvent[] = [];
  const result = new StreamCollector().collect(
    provider,
    [{ role: 'user', content: 'test' }],
    [],
    2,
    signal,
    event => events.push(event),
  );
  return { events, result };
}

test('collector forwards deltas while collecting a complete response', async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const provider = new FakeProvider(async emit => {
    emit({ type: 'thinking_delta', content: 'think ' });
    emit({ type: 'text_delta', content: 'hello ' });
    await gate;
    emit({ type: 'text_delta', content: 'world' });
    emit({
      type: 'tool_call',
      call: { id: 'one', name: 'read_file', arguments: { path: 'a.txt' } },
    });
    emit({
      type: 'tool_call',
      call: { id: 'two', name: 'find_files', arguments: { pattern: '*.ts' } },
    });
    emit({
      type: 'usage',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    emit({ type: 'done', content: '' });
  });

  const { events, result } = collectWith(provider);
  await Promise.resolve();
  assert.deepEqual(events.map(event => event.type), ['thinking_delta', 'text_delta']);
  release?.();

  const turn = await result;
  assert.equal(turn.status, 'completed');
  assert.equal(turn.text, 'hello world');
  assert.equal(turn.thinking, 'think ');
  assert.deepEqual(turn.toolCalls.map(call => call.id), ['one', 'two']);
  assert.deepEqual(turn.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  assert.ok(events.every(event => 'iteration' in event && event.iteration === 2));
});

test('collector classifies provider errors, thrown failures and missing done', async () => {
  const explicit = collectWith(new FakeProvider(async emit => {
    emit({ type: 'error', content: 'bad stream' });
  }));
  assert.deepEqual(await explicit.result, {
    text: '',
    thinking: '',
    toolCalls: [],
    usage: undefined,
    status: 'stream_error',
    error: 'bad stream',
  });

  const thrown = collectWith(new FakeProvider(async () => {
    throw new Error('broken');
  }));
  assert.equal((await thrown.result).error, 'broken');

  const incomplete = collectWith(new FakeProvider(async emit => {
    emit({ type: 'text_delta', content: 'partial' });
  }));
  assert.equal((await incomplete.result).error, '模型响应流提前结束');
});

test('collector gives cancellation priority over an incomplete stream', async () => {
  const controller = new AbortController();
  const provider = new FakeProvider(async (emit, signal) => {
    emit({
      type: 'tool_call',
      call: { id: 'one', name: 'read_file', arguments: { path: 'a.txt' } },
    });
    await new Promise<void>(resolve => {
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  });
  const { result } = collectWith(provider, controller.signal);
  await Promise.resolve();
  controller.abort();

  const turn = await result;
  assert.equal(turn.status, 'cancelled');
  assert.equal(turn.toolCalls.length, 1);
});
