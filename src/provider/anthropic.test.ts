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
