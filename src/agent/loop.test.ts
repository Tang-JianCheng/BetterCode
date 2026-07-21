import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  LLMProvider,
  Message,
  StreamEvent,
  ToolDefinition,
} from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { ToolRegistry } from '../tool/registry.js';
import { createToolSuccess, type Tool } from '../tool/types.js';
import type { AgentEvent } from './types.js';
import { AgentLoop } from './loop.js';

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly calls: Array<{ messages: Message[]; tools: ToolDefinition[] }> = [];

  constructor(private readonly responses: StreamEvent[][]) {}

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> {
    this.calls.push({ messages: structuredClone(messages), tools: structuredClone(tools) });
    for (const event of this.responses.shift() ?? []) onEvent(event);
  }
}

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'mew-loop-'));
}

const done = (): StreamEvent => ({ type: 'done', content: '' });
const toolCall = (id: string, name: string, arguments_: Record<string, unknown> = {}): StreamEvent => ({
  type: 'tool_call',
  call: { id, name, arguments: arguments_ },
});

async function run(
  root: string,
  provider: LLMProvider,
  options: { maxIterations?: number; unknownToolLimit?: number } = {},
  signal = new AbortController().signal,
) {
  const events: AgentEvent[] = [];
  const outcome = await new AgentLoop(createCoreToolRegistry(root), options).execute({
    history: [],
    userMessage: 'do the task',
    mode: 'act',
    provider,
    signal,
  }, event => events.push(event));
  return { events, outcome };
}

test('agent loop completes pure text in one model request', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new FakeProvider([[
    { type: 'text_delta', content: 'hello' },
    { type: 'usage', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } },
    done(),
  ]]);
  const { events, outcome } = await run(root, provider);

  assert.equal(outcome.reason, 'completed');
  assert.equal(outcome.finalText, 'hello');
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(outcome.history.map(message => message.role), ['user', 'assistant']);
  assert.deepEqual(outcome.usage, { inputTokens: 4, outputTokens: 2, totalTokens: 6 });
  assert.equal(events.filter(event => event.type === 'stopped').length, 1);
});

test('agent loop replays tool results and continues without another user message', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'note.txt'), 'hello');
  const provider = new FakeProvider([
    [
      toolCall('read-1', 'read_file', { path: 'note.txt' }),
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      done(),
    ],
    [
      { type: 'text_delta', content: 'The file says hello.' },
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } },
      done(),
    ],
  ]);
  const { events, outcome } = await run(root, provider);

  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[1].messages.some(message => message.role === 'tool'), true);
  assert.deepEqual(outcome.history.map(message => message.role), [
    'user', 'assistant', 'tool', 'assistant',
  ]);
  assert.equal(outcome.finalText, 'The file says hello.');
  const result = events.find(event => event.type === 'tool_result');
  assert.ok(result && result.type === 'tool_result' && result.call.id === 'read-1');
  const usageEvents = events.filter(event => event.type === 'usage');
  assert.equal(usageEvents.length, 2);
  assert.deepEqual(usageEvents.at(-1)?.type === 'usage'
    ? usageEvents.at(-1)?.cumulative
    : undefined, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test('agent loop lets the model recover from a structured tool failure', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'present.txt'), 'value');
  const provider = new FakeProvider([
    [toolCall('missing', 'read_file', { path: 'missing.txt' }), done()],
    [toolCall('corrected', 'read_file', { path: 'present.txt' }), done()],
    [{ type: 'text_delta', content: 'Recovered with value.' }, done()],
  ]);
  const { outcome } = await run(root, provider);
  const toolMessages = outcome.history.filter(message => message.role === 'tool');

  assert.equal(outcome.reason, 'completed');
  assert.match(toolMessages[0].content, /FILE_NOT_FOUND/);
  assert.match(toolMessages[1].content, /value/);
});

test('agent loop completes a read, edit, verify workflow from one user request', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'note.txt'), 'hello');
  const provider = new FakeProvider([
    [toolCall('read-1', 'read_file', { path: 'note.txt' }), done()],
    [toolCall('edit-1', 'edit_file', {
      path: 'note.txt', old_text: 'hello', new_text: 'world',
    }), done()],
    [toolCall('read-2', 'read_file', { path: 'note.txt' }), done()],
    [{ type: 'text_delta', content: 'Updated and verified.' }, done()],
  ]);
  const { outcome } = await run(root, provider);

  assert.equal(outcome.reason, 'completed');
  assert.equal(provider.calls.length, 4);
  assert.equal(readFileSync(path.join(root, 'note.txt'), 'utf8'), 'world');
  assert.equal(outcome.history.filter(message => message.role === 'tool').length, 3);
  assert.equal(outcome.finalText, 'Updated and verified.');
});

test('agent loop executes the final tool batch and stops at the iteration limit', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'note.txt'), 'hello');
  const provider = new FakeProvider(Array.from({ length: 10 }, (_, index) => [
    toolCall(`read-${index}`, 'read_file', { path: 'note.txt' }),
    done(),
  ]));
  const { outcome } = await run(root, provider);

  assert.equal(outcome.reason, 'max_iterations');
  assert.equal(provider.calls.length, 10);
  assert.equal(outcome.history.filter(message => message.role === 'tool').length, 10);
});

