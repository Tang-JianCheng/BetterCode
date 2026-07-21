import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAIProvider } from './openai.js';
import type { Message, StreamEvent } from './types.js';

function config() {
  return {
    name: 'test-openai',
    protocol: 'openai' as const,
    model: 'test-model',
    base_url: 'https://example.test/v1',
    api_key: 'test-key',
  };
}

function responseFor(lines: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

test('OpenAI provider maps tools and aggregates fragmented tool calls', async () => {
  let request: Record<string, unknown> | undefined;
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return responseFor([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"{\\"path\\":\\"a"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":".txt\\"}"}}]}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ]);
  };
  const provider = new OpenAIProvider(config(), fetchImpl);
  const events: StreamEvent[] = [];
  await provider.chat(
    [{ role: 'user', content: 'read a.txt' }],
    [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
    event => events.push(event),
  );

  const bodyTools = request?.tools as Array<{ function: { name: string; parameters: unknown } }>;
  assert.equal(bodyTools[0].function.name, 'read_file');
  assert.deepEqual(request?.stream_options, { include_usage: true });
  const call = events.find(event => event.type === 'tool_call');
  assert.ok(call && call.type === 'tool_call');
  assert.equal(call.call.id, 'call-1');
  assert.equal(call.call.name, 'read_file');
  assert.deepEqual(call.call.arguments, { path: 'a.txt' });
  assert.equal(events.filter(event => event.type === 'tool_call').length, 1);
  const usage = events.find(event => event.type === 'usage');
  assert.ok(usage && usage.type === 'usage');
  assert.deepEqual(usage.usage, { inputTokens: 12, outputTokens: 3, totalTokens: 15 });
  assert.equal(events.at(-1)?.type, 'done');
});

test('OpenAI provider maps assistant tool calls and tool results', async () => {
  let request: Record<string, unknown> | undefined;
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return responseFor([
      'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
  };
  const provider = new OpenAIProvider(config(), fetchImpl);
  const messages: Message[] = [
    { role: 'user', content: 'read' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-1', name: 'read_file', arguments: { path: 'a.txt' } }],
    },
    { role: 'tool', toolCallId: 'call-1', toolName: 'read_file', content: '{"ok":true}', isError: false },
  ];
  await provider.chat(messages, [], () => undefined);
  const mapped = request?.messages as Array<Record<string, unknown>>;
  assert.deepEqual(mapped[1].tool_calls, [{
    id: 'call-1',
    type: 'function',
    function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
  }]);
  assert.deepEqual(mapped[2], { role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' });
  assert.equal('tools' in (request ?? {}), false);
});

test('OpenAI provider preserves multiple tool calls in model order', async () => {
  const provider = new OpenAIProvider(config(), async () => responseFor([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"one","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.txt\\"}"}},{"index":1,"id":"two","function":{"name":"find_files","arguments":"{\\"pattern\\":\\"*.ts\\"}"}}]}}]}\n\n',
    'data: [DONE]\n\n',
  ]));
  const events: StreamEvent[] = [];
  await provider.chat([], [], event => events.push(event));
  const calls = events.filter(event => event.type === 'tool_call');

  assert.deepEqual(calls.map(event => event.type === 'tool_call' ? event.call.id : ''), ['one', 'two']);
});

test('OpenAI provider rejects malformed and incomplete streams without done', async () => {
  const malformed = new OpenAIProvider(config(), async () => responseFor([
    'data: {not-json}\n\n',
  ]));
  const malformedEvents: StreamEvent[] = [];
  await malformed.chat([], [], event => malformedEvents.push(event));
  assert.equal(malformedEvents.at(-1)?.type, 'error');
  assert.equal(malformedEvents.some(event => event.type === 'done'), false);

  const incomplete = new OpenAIProvider(config(), async () => responseFor([
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
  ]));
  const incompleteEvents: StreamEvent[] = [];
  await incomplete.chat([], [], event => incompleteEvents.push(event));
  assert.equal(incompleteEvents.at(-1)?.type, 'error');
  assert.equal(incompleteEvents.some(event => event.type === 'done'), false);
});

test('OpenAI provider treats abort as cancellation rather than a stream error', async () => {
  const controller = new AbortController();
  const provider = new OpenAIProvider(config(), async () => {
    controller.abort();
    throw new DOMException('cancelled', 'AbortError');
  });
  const events: StreamEvent[] = [];
  await provider.chat([], [], event => events.push(event), controller.signal);
  assert.deepEqual(events, []);
});
