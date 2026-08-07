import assert from 'node:assert/strict';
import test from 'node:test';
import { AnthropicProvider } from './anthropic.js';
import type {
  Message,
  ProviderRequest,
  StreamEvent,
  ToolDefinition,
} from './types.js';

function config() {
  return {
    name: 'test-anthropic',
    protocol: 'anthropic' as const,
    model: 'test-model',
    base_url: 'https://example.test',
    api_key: 'test-key',
    thinking: true,
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

test('Anthropic provider maps tools and aggregates input_json_delta', async () => {
  let request: Record<string, unknown> | undefined;
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return responseFor([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":8,"output_tokens":0,"cache_creation_input_tokens":20,"cache_read_input_tokens":5}}}\n\n',
      'data: {"type":"content_block_delta","index":2,"delta":{"type":"thinking_delta","thinking":"checking"}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"read_file"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":".txt\\"}"}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
  };
  const provider = new AnthropicProvider(config(), fetchImpl);
  const events: StreamEvent[] = [];
  await provider.chat(
    makeRequest(
      [{ role: 'user', content: 'read a.txt' }],
      [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
    ),
    event => events.push(event),
  );

  const bodyTools = request?.tools as Array<{
    name: string;
    input_schema: unknown;
    cache_control?: unknown;
  }>;
  assert.equal(bodyTools[0].name, 'read_file');
  assert.deepEqual(bodyTools[0].cache_control, { type: 'ephemeral' });
  assert.deepEqual(request?.system, [{
    type: 'text',
    text: 'stable system',
    cache_control: { type: 'ephemeral' },
  }]);
  assert.deepEqual(request?.thinking, { type: 'enabled', budget_tokens: 4000 });
  assert.equal(events.some(event => event.type === 'thinking_delta' && event.content === 'checking'), true);
  const call = events.find(event => event.type === 'tool_call');
  assert.ok(call && call.type === 'tool_call');
  assert.equal(call.call.id, 'tool-1');
  assert.deepEqual(call.call.arguments, { path: 'a.txt' });
  assert.equal(events.filter(event => event.type === 'tool_call').length, 1);
  const usage = events.find(event => event.type === 'usage');
  assert.ok(usage && usage.type === 'usage');
  assert.deepEqual(usage.usage, {
    inputTokens: 33,
    outputTokens: 4,
    totalTokens: 37,
    cacheCreationInputTokens: 20,
    cacheReadInputTokens: 5,
  });
  assert.equal(events.at(-1)?.type, 'done');
});

test('Anthropic provider maps tool result messages', async () => {
  let request: Record<string, unknown> | undefined;
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return responseFor(['data: {"type":"message_stop"}\n\n']);
  };
  const provider = new AnthropicProvider(config(), fetchImpl);
  const messages: Message[] = [
    { role: 'user', content: 'read' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'tool-1', name: 'read_file', arguments: { path: 'a.txt' } },
        { id: 'tool-2', name: 'find_files', arguments: { pattern: '*.ts' } },
      ],
    },
    { role: 'tool', toolCallId: 'tool-1', toolName: 'read_file', content: '{"ok":true}', isError: false },
    { role: 'tool', toolCallId: 'tool-2', toolName: 'find_files', content: '{"ok":true}', isError: false },
  ];
  await provider.chat(makeRequest(messages), () => undefined);
  const mapped = request?.messages as Array<Record<string, unknown>>;
  assert.deepEqual(mapped[1].content, [
    { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'a.txt' } },
    { type: 'tool_use', id: 'tool-2', name: 'find_files', input: { pattern: '*.ts' } },
  ]);
  assert.deepEqual(mapped[2].content, [
    { type: 'tool_result', tool_use_id: 'tool-1', content: '{"ok":true}' },
    { type: 'tool_result', tool_use_id: 'tool-2', content: '{"ok":true}' },
  ]);
});

