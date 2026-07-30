import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChatManager } from '../chat/manager.js';
import { createPermissionManager } from '../permission/factory.js';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { SkillManager } from './manager.js';
import { SkillRunner } from './runner.js';

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly contextWindow = 128_000;
  readonly contextWindowIsDefault = false;
  readonly requests: ProviderRequest[] = [];
  constructor(private readonly response: string) {}

  async chat(request: ProviderRequest, onEvent: (event: StreamEvent) => void): Promise<void> {
    this.requests.push(structuredClone(request));
    onEvent({ type: 'text_delta', content: this.response });
    onEvent({ type: 'done', content: '' });
  }
}

async function collect(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of iterable) {}
}

test('ChatManager 共享 Skill 持续激活，clear 后恢复默认状态', async t => {
  const base = mkdtempSync(path.join(tmpdir(), 'bettercode-skill-chat-shared-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  const builtin = path.join(base, 'builtin');
  mkdirSync(root, { recursive: true });
  mkdirSync(builtin, { recursive: true });
  writeFileSync(path.join(builtin, 'commit.md'), `---
name: commit
description: 提交
tools: [read_file]
mode: shared
---
提交 {{args}}
`);
  const registry = createCoreToolRegistry(root);
  const skillManager = new SkillManager(registry, root, {
    userHome: path.join(base, 'home'), builtinDirectory: builtin,
  });
  skillManager.initialize();
  const permissionManager = createPermissionManager(
    registry,
    'allow',
    { userHome: path.join(base, 'permission-home') },
  );
  const provider = new FakeProvider('已提交');
  const runner = new SkillRunner(registry, permissionManager, skillManager, {
    has: () => false,
    resolve: () => provider,
  });
  const chat = new ChatManager(
    registry,
    permissionManager,
    {},
    {},
    {},
    { sessionPersistence: false },
    { manager: skillManager, runner },
  );
  t.after(() => chat.close());

  await collect(chat.runSkill('commit', '当前改动', '/commit 当前改动', provider));
  assert.deepEqual(skillManager.getActiveNames(), ['commit']);
  assert.match(provider.requests[0].messages.at(-1)?.content ?? '', /提交 当前改动/u);
  assert.deepEqual(chat.getHistory().map(message => message.role), ['user', 'assistant']);
  await chat.clear();
  assert.deepEqual(skillManager.getActiveNames(), []);
});

test('ChatManager 独立 Skill 只向主历史回流命令和摘要', async t => {
  const base = mkdtempSync(path.join(tmpdir(), 'bettercode-skill-chat-isolated-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  const builtin = path.join(base, 'builtin');
  mkdirSync(root, { recursive: true });
  mkdirSync(builtin, { recursive: true });
  writeFileSync(path.join(builtin, 'review.md'), `---
name: review
description: 审查
tools: [read_file]
mode: isolated
history: 0
---
审查 {{args}}
`);
  const registry = createCoreToolRegistry(root);
  const skillManager = new SkillManager(registry, root, {
    userHome: path.join(base, 'home'), builtinDirectory: builtin,
  });
  skillManager.initialize();
  const permissionManager = createPermissionManager(
    registry,
    'allow',
    { userHome: path.join(base, 'permission-home') },
  );
  const provider = new FakeProvider('审查摘要');
  const runner = new SkillRunner(registry, permissionManager, skillManager, {
    has: () => false,
    resolve: () => provider,
  });
  const chat = new ChatManager(
    registry,
    permissionManager,
    {},
    {},
    {},
    { sessionPersistence: true },
    { manager: skillManager, runner },
  );
  t.after(() => chat.close());

  await collect(chat.runSkill('review', 'src/chat', '/review src/chat', provider));
  assert.deepEqual(chat.getHistory(), [
    { role: 'user', content: '/review src/chat' },
    { role: 'assistant', content: '审查摘要' },
  ]);
  assert.deepEqual(skillManager.getActiveNames(), []);
  assert.equal(chat.getHistory().some(message => message.role === 'tool'), false);
  const session = readFileSync(
    path.join(root, '.bettercode/sessions', `${chat.getSessionId()}.jsonl`),
    'utf8',
  ).trim().split('\n').map(line => JSON.parse(line) as { role?: string; content?: string });
  assert.deepEqual(session.map(item => item.role), ['user', 'assistant']);
  assert.deepEqual(session.map(item => item.content), ['/review src/chat', '审查摘要']);
});
