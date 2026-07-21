import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AgentEvent } from '../agent/types.js';
import type {
  LLMProvider,
  Message,
  StreamEvent,
  ToolDefinition,
} from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { ChatManager, NoPlanError } from './manager.js';

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
  return mkdtempSync(path.join(tmpdir(), 'mew-chat-'));
}

const done = (): StreamEvent => ({ type: 'done', content: '' });

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

test('ChatManager streams a multi-round tool task and commits complete history', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'file.txt'), 'hello');
  const provider = new FakeProvider([
    [
      {
        type: 'tool_call',
        call: { id: 'read-1', name: 'read_file', arguments: { path: 'file.txt' } },
      },
      done(),
    ],
    [{ type: 'text_delta', content: 'The file says hello.' }, done()],
  ]);
  const manager = new ChatManager(createCoreToolRegistry(root));
  const events = await collect(manager.run('read it', provider));

  assert.equal(provider.calls.length, 2);
  assert.deepEqual(manager.getHistory().map(message => message.role), [
    'user', 'assistant', 'tool', 'assistant',
  ]);
  assert.equal(events.at(-1)?.type, 'stopped');
  assert.equal(events.filter(event => event.type === 'stopped').length, 1);
});

test('ChatManager saves only successful non-empty plans and exposes read-only tools', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const successful = new FakeProvider([[
    { type: 'text_delta', content: '1. Inspect\n2. Edit' },
    done(),
  ]]);
  const manager = new ChatManager(createCoreToolRegistry(root));
  await collect(manager.run('fix parser', successful, { mode: 'plan' }));

  assert.deepEqual(successful.calls[0].tools.map(tool => tool.name), [
    'read_file', 'find_files', 'search_code',
  ]);
  assert.deepEqual(manager.getLatestPlan(), {
    task: 'fix parser',
    content: '1. Inspect\n2. Edit',
  });

  const failed = new FakeProvider([[{ type: 'error', content: 'broken' }]]);
  await collect(manager.run('replacement plan', failed, { mode: 'plan' }));
  assert.equal(manager.getLatestPlan()?.task, 'fix parser');
});

test('ChatManager executes the latest plan with all tools in the same conversation', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = new ChatManager(createCoreToolRegistry(root));
  await collect(manager.run('first task', new FakeProvider([[
    { type: 'text_delta', content: 'first plan' }, done(),
  ]]), { mode: 'plan' }));
  await collect(manager.run('second task', new FakeProvider([[
    { type: 'text_delta', content: 'second plan' }, done(),
  ]]), { mode: 'plan' }));

  const executor = new FakeProvider([[
    { type: 'text_delta', content: 'done' }, done(),
  ]]);
  await collect(manager.executeLatestPlan(executor));

  assert.equal(executor.calls[0].tools.length, 6);
  const latestUser = executor.calls[0].messages.at(-1);
  assert.equal(latestUser?.role, 'user');
  assert.match(latestUser?.content ?? '', /second task/);
  assert.match(latestUser?.content ?? '', /second plan/);
  assert.equal(executor.calls[0].messages.length > 4, true);
});

test('ChatManager rejects do without a plan and clear removes history and plan', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = new ChatManager(createCoreToolRegistry(root));
  const provider = new FakeProvider([]);
  assert.throws(() => manager.executeLatestPlan(provider), NoPlanError);
  assert.equal(provider.calls.length, 0);

  await collect(manager.run('task', new FakeProvider([[
    { type: 'text_delta', content: 'plan' }, done(),
  ]]), { mode: 'plan' }));
  manager.clear();
  assert.equal(manager.getHistory().length, 0);
  assert.equal(manager.getLatestPlan(), undefined);
});
