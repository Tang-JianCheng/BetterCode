import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAIProvider } from './openai.js';
import type {
  Message,
  ProviderRequest,
  StreamEvent,
  TokenUsage,
  ToolDefinition,
} from './types.js';

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

function makeRequest(
  messages: Message[] = [],
  tools: ToolDefinition[] = [],
  systemPrompt = 'stable system',
): ProviderRequest {
  return { systemPrompt, messages, tools };
}

test('OpenAI provider maps tools and aggregates fragmented tool calls', async () => {
  let request: Record<string, unknown> | undefined;
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return responseFor([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"{\\"path\\":\\"a"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":".txt\\"}"}}]}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15,"prompt_tokens_details":{"cached_tokens":7}}}\n\n',
      'data: [DONE]\n\n',
    ]);
  };
  const provider = new OpenAIProvider(config(), fetchImpl);
  const events: StreamEvent[] = [];
  await provider.chat(
    makeRequest(
      [{ role: 'user', content: 'read a.txt' }],
      [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
    ),
    event => events.push(event),
  );

  const bodyTools = request?.tools as Array<{ function: { name: string; parameters: unknown } }>;
  assert.equal(bodyTools[0].function.name, 'read_file');
  const bodyMessages = request?.messages as Array<Record<string, unknown>>;
  assert.deepEqual(bodyMessages[0], { role: 'system', content: 'stable system' });
  assert.deepEqual(request?.stream_options, { include_usage: true });
  const call = events.find(event => event.type === 'tool_call');
  assert.ok(call && call.type === 'tool_call');
  assert.equal(call.call.id, 'call-1');
  assert.equal(call.call.name, 'read_file');
  assert.deepEqual(call.call.arguments, { path: 'a.txt' });
  assert.equal(events.filter(event => event.type === 'tool_call').length, 1);
  const usage = events.find(event => event.type === 'usage');
  assert.ok(usage && usage.type === 'usage');
  assert.deepEqual(usage.usage, {
    inputTokens: 12,
    outputTokens: 3,
    totalTokens: 15,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 7,
  });
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
      toolCalls: [
        { id: 'call-1', name: 'read_file', arguments: { path: 'a.txt' } },
        { id: 'call-2', name: 'find_files', arguments: { pattern: '*.ts' } },
      ],
    },
    { role: 'tool', toolCallId: 'call-1', toolName: 'read_file', content: '{"ok":true}', isError: false },
    { role: 'tool', toolCallId: 'call-2', toolName: 'find_files', content: '{"ok":true}', isError: false },
  ];
  await provider.chat(makeRequest(messages), () => undefined);
  const mapped = request?.messages as Array<Record<string, unknown>>;
  assert.deepEqual(mapped[2].tool_calls, [
    {
      id: 'call-1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
    },
    {
      id: 'call-2',
      type: 'function',
      function: { name: 'find_files', arguments: '{"pattern":"*.ts"}' },
    },
  ]);
  assert.deepEqual(mapped[3], { role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' });
  assert.deepEqual(mapped[4], { role: 'tool', tool_call_id: 'call-2', content: '{"ok":true}' });
  assert.equal('tools' in (request ?? {}), false);
});

test('OpenAI provider keeps stable system and tools while mapping runtime instructions', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const provider = new OpenAIProvider(config(), async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return responseFor(['data: [DONE]\n\n']);
  });
  const tools = [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }];

  await provider.chat(makeRequest([
    { role: 'user', content: 'one' },
    { role: 'instruction', content: '<system-reminder>first</system-reminder>' },
  ], tools), () => undefined);
  await provider.chat(makeRequest([
    { role: 'user', content: 'two' },
    { role: 'instruction', content: '<system-reminder>second</system-reminder>' },
  ], tools), () => undefined);

  const firstMessages = requests[0].messages as Array<Record<string, unknown>>;
  const secondMessages = requests[1].messages as Array<Record<string, unknown>>;
  assert.deepEqual(firstMessages[0], secondMessages[0]);
  assert.deepEqual(requests[0].tools, requests[1].tools);
  assert.deepEqual(firstMessages.at(-1), {
    role: 'user',
    content: '<system-reminder>first</system-reminder>',
  });
  assert.deepEqual(secondMessages.at(-1), {
    role: 'user',
    content: '<system-reminder>second</system-reminder>',
  });
  assert.equal('cache_control' in requests[0], false);
});

