import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandDispatcher } from './dispatcher.js';
import { CommandRegistry } from './registry.js';
import type { CommandUIController } from './types.js';

function fakeUi(messages: string[]): CommandUIController {
  return {
    showMessage: content => messages.push(content),
    async sendUserMessage() {},
    async runSkill() {},
    setAgentMode() {},
    getAgentMode: () => 'act',
    getTokenUsage: () => undefined,
    refreshStatus() {},
    async clearConversation() {},
    async compactConversation() {},
    async showOrResumeSession() {},
    showMemoryStatus() {},
    showOrSetPermission() {},
    showStatus() {},
    showSubAgentTasks() {},
    async manageTeam() {},
    rewindConversation() {},
    exit() {},
  };
}

test('分发器只处理命令并对未知命令给出帮助', async () => {
  const messages: string[] = [];
  const registry = new CommandRegistry();
  registry.register({
    name: 'help', aliases: ['h'], description: '帮助', usage: '/help', type: 'local',
    handler: ({ ui }) => ui.showMessage('帮助内容'),
  });
  const dispatcher = new CommandDispatcher(registry);
  assert.deepEqual(await dispatcher.dispatch('普通任务', fakeUi(messages)), { status: 'not_command' });
  assert.deepEqual(await dispatcher.dispatch('/missing', fakeUi(messages)), {
    status: 'unknown', command: 'missing',
  });
  assert.match(messages[0], /\/help/u);
  assert.deepEqual(await dispatcher.dispatch('/H', fakeUi(messages)), {
    status: 'handled', command: 'help',
  });
  assert.equal(messages[1], '帮助内容');
});

test('分发器隔离同步和异步处理异常', async () => {
  const messages: string[] = [];
  const registry = new CommandRegistry();
  registry.register({
    name: 'broken', aliases: [], description: '失败', usage: '/broken', type: 'local',
    async handler() { throw new Error('测试失败'); },
  });
  const result = await new CommandDispatcher(registry).dispatch('/broken', fakeUi(messages));
  assert.equal(result.status, 'handled');
  assert.match(messages[0], /测试失败/u);
});
