import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandRegistry } from './registry.js';
import {
  buildCommandErrorPresentation,
  buildHelpPresentation,
  buildMemoryPresentation,
  buildStatusPresentation,
  presentationToPlainText,
} from './presenters.js';

function registry(): CommandRegistry {
  const result = new CommandRegistry();
  result.register({
    name: 'help', aliases: ['h'], description: '显示帮助', usage: '/help [命令]',
    argumentHint: '[命令]', type: 'local', handler() {},
  });
  result.register({
    name: 'plan', aliases: [], description: '进入计划模式', usage: '/plan',
    type: 'ui', handler() {},
  });
  result.register({
    name: 'hidden', aliases: [], description: '隐藏', usage: '/hidden',
    type: 'local', hidden: true, handler() {},
  });
  return result;
}

test('帮助 presenter 生成命令目录与单命令详情', () => {
  const all = buildHelpPresentation(registry());
  assert.equal(all.kind, 'document');
  assert.match(presentationToPlainText(all), /命令目录.*\/help \[命令\].*\/plan/su);
  assert.doesNotMatch(presentationToPlainText(all), /hidden/u);

  const one = buildHelpPresentation(registry(), '/help');
  assert.equal(one.kind, 'document');
  assert.match(presentationToPlainText(one), /别名: \/h/u);
  const missing = buildHelpPresentation(registry(), 'missing');
  assert.equal(missing.kind, 'notice');
  assert.equal(missing.kind === 'notice' ? missing.tone : '', 'danger');
});

test('状态与记忆 presenter 保留结构化数据', () => {
  const memory = {
    userDirectory: '/home/.bettercode/memory', projectDirectory: '/repo/.bettercode/memory',
    userCount: 2, projectCount: 3,
  };
  const status = buildStatusPresentation({
    provider: { name: 'deepseek', model: 'deepseek-chat' },
    agentMode: 'plan', permissionMode: 'default', sessionId: 's1', memory,
    activeSkills: ['review'],
  });
  assert.match(presentationToPlainText(status), /BetterCode 状态.*deepseek-chat.*PLAN.*暂无用量数据/su);
  assert.match(presentationToPlainText(buildMemoryPresentation(memory)), /用户级: 2 条/u);
});

test('命令错误使用危险通知而不是助手消息', () => {
  const item = buildCommandErrorPresentation('/missing', '使用 /help 查看命令');
  assert.equal(item.kind, 'notice');
  if (item.kind === 'notice') {
    assert.equal(item.tone, 'danger');
    assert.match(item.message ?? '', /\/help/u);
  }
});
