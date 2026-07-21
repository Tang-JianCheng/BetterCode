import assert from 'node:assert/strict';
import test from 'node:test';
import { AnthropicProvider } from './anthropic.js';
import type { Message, StreamEvent } from './types.js';

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

test('Anthropic provider maps tools and aggregates input_json_delta', async () => {
  let request: Record<string, unknown> | undefined;
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return responseFor([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"read_file"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":".txt\\"}"}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
  };
  const provider = new AnthropicProvider(config(), fetchImpl);
  const events: StreamEvent[] = [];
  await provider.chat(
    [{ role: 'user', content: 'read a.txt' }],
    [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
    event => events.push(event),
  );

  const bodyTools = request?.tools as Array<{ name: string; input_schema: unknown }>;
  assert.equal(bodyTools[0].name, 'read_file');
  assert.deepEqual(request?.thinking, { type: 'enabled', budget_tokens: 4000 });
  const call = events.find(event => event.type === 'tool_call');
  assert.ok(call && call.type === 'tool_call');
  assert.equal(call.call.id, 'tool-1');
  assert.deepEqual(call.call.arguments, { path: 'a.txt' });
  assert.equal(events.filter(event => event.type === 'tool_call').length, 1);
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
      toolCalls: [{ id: 'tool-1', name: 'read_file', arguments: { path: 'a.txt' } }],
    },
    { role: 'tool', toolCallId: 'tool-1', toolName: 'read_file', content: '{"ok":true}', isError: false },
  ];
  await provider.chat(messages, [], () => undefined);
  const mapped = request?.messages as Array<Record<string, unknown>>;
  assert.deepEqual(mapped[1].content, [{
    type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'a.txt' },
  }]);
  assert.deepEqual(mapped[2].content, [{
    type: 'tool_result', tool_use_id: 'tool-1', content: '{"ok":true}',
  }]);
});
