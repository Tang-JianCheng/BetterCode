import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPermissionManager } from '../permission/factory.js';
import type { AgentEvent } from '../agent/types.js';
import type {
  LLMProvider,
  ProviderRequest,
  StreamEvent,
} from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { ChatManager, NoPlanError } from './manager.js';

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly contextWindow = 128_000;
  readonly contextWindowIsDefault = false;
  readonly calls: ProviderRequest[] = [];

  constructor(private readonly responses: StreamEvent[][]) {}

  async chat(
    request: ProviderRequest,
    onEvent: (event: StreamEvent) => void,
  ): Promise<void> {
    this.calls.push(structuredClone(request));
    for (const event of this.responses.shift() ?? []) onEvent(event);
  }
}

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-chat-'));
}

function makeManager(
  root: string,
  options: ConstructorParameters<typeof ChatManager>[2] = {},
  supplemental: ConstructorParameters<typeof ChatManager>[3] = {},
): ChatManager {
  const registry = createCoreToolRegistry(root);
  const permissionManager = createPermissionManager(
    registry,
    'allow',
    { userHome: path.join(root, '.home') },
  );
  return new ChatManager(registry, permissionManager, options, supplemental);
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
  const manager = makeManager(root);
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
  writeFileSync(path.join(root, 'parser.ts'), 'export {};');
  const successful = new FakeProvider([
    [{
      type: 'tool_call',
      call: { id: 'read-1', name: 'read_file', arguments: { path: 'parser.ts' } },
    }, done()],
    [{ type: 'text_delta', content: '1. Inspect\n2. Edit' }, done()],
  ]);
  const manager = makeManager(root);
  await collect(manager.run('fix parser', successful, { mode: 'plan' }));

  for (const call of successful.calls) {
    assert.deepEqual(call.tools.map(tool => tool.name), [
      'read_file', 'find_files', 'search_code',
    ]);
  }
  const planUser = successful.calls[0].messages.find(message => message.role === 'user');
  assert.equal(planUser?.content, 'fix parser');
  assert.doesNotMatch(planUser?.content ?? '', /Plan Mode|只允许读取和搜索/);
  assert.match(successful.calls[0].messages.at(-1)?.content ?? '', /当前处于 Plan Mode/);
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
  const manager = makeManager(root);
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
  const latestUser = [...executor.calls[0].messages]
    .reverse()
    .find(message => message.role === 'user');
  assert.equal(latestUser?.role, 'user');
  assert.match(latestUser?.content ?? '', /second task/);
  assert.match(latestUser?.content ?? '', /second plan/);
  assert.equal(executor.calls[0].messages.length > 4, true);
});

test('ChatManager plan then do can execute tools without repeating the task', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = makeManager(root);
  await collect(manager.run('create result.txt', new FakeProvider([[
    { type: 'text_delta', content: 'Write result.txt with complete.' }, done(),
  ]]), { mode: 'plan' }));

  const executor = new FakeProvider([
    [{
      type: 'tool_call',
      call: {
        id: 'write-1',
        name: 'write_file',
        arguments: { path: 'result.txt', content: 'complete' },
      },
    }, done()],
    [{ type: 'text_delta', content: 'Execution complete.' }, done()],
  ]);
  await collect(manager.executeLatestPlan(executor));

  assert.equal(existsSync(path.join(root, 'result.txt')), true);
  assert.equal(readFileSync(path.join(root, 'result.txt'), 'utf8'), 'complete');
  assert.equal(executor.calls.length, 2);
});

