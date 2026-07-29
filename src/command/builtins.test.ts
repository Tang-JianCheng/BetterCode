import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentMode } from '../agent/types.js';
import type { PermissionMode } from '../permission/types.js';
import type { CommandUIController } from './types.js';
import {
  buildReviewPrompt,
  createDefaultCommandRegistry,
  formatCommandHelp,
} from './builtins.js';
import { CommandDispatcher } from './dispatcher.js';
import { CommandRegistry } from './registry.js';

function controller(events: string[]): CommandUIController {
  let mode: AgentMode = 'act';
  return {
    showMessage: content => events.push(`message:${content}`),
    async sendUserMessage(content, displayText) { events.push(`send:${displayText}:${content}`); },
    setAgentMode(value) { mode = value; events.push(`mode:${value}`); },
    getAgentMode: () => mode,
    getTokenUsage: () => undefined,
    refreshStatus: () => events.push('refresh'),
    async clearConversation() { events.push('clear'); },
    async compactConversation() { events.push('compact'); },
    async showOrResumeSession(id) { events.push(`session:${id ?? ''}`); },
    showMemoryStatus: () => events.push('memory'),
    showOrSetPermission: (value?: PermissionMode) => events.push(`permission:${value ?? ''}`),
    showStatus: () => events.push('status'),
    rewindConversation: () => events.push('rewind'),
    exit: () => events.push('exit'),
  };
}

test('默认注册中心包含十个可见主命令和兼容隐藏命令', () => {
  const registry = createDefaultCommandRegistry();
  assert.deepEqual(registry.list().map(item => item.name), [
    'help', 'compact', 'clear', 'plan', 'do', 'session', 'memory',
    'permission', 'status', 'review',
  ]);
  assert.equal(registry.get('resume')?.name, 'session');
  assert.equal(registry.get('permissions')?.name, 'permission');
  assert.equal(registry.get('quit')?.name, 'exit');
  assert.equal(registry.complete('/rew').length, 0);
  assert.doesNotMatch(formatCommandHelp(registry), /rewind|exit/u);
  assert.equal(formatCommandHelp(new CommandRegistry()), '没有可用命令。');
});

test('计划、执行、状态和本地命令调用界面控制器', async () => {
  const events: string[] = [];
  const registry = createDefaultCommandRegistry();
  const dispatcher = new CommandDispatcher(registry);
  const ui = controller(events);
  for (const command of [
    '/plan', '/do', '/compact', '/clear', '/session abc', '/memory',
    '/permission strict', '/status', '/rewind', '/quit',
  ]) {
    await dispatcher.dispatch(command, ui);
  }
  assert.deepEqual(events.filter(event => event.startsWith('mode:')), ['mode:plan', 'mode:act']);
  assert.equal(events.includes('compact'), true);
  assert.equal(events.includes('clear'), true);
  assert.equal(events.includes('session:abc'), true);
  assert.equal(events.includes('memory'), true);
  assert.equal(events.includes('permission:strict'), true);
  assert.equal(events.includes('status'), true);
  assert.equal(events.includes('rewind'), true);
  assert.equal(events.includes('exit'), true);
});

test('review 构造固定审查提示词并保留原命令显示文本', async () => {
  const events: string[] = [];
  const registry = createDefaultCommandRegistry();
  await new CommandDispatcher(registry).dispatch('/review src/chat', controller(events));
  assert.match(events.find(event => event.startsWith('send:')) ?? '', /\/review src\/chat/u);
  assert.match(events.find(event => event.startsWith('send:')) ?? '', /bug.*行为回归.*安全风险.*缺失测试/u);
  assert.match(buildReviewPrompt('parser'), /parser/u);
});
