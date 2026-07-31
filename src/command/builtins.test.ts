import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentMode } from '../agent/types.js';
import type { PermissionMode } from '../permission/types.js';
import type { CommandUIController } from './types.js';
import {
  createDefaultCommandRegistry,
  formatCommandHelp,
} from './builtins.js';
import { CommandDispatcher } from './dispatcher.js';
import { CommandRegistry } from './registry.js';
import { createSkillCommandDefinitions } from './skills.js';

function controller(events: string[]): CommandUIController {
  let mode: AgentMode = 'act';
  return {
    showMessage: content => events.push(`message:${content}`),
    async sendUserMessage(content, displayText) { events.push(`send:${displayText}:${content}`); },
    async runSkill(name, args, displayText) { events.push(`skill:${name}:${args}:${displayText}`); },
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
    showSubAgentTasks: id => events.push(`tasks:${id ?? ''}`),
    rewindConversation: () => events.push('rewind'),
    exit: () => events.push('exit'),
  };
}

test('默认注册中心包含十个核心命令和兼容隐藏命令', () => {
  const registry = createDefaultCommandRegistry();
  assert.deepEqual(registry.list().map(item => item.name), [
    'help', 'compact', 'clear', 'plan', 'do', 'session', 'memory',
    'permission', 'tasks', 'status',
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
    '/permission strict', '/tasks sa-1', '/status', '/rewind', '/quit',
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
  assert.equal(events.includes('tasks:sa-1'), true);
  assert.equal(events.includes('rewind'), true);
  assert.equal(events.includes('exit'), true);
});

test('Skill 命令从元信息生成并直接调用 Skill Runtime', async () => {
  const events: string[] = [];
  const registry = createDefaultCommandRegistry(createSkillCommandDefinitions([{
    name: 'review', description: '审查代码',
  }]));
  await new CommandDispatcher(registry).dispatch('/review src/chat', controller(events));
  assert.deepEqual(events, ['skill:review:src/chat:/review src/chat']);
  assert.match(formatCommandHelp(registry), /\/review \[参数\].*审查代码/u);
});