test('agent loop stops after three consecutive unknown tools and preserves results', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new FakeProvider([
    [toolCall('1', 'missing-a'), done()],
    [toolCall('2', 'missing-b'), done()],
    [toolCall('3', 'missing-c'), toolCall('4', 'write_file', { path: 'x', content: 'x' }), done()],
  ]);
  const { outcome } = await run(root, provider);

  assert.equal(outcome.reason, 'unknown_tool_limit');
  assert.equal(provider.calls.length, 3);
  const toolMessages = outcome.history.filter(message => message.role === 'tool');
  assert.equal(toolMessages.length, 4);
  assert.match(toolMessages.at(-1)?.content ?? '', /CANCELLED/);
});

test('agent loop stops on a stream error without appending the incomplete turn', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new FakeProvider([[
    { type: 'text_delta', content: 'partial' },
    { type: 'error', content: 'broken stream' },
  ]]);
  const { events, outcome } = await run(root, provider);

  assert.equal(outcome.reason, 'stream_error');
  assert.deepEqual(outcome.history.map(message => message.role), ['user']);
  assert.equal(outcome.finalText, '');
  assert.equal(events.some(event => event.type === 'error'), true);
});

test('agent loop preserves completed rounds when a later model stream fails', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'note.txt'), 'hello');
  const provider = new FakeProvider([
    [toolCall('read-1', 'read_file', { path: 'note.txt' }), done()],
    [{ type: 'text_delta', content: 'partial' }, { type: 'error', content: 'broken' }],
  ]);
  const { outcome } = await run(root, provider);

  assert.equal(outcome.reason, 'stream_error');
  assert.deepEqual(outcome.history.map(message => message.role), ['user', 'assistant', 'tool']);
});

test('plan mode blocks all side-effect tools even when the model guesses their names', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'source.txt'), 'old');
  const provider = new FakeProvider([[
    toolCall('write', 'write_file', { path: 'new.txt', content: 'new' }),
    toolCall('edit', 'edit_file', { path: 'source.txt', old_text: 'old', new_text: 'changed' }),
    toolCall('command', 'run_command', { command: 'touch command.txt' }),
    done(),
  ]]);
  const events: AgentEvent[] = [];
  const outcome = await new AgentLoop(createCoreToolRegistry(root)).execute({
    history: [],
    userMessage: 'make a plan',
    mode: 'plan',
    provider,
    signal: new AbortController().signal,
  }, event => events.push(event));

  assert.equal(outcome.reason, 'unknown_tool_limit');
  assert.equal(readFileSync(path.join(root, 'source.txt'), 'utf8'), 'old');
  assert.equal(provider.calls[0].tools.length, 3);
  assert.deepEqual(
    events.filter(event => event.type === 'tool_result')
      .map(event => event.type === 'tool_result' ? event.result.error?.code : ''),
    ['TOOL_UNAVAILABLE', 'TOOL_UNAVAILABLE', 'TOOL_UNAVAILABLE'],
  );
});

test('agent loop cancellation during a model stream does not append the partial turn', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const controller = new AbortController();
  const provider: LLMProvider = {
    name: 'blocking',
    model: 'blocking-model',
    async chat(_messages, _tools, emit, signal) {
      emit({ type: 'text_delta', content: 'partial' });
      await new Promise<void>(resolve => {
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  };
  const pending = run(root, provider, {}, controller.signal);
  await Promise.resolve();
  controller.abort();
  const { events, outcome } = await pending;

  assert.equal(outcome.reason, 'cancelled');
  assert.equal(outcome.iterations, 1);
  assert.deepEqual(outcome.history.map(message => message.role), ['user']);
  assert.equal(events.filter(event => event.type === 'stopped').length, 1);
});

test('agent loop cancellation during tools preserves a complete cancelled tool result', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root, { timeoutMs: 1000 });
  const blockingTool: Tool = {
    name: 'blocking_write',
    effect: 'side_effect',
    description: 'blocks until cancelled',
    inputSchema: { type: 'object', additionalProperties: false },
    async execute(_input, context) {
      await new Promise<void>(resolve => {
        context.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return createToolSuccess('late');
    },
  };
  registry.register(blockingTool);
  const provider = new FakeProvider([[
    toolCall('block-1', 'blocking_write'),
    done(),
  ]]);
  const controller = new AbortController();
  const events: AgentEvent[] = [];
  const pending = new AgentLoop(registry).execute({
    history: [],
    userMessage: 'write',
    mode: 'act',
    provider,
    signal: controller.signal,
  }, event => events.push(event));
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  const outcome = await pending;

  assert.equal(outcome.reason, 'cancelled');
  assert.equal(outcome.iterations, 1);
  assert.deepEqual(outcome.history.map(message => message.role), ['user', 'assistant', 'tool']);
  const toolMessage = outcome.history.at(-1);
  assert.equal(toolMessage?.role, 'tool');
  assert.match(toolMessage?.content ?? '', /CANCELLED/);
  assert.equal(events.filter(event => event.type === 'stopped').length, 1);
});
