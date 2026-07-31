import assert from 'node:assert/strict';
import test from 'node:test';
import type { SubAgentTaskSnapshot } from './types.js';
import { formatTaskDetail, formatTaskList } from './format.js';

const task: SubAgentTaskSnapshot = {
  id: 'sa-1', kind: 'defined', role: 'general', task: '检查项目', origin: 'tool', sessionId: 's1',
  executionMode: 'background', backgroundReason: 'timeout', state: 'completed',
  createdAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z',
  stopReason: 'completed', iterations: 2,
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheCreationInputTokens: 3, cacheReadInputTokens: 4 },
  result: '完成',
};

test('任务格式化覆盖空列表、摘要和详情', () => {
  assert.equal(formatTaskList([]), '当前会话没有子 Agent 任务。');
  assert.match(formatTaskList([task]), /sa-1 \[completed\] defined\/general，后台\/timeout - 检查项目/);
  assert.match(formatTaskDetail(task, task.id), /Token: 输入 10 \/ 输出 5 \/ 总计 15/);
  assert.match(formatTaskDetail(task, task.id), /缓存: 创建 3 \/ 命中 4/);
  assert.match(formatTaskDetail(undefined, 'missing'), /未找到.*missing.*\/tasks/);
});
