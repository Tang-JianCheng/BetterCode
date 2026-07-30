import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChatManager } from '../chat/manager.js';
import { createPermissionManager } from '../permission/factory.js';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { SkillManager } from './manager.js';
import { SkillRunner } from './runner.js';

class ScriptedProvider implements LLMProvider {
  readonly name = 'scripted';
  readonly model = 'scripted-model';
  readonly contextWindow = 128_000;
  readonly contextWindowIsDefault = false;
  readonly requests: ProviderRequest[] = [];

  constructor(private readonly turns: StreamEvent[][]) {}

  async chat(request: ProviderRequest, onEvent: (event: StreamEvent) => void): Promise<void> {
    this.requests.push(structuredClone(request));
    const events = this.turns.shift();
    if (!events) throw new Error('没有更多伪响应');
    for (const event of events) onEvent(event);
  }
}

function toolTurn(name: string, args: Record<string, unknown>): StreamEvent[] {
  return [
    { type: 'tool_call', call: { id: `call-${name}`, name: 'load_skill', arguments: { name, ...args } } },
    { type: 'done', content: '' },
  ];
}

function textTurn(content: string): StreamEvent[] {
  return [{ type: 'text_delta', content }, { type: 'done', content: '' }];
}

async function collect(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of iterable) {}
}

function setup(t: import('node:test').TestContext, skill: string) {
  const base = mkdtempSync(path.join(tmpdir(), 'bettercode-skill-agent-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  const builtin = path.join(base, 'builtin');
  mkdirSync(root, { recursive: true });
  mkdirSync(builtin, { recursive: true });
  writeFileSync(path.join(builtin, 'skill.md'), skill);
  const registry = createCoreToolRegistry(root);
  const manager = new SkillManager(registry, root, {
    userHome: path.join(base, 'home'), builtinDirectory: builtin,
  });
  manager.initialize();
  const permission = createPermissionManager(
    registry,
    'allow',
    { userHome: path.join(base, 'permission-home') },
  );
  return { base, registry, manager, permission };
}

test('模型加载共享 Skill 后下一轮收到完整 SOP 和收窄工具', async t => {
  const { registry, manager, permission } = setup(t, `---
name: commit
description: 提交
tools: [read_file]
mode: shared
---
提交 {{args}}
`);
  const provider = new ScriptedProvider([toolTurn('commit', { args: '当前改动' }), textTurn('完成')]);
  const runner = new SkillRunner(registry, permission, manager, {
    has: () => false, resolve: () => provider,
  });
  const chat = new ChatManager(registry, permission, {}, {}, {}, { sessionPersistence: false }, {
    manager, runner,
  });
  t.after(() => chat.close());
  await collect(chat.run('请提交', provider));

  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[0].messages.at(-1)?.content.includes('提交 当前改动'), false);
  assert.deepEqual(provider.requests[1].tools.map(tool => tool.name), ['read_file', 'load_skill']);
  assert.match(provider.requests[1].messages.at(-1)?.content ?? '', /## 已激活的 Skill[\s\S]*提交 当前改动/u);
});

test('模型加载独立 Skill 后子 Agent 摘要回到主工具结果', async t => {
  const { registry, manager, permission } = setup(t, `---
name: review
description: 审查
tools: [read_file]
mode: isolated
history: 0
---
审查 {{args}}
`);
  const provider = new ScriptedProvider([
    toolTurn('review', { args: 'src/chat' }),
    textTurn('独立审查摘要'),
    textTurn('主 Agent 完成'),
  ]);
  const runner = new SkillRunner(registry, permission, manager, {
    has: () => false, resolve: () => provider,
  });
  const chat = new ChatManager(registry, permission, {}, {}, {}, { sessionPersistence: false }, {
    manager, runner,
  });
  t.after(() => chat.close());
  await collect(chat.run('请审查', provider));

  assert.equal(provider.requests.length, 3);
  assert.deepEqual(provider.requests[1].tools.map(tool => tool.name), ['read_file', 'load_skill']);
  const toolResult = chat.getHistory().find(message => message.role === 'tool');
  assert.equal(toolResult?.role, 'tool');
  assert.match(toolResult?.content ?? '', /独立审查摘要/u);
  assert.equal(chat.getHistory().some(message => message.content === 'Skill 参数：src/chat\n完成任务后只输出可独立理解的简洁结果摘要。'), false);
  assert.deepEqual(manager.getActiveNames(), []);
});
