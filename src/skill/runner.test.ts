import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPermissionManager } from '../permission/factory.js';
import type { LLMProvider, Message, ProviderRequest, StreamEvent } from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { SkillManager } from './manager.js';
import { SkillRunner, selectRecentSkillHistory } from './runner.js';

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly contextWindow = 128_000;
  readonly contextWindowIsDefault = false;
  readonly requests: ProviderRequest[] = [];

  async chat(request: ProviderRequest, onEvent: (event: StreamEvent) => void): Promise<void> {
    this.requests.push(structuredClone(request));
    onEvent({ type: 'text_delta', content: '独立摘要' });
    onEvent({ type: 'done', content: '' });
  }
}

async function collect(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of iterable) {}
}

test('独立 Skill 历史选择保持工具调用组完整', () => {
  const history: Message[] = [
    { role: 'user', content: '一' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: {} }] },
    { role: 'tool', toolCallId: 'c1', toolName: 'read_file', content: '结果', isError: false },
    { role: 'assistant', content: '二' },
  ];
  assert.deepEqual(selectRecentSkillHistory(history, 2), history.slice(1));
  assert.deepEqual(selectRecentSkillHistory(history, 0), []);
});

test('独立 Skill 使用指定 Provider、收窄工具并只注入目标 SOP', async t => {
  const base = mkdtempSync(path.join(tmpdir(), 'bettercode-skill-runner-'));
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
history: 1
model: special
---
审查 {{args}}
`);
  const registry = createCoreToolRegistry(root);
  const manager = new SkillManager(registry, root, {
    userHome: path.join(base, 'home'),
    builtinDirectory: builtin,
    providerNames: ['special'],
  });
  manager.initialize();
  const current = new FakeProvider();
  const special = new FakeProvider();
  const runner = new SkillRunner(
    registry,
    createPermissionManager(registry, 'allow', { userHome: path.join(base, 'permission-home') }),
    manager,
    { has: name => name === 'special', resolve: () => special },
  );
  await collect(runner.run(
    'review',
    'src/chat',
    [{ role: 'user', content: '最近上下文' }],
    current,
  ));

  assert.equal(current.requests.length, 0);
  assert.equal(special.requests.length, 1);
  assert.deepEqual(special.requests[0].tools.map(tool => tool.name), ['read_file', 'load_skill']);
  assert.deepEqual(special.requests[0].messages.filter(message => message.role === 'user').map(message => message.content), [
    '最近上下文',
    'Skill 参数：src/chat\n完成任务后只输出可独立理解的简洁结果摘要。',
  ]);
  const reminder = special.requests[0].messages.at(-1);
  assert.equal(reminder?.role, 'instruction');
  assert.match(reminder?.content ?? '', /## 已激活的 Skill[\s\S]*审查 src\/chat/u);
});