test('OpenAI provider supports DeepSeek cache fields and missing cache details', async () => {
  const responses = [
    responseFor([
      'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":2,"total_tokens":22,"prompt_cache_hit_tokens":11}}\n\n',
      'data: [DONE]\n\n',
    ]),
    responseFor([
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\n',
      'data: [DONE]\n\n',
    ]),
  ];
  const provider = new OpenAIProvider(config(), async () => responses.shift()!);
  const usages: TokenUsage[] = [];

  await provider.chat(makeRequest(), event => {
    if (event.type === 'usage') usages.push(event.usage);
  });
  await provider.chat(makeRequest(), event => {
    if (event.type === 'usage') usages.push(event.usage);
  });

  assert.deepEqual(usages, [
    {
      inputTokens: 20,
      outputTokens: 2,
      totalTokens: 22,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 11,
    },
    {
      inputTokens: 5,
      outputTokens: 1,
      totalTokens: 6,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  ]);
});

test('OpenAI provider preserves multiple tool calls in model order', async () => {
  const provider = new OpenAIProvider(config(), async () => responseFor([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"one","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.txt\\"}"}},{"index":1,"id":"two","function":{"name":"find_files","arguments":"{\\"pattern\\":\\"*.ts\\"}"}}]}}]}\n\n',
    'data: [DONE]\n\n',
  ]));
  const events: StreamEvent[] = [];
  await provider.chat(makeRequest(), event => events.push(event));
  const calls = events.filter(event => event.type === 'tool_call');

  assert.deepEqual(calls.map(event => event.type === 'tool_call' ? event.call.id : ''), ['one', 'two']);
});

test('OpenAI provider 暴露上下文窗口并映射摘要输出上限', async () => {
  let body: Record<string, unknown> | undefined;
  const provider = new OpenAIProvider({ ...config(), context_window: 64_000 }, async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return responseFor(['data: [DONE]\n\n']);
  });
  await provider.chat({ ...makeRequest([
    { role: 'instruction', content: '摘要', instructionKind: 'context_summary' },
  ]), maxOutputTokens: 2_048 }, () => undefined);
  assert.equal(provider.contextWindow, 64_000);
  assert.equal(provider.contextWindowIsDefault, false);
  assert.equal(body?.max_tokens, 2_048);
  assert.equal(JSON.stringify(body).includes('instructionKind'), false);

  const fallback = new OpenAIProvider(config(), async () => responseFor(['data: [DONE]\n\n']));
  assert.equal(fallback.contextWindow, 128_000);
  assert.equal(fallback.contextWindowIsDefault, true);
});

test('OpenAI provider rejects malformed and incomplete streams without done', async () => {
  const malformed = new OpenAIProvider(config(), async () => responseFor([
    'data: {not-json}\n\n',
  ]));
  const malformedEvents: StreamEvent[] = [];
  await malformed.chat(makeRequest(), event => malformedEvents.push(event));
  assert.equal(malformedEvents.at(-1)?.type, 'error');
  assert.equal(malformedEvents.some(event => event.type === 'done'), false);

  const incomplete = new OpenAIProvider(config(), async () => responseFor([
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
  ]));
  const incompleteEvents: StreamEvent[] = [];
  await incomplete.chat(makeRequest(), event => incompleteEvents.push(event));
  assert.equal(incompleteEvents.at(-1)?.type, 'error');
  assert.equal(incompleteEvents.some(event => event.type === 'done'), false);

  const invalidArguments = new OpenAIProvider(config(), async () => responseFor([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"bad","function":{"name":"read_file","arguments":"{"}}]}}]}\n\n',
    'data: [DONE]\n\n',
  ]));
  const invalidEvents: StreamEvent[] = [];
  await invalidArguments.chat(makeRequest(), event => invalidEvents.push(event));
  assert.equal(invalidEvents.at(-1)?.type, 'error');
  assert.equal(invalidEvents.some(event => event.type === 'tool_call'), false);
});

test('OpenAI provider treats abort as cancellation rather than a stream error', async () => {
  const controller = new AbortController();
  const provider = new OpenAIProvider(config(), async () => {
    controller.abort();
    throw new DOMException('cancelled', 'AbortError');
  });
  const events: StreamEvent[] = [];
  await provider.chat(makeRequest(), event => events.push(event), controller.signal);
  assert.deepEqual(events, []);
});