test('Anthropic provider maps runtime instructions after tool results', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = new AnthropicProvider(config(), async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return responseFor(['data: {"type":"message_stop"}\n\n']);
  });
  const messages: Message[] = [
    { role: 'user', content: 'read' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tool-1', name: 'read_file', arguments: { path: 'a.txt' } }],
    },
    {
      role: 'tool',
      toolCallId: 'tool-1',
      toolName: 'read_file',
      content: '{"ok":true}',
      isError: false,
    },
    { role: 'instruction', content: '<system-reminder>runtime</system-reminder>' },
  ];

  await provider.chat(makeRequest(messages), () => undefined);
  const mapped = requestBody?.messages as Array<Record<string, unknown>>;
  assert.deepEqual(mapped[2].content, [
    { type: 'tool_result', tool_use_id: 'tool-1', content: '{"ok":true}' },
  ]);
  assert.deepEqual(mapped[3], {
    role: 'user',
    content: '<system-reminder>runtime</system-reminder>',
  });
});

test('Anthropic provider caches only the last tool and handles missing cache usage', async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = new AnthropicProvider(config(), async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return responseFor([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":2}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
  });
  const events: StreamEvent[] = [];
  await provider.chat(makeRequest([], [
    { name: 'read_file', description: 'read', inputSchema: { type: 'object' } },
    { name: 'find_files', description: 'find', inputSchema: { type: 'object' } },
  ]), event => events.push(event));

  const tools = requestBody?.tools as Array<Record<string, unknown>>;
  assert.equal('cache_control' in tools[0], false);
  assert.deepEqual(tools[1].cache_control, { type: 'ephemeral' });
  const usage = events.find(event => event.type === 'usage');
  assert.ok(usage && usage.type === 'usage');
  assert.deepEqual(usage.usage, {
    inputTokens: 3,
    outputTokens: 2,
    totalTokens: 5,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  });

  let withoutTools: Record<string, unknown> | undefined;
  const noToolsProvider = new AnthropicProvider(config(), async (_input, init) => {
    withoutTools = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return responseFor(['data: {"type":"message_stop"}\n\n']);
  });
  await noToolsProvider.chat(makeRequest(), () => undefined);
  assert.equal('tools' in (withoutTools ?? {}), false);
  assert.deepEqual(withoutTools?.system, [{
    type: 'text',
    text: 'stable system',
    cache_control: { type: 'ephemeral' },
  }]);
});

test('Anthropic provider preserves multiple tool calls in model order', async () => {
  const provider = new AnthropicProvider(config(), async () => responseFor([
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"one","name":"read_file"}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.txt\\"}"}}\n\n',
    'data: {"type":"content_block_stop","index":0}\n\n',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"two","name":"find_files"}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"pattern\\":\\"*.ts\\"}"}}\n\n',
    'data: {"type":"content_block_stop","index":1}\n\n',
    'data: {"type":"message_stop"}\n\n',
  ]));
  const events: StreamEvent[] = [];
  await provider.chat(makeRequest(), event => events.push(event));
  const calls = events.filter(event => event.type === 'tool_call');

  assert.deepEqual(calls.map(event => event.type === 'tool_call' ? event.call.id : ''), ['one', 'two']);
});

test('Anthropic provider 暴露上下文窗口并映射摘要输出上限', async () => {
  let body: Record<string, unknown> | undefined;
  const provider = new AnthropicProvider({ ...config(), context_window: 80_000 }, async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return responseFor(['data: {"type":"message_stop"}\n\n']);
  });
  await provider.chat({ ...makeRequest([
    { role: 'instruction', content: '摘要', instructionKind: 'context_summary' },
  ]), maxOutputTokens: 2_048 }, () => undefined);
  assert.equal(provider.contextWindow, 80_000);
  assert.equal(provider.contextWindowIsDefault, false);
  assert.equal(body?.max_tokens, 2_048);
  assert.equal(JSON.stringify(body).includes('instructionKind'), false);

  const fallback = new AnthropicProvider(config(), async () => responseFor([
    'data: {"type":"message_stop"}\n\n',
  ]));
  assert.equal(fallback.contextWindow, 128_000);
  assert.equal(fallback.contextWindowIsDefault, true);
});

