import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '../provider/types.js';
import { resolveContextOptions } from './constants.js';
import { groupHistory, HistoryPlanner } from './history-planner.js';
import { TokenEstimator } from './token-estimator.js';

const estimator = new TokenEstimator();

function toolBatch(): Message[] {
  return [
    {
      role: 'assistant',
      content: '读取中',
      toolCalls: [
        { id: 'one', name: 'read_file', arguments: { path: 'a.ts' } },
        { id: 'two', name: 'read_file', arguments: { path: 'b.ts' } },
      ],
    },
    { role: 'tool', toolCallId: 'one', toolName: 'read_file', content: 'a', isError: false },
    { role: 'tool', toolCallId: 'two', toolName: 'read_file', content: 'b', isError: false },
  ];
}

test('工具调用与结果组成不可拆分原子组', () => {
  const history: Message[] = [{ role: 'user', content: '开始' }, ...toolBatch()];
  const units = groupHistory(history, estimator);
  assert.equal(units.length, 2);
  assert.equal(units[1].kind, 'tool_batch');
  assert.equal(units[1].messages.length, 3);
});

test('工具协议拒绝缺失、乱序、重复和孤立结果', () => {
  assert.throws(() => groupHistory([toolBatch()[0]], estimator), /缺少顺序匹配/);
  assert.throws(() => groupHistory([
    toolBatch()[0],
    toolBatch()[2],
    toolBatch()[1],
  ], estimator), /缺少顺序匹配/);
  const duplicate = toolBatch()[0];
  if (duplicate.role === 'assistant' && duplicate.toolCalls) duplicate.toolCalls[1].id = 'one';
  assert.throws(() => groupHistory([duplicate, toolBatch()[1], toolBatch()[1]], estimator), /重复/);
  assert.throws(() => groupHistory([toolBatch()[1]], estimator), /孤立/);
});

test('近期边界同时满足消息数并保持工具组完整', () => {
  const planner = new HistoryPlanner(estimator, resolveContextOptions({
    recentHistoryTokens: 1,
    recentHistoryMessages: 3,
  }));
  const history: Message[] = [
    { role: 'user', content: '最早要求' },
    { role: 'assistant', content: '早期回答' },
    { role: 'user', content: '读取文件' },
    ...toolBatch(),
  ];
  const plan = planner.createPlan(history);
  assert.ok(plan);
  assert.equal(plan.recentMessages.length, 3);
  assert.equal(plan.recentMessages[0].role, 'assistant');
  assert.deepEqual(plan.preservedUserMessages.map(message => message.content), ['最早要求', '读取文件']);
});

test('摘要写回逐字保留用户消息并合并旧摘要', () => {
  const planner = new HistoryPlanner(estimator, resolveContextOptions({
    recentHistoryTokens: 1,
    recentHistoryMessages: 1,
  }));
  const history: Message[] = [
    { role: 'user', content: '  **原文**\n```ts\nconst x = 1;\n```' },
    { role: 'instruction', instructionKind: 'context_summary', content: '旧摘要' },
    { role: 'instruction', instructionKind: 'context_boundary', content: '旧边界' },
    { role: 'assistant', content: '旧回答' },
    { role: 'user', content: '最新要求' },
  ];
  const plan = planner.createPlan(history);
  assert.ok(plan);
  const result = planner.applySummary(history, plan, '## 当前目标与任务状态\n新摘要');
  assert.deepEqual(
    result.filter(message => message.role === 'user').map(message => message.content),
    history.filter(message => message.role === 'user').map(message => message.content),
  );
  assert.equal(result.filter(message =>
    message.role === 'instruction' && message.instructionKind === 'context_summary').length, 1);
  planner.validate(result);
});

test('短历史和纯用户历史没有压缩计划', () => {
  const planner = new HistoryPlanner(estimator, resolveContextOptions());
  assert.equal(planner.createPlan([{ role: 'user', content: '只有用户消息' }]), undefined);
});
