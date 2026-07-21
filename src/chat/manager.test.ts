import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCoreToolRegistry } from '../tool/factory.js';
import { ChatManager } from './manager.js';
import type { LLMProvider, Message, StreamEvent, ToolDefinition } from '../provider/types.js';

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly calls: Array<{ messages: Message[]; tools: ToolDefinition[] }> = [];

  constructor(private readonly responses: StreamEvent[][]) {}

  async chat(messages: Message[], tools: ToolDefinition[], onEvent: (event: StreamEvent) => void) {
    this.calls.push({ messages: [...messages], tools: [...tools] });
    for (const event of this.responses.shift() ?? []) onEvent(event);
  }
}

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'mew-chat-'));
}

const done = (): StreamEvent => ({ type: 'done', content: '' });

test('ChatManager keeps pure text on one provider request', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new FakeProvider([[{ type: 'text_delta', content: 'hello' }, done()]]);
  const manager = new ChatManager(createCoreToolRegistry(root));
  await manager.send('hi', provider, () => undefined, () => undefined, () => undefined);

  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].tools.length, 6);
  assert.deepEqual(manager.getHistory().map(message => message.role), ['user', 'assistant']);
  assert.equal(manager.getHistory()[1].content, 'hello');
});

test('ChatManager executes one tool and makes a tool-free second request', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new FakeProvider([
    [{ type: 'tool_call', call: { id: 'call-1', name: 'read_file', arguments: { path: 'file.txt' } } }, done()],
    [{ type: 'text_delta', content: 'The file says hello.' }, done()],
  ]);
  writeFileSync(path.join(root, 'file.txt'), 'hello');
  const manager = new ChatManager(createCoreToolRegistry(root));
  await manager.send('read it', provider, () => undefined, () => undefined, () => undefined);

  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0].tools.length, 6);
  assert.equal(provider.calls[1].tools.length, 0);
  const history = manager.getHistory();
  assert.deepEqual(history.map(message => message.role), ['user', 'assistant', 'tool', 'assistant']);
  assert.match(history[2].content, /hello/);
});

test('ChatManager refuses multiple calls and later calls', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new FakeProvider([
    [
      { type: 'tool_call', call: { id: 'one', name: 'write_file', arguments: { path: 'one.txt', content: 'x' } } },
      { type: 'tool_call', call: { id: 'two', name: 'write_file', arguments: { path: 'two.txt', content: 'x' } } },
      done(),
    ],
  ]);
  const errors: string[] = [];
  const manager = new ChatManager(createCoreToolRegistry(root));
  await manager.send('do both', provider, () => undefined, () => undefined, error => errors.push(error));
  assert.equal(provider.calls.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(existsSync(path.join(root, 'one.txt')), false);
});

test('ChatManager replays tool failures and clear resets all messages', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new FakeProvider([
    [{ type: 'tool_call', call: { id: 'call-1', name: 'read_file', arguments: { path: 'missing.txt' } } }, done()],
    [{ type: 'text_delta', content: 'I could not read it.' }, done()],
  ]);
  const manager = new ChatManager(createCoreToolRegistry(root));
  await manager.send('read missing', provider, () => undefined, () => undefined, () => undefined);
  assert.equal(manager.getHistory()[2].role, 'tool');
  assert.match(manager.getHistory()[2].content, /FILE_NOT_FOUND/);
  manager.clear();
  assert.equal(manager.getHistory().length, 0);
});