test('Anthropic provider rejects malformed and incomplete streams without done', async () => {
  const malformed = new AnthropicProvider(config(), async () => responseFor([
    'data: {not-json}\n\n',
  ]));
  const malformedEvents: StreamEvent[] = [];
  await malformed.chat(makeRequest(), event => malformedEvents.push(event));
  assert.equal(malformedEvents.at(-1)?.type, 'error');
  assert.equal(malformedEvents.some(event => event.type === 'done'), false);

  const incomplete = new AnthropicProvider(config(), async () => responseFor([
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n',
  ]));
  const incompleteEvents: StreamEvent[] = [];
  await incomplete.chat(makeRequest(), event => incompleteEvents.push(event));
  assert.equal(incompleteEvents.at(-1)?.type, 'error');
  assert.equal(incompleteEvents.some(event => event.type === 'done'), false);
});

test('Anthropic provider treats abort as cancellation rather than a stream error', async () => {
  const controller = new AbortController();
  const provider = new AnthropicProvider(config(), async () => {
    controller.abort();
    throw new DOMException('cancelled', 'AbortError');
  });
  const events: StreamEvent[] = [];
  await provider.chat(makeRequest(), event => events.push(event), controller.signal);
  assert.deepEqual(events, []);
});

test('Anthropic provider 默认使用 x-api-key 并拼接 /v1/messages', async () => {
  let url = '';
  let headers: Record<string, string> | undefined;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input);
    headers = init?.headers as Record<string, string>;
    return responseFor(['data: {"type":"message_stop"}\n\n']);
  };
  const provider = new AnthropicProvider(config(), fetchImpl);
  await provider.chat(makeRequest(), () => undefined);
  assert.equal(url, 'https://example.test/v1/messages');
  assert.equal(headers?.['x-api-key'], 'test-key');
  assert.equal('authorization' in (headers ?? {}), false);
});

test('Anthropic provider Bearer 认证并归一化 /v1 结尾 base_url', async () => {
  let url = '';
  let headers: Record<string, string> | undefined;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input);
    headers = init?.headers as Record<string, string>;
    return responseFor(['data: {"type":"message_stop"}\n\n']);
  };
  const provider = new AnthropicProvider({
    ...config(),
    base_url: 'https://gateway.example/v1/',
    authMode: 'bearer',
    api_key: 'token-abc',
  }, fetchImpl);
  await provider.chat(makeRequest(), () => undefined);
  assert.equal(url, 'https://gateway.example/v1/messages');
  assert.equal(headers?.authorization, 'Bearer token-abc');
  assert.equal('x-api-key' in (headers ?? {}), false);
});

test('Anthropic provider 工具参数片段被截断时给出明确错误而非裸 JSON 解析错误', async () => {
  const fetchImpl = async () => responseFor([
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"read_file"}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a"}}\n\n',
    'data: {"type":"content_block_stop","index":0}\n\n',
    'data: {"type":"message_stop"}\n\n',
  ]);
  const provider = new AnthropicProvider(config(), fetchImpl);
  const events: StreamEvent[] = [];
  await provider.chat(makeRequest(), event => events.push(event));
  const error = events.find(event => event.type === 'error');
  assert.ok(error && error.type === 'error', '应产生 error 事件');
  assert.match(error.content, /read_file/u, '错误应包含工具名');
  assert.match(error.content, /参数 JSON 不完整/u, '错误应说明参数不完整/上游截断');
  assert.doesNotMatch(error.content, /^流式读取失败: Unterminated string/u, '不应再输出裸的 JSON 解析错误');
  assert.equal(events.some(event => event.type === 'done'), false, '截断时不应视为成功完成');
});