test('ChatManager keeps the previous successful plan after a max-iteration plan', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'file.txt'), 'value');
  const manager = makeManager(root, { maxIterations: 1 });
  await collect(manager.run('good task', new FakeProvider([[
    { type: 'text_delta', content: 'good plan' }, done(),
  ]]), { mode: 'plan' }));
  await collect(manager.run('unfinished task', new FakeProvider([[
    {
      type: 'tool_call',
      call: { id: 'read-1', name: 'read_file', arguments: { path: 'file.txt' } },
    },
    done(),
  ]]), { mode: 'plan' }));

  await collect(manager.run('empty task', new FakeProvider([[done()]]), { mode: 'plan' }));

  const controller = new AbortController();
  const blockingProvider: LLMProvider = {
    name: 'blocking',
    model: 'blocking-model',
    contextWindow: 128_000,
    contextWindowIsDefault: false,
    async chat(_request, _emit, signal) {
      await new Promise<void>(resolve => {
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  };
  const cancelled = collect(manager.run('cancelled task', blockingProvider, {
    mode: 'plan',
    signal: controller.signal,
  }));
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  await cancelled;

  assert.equal(manager.getLatestPlan()?.task, 'good task');
});

test('ChatManager rejects do without a plan and clear removes history and plan', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = makeManager(root);
  const provider = new FakeProvider([]);
  assert.throws(() => manager.executeLatestPlan(provider), NoPlanError);
  assert.equal(provider.calls.length, 0);

  await collect(manager.run('task', new FakeProvider([[
    { type: 'text_delta', content: 'plan' }, done(),
  ]]), { mode: 'plan' }));
  await manager.clear();
  assert.equal(manager.getHistory().length, 0);
  assert.equal(manager.getLatestPlan(), undefined);
});

test('ChatManager sends supplemental content without polluting real history', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new FakeProvider([[
    { type: 'text_delta', content: 'done' }, done(),
  ]]);
  const manager = makeManager(
    root,
    {},
    {
      customInstructions: '只回答结果',
      activeSkills: [{ name: 'test-skill', content: '检查输出' }],
      longTermMemory: '偏好简洁',
    },
  );

  await collect(manager.run('真实任务', provider));

  assert.deepEqual(manager.getHistory().map(message => message.role), ['user', 'assistant']);
  assert.equal(manager.getHistory()[0].content, '真实任务');
  const instruction = provider.calls[0].messages.at(-1);
  assert.equal(instruction?.role, 'instruction');
  assert.match(instruction?.content ?? '', /只回答结果/);
  assert.match(instruction?.content ?? '', /test-skill/);
  assert.match(instruction?.content ?? '', /偏好简洁/);
  assert.match(provider.calls[0].systemPrompt, /BetterCode/);
});

test('ChatManager controls permission mode and clears session rules', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'file.txt'), 'hello');
  const registry = createCoreToolRegistry(root);
  const permissionManager = createPermissionManager(
    registry,
    'default',
    { userHome: path.join(root, '.home') },
  );
  const manager = new ChatManager(registry, permissionManager);
  const provider = new FakeProvider([
    [{
      type: 'tool_call',
      call: { id: 'read-1', name: 'read_file', arguments: { path: 'file.txt' } },
    }, done()],
    [{ type: 'text_delta', content: 'done' }, done()],
  ]);
  await collect(manager.run('read', provider, {
    permissionDecider: async () => 'allow_session',
  }));
  assert.equal(manager.getPermissionStatus().ruleCounts.session, 1);

  manager.setPermissionMode('strict');
  assert.equal(manager.getPermissionStatus().mode, 'strict');
  await manager.clear();
  assert.equal(manager.getPermissionStatus().ruleCounts.session, 0);
  assert.equal(manager.getPermissionStatus().mode, 'strict');
});

test('ChatManager refuses permission mode changes during an active run', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = createCoreToolRegistry(root);
  const permissionManager = createPermissionManager(
    registry,
    'default',
    { userHome: path.join(root, '.home') },
  );
  const manager = new ChatManager(registry, permissionManager);
  const controller = new AbortController();
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const provider: LLMProvider = {
    name: 'blocking',
    model: 'blocking-model',
    contextWindow: 128_000,
    contextWindowIsDefault: false,
    async chat(_request, _emit, signal) {
      markStarted?.();
      await new Promise<void>(resolve => {
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  };

  const pending = collect(manager.run('wait', provider, { signal: controller.signal }));
  await started;
  assert.throws(() => manager.setPermissionMode('allow'), /运行期间不能切换/);
  assert.equal(manager.getPermissionStatus().mode, 'default');
  controller.abort();
  await pending;
});
