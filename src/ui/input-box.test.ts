import assert from 'node:assert/strict';
import test from 'node:test';
import {
  moveCompletionIndex,
  navigateHistory,
  resolveCompletion,
} from './input-box.js';

test('输入历史支持上下移动并恢复未提交草稿', () => {
  const history = ['第一条', '第二条'];
  const start = { input: '草稿', cursor: undefined, draft: '' };
  const latest = navigateHistory(history, start, 'up');
  assert.deepEqual(latest, { input: '第二条', cursor: 1, draft: '草稿' });
  const oldest = navigateHistory(history, latest, 'up');
  assert.equal(oldest.input, '第一条');
  assert.equal(navigateHistory(history, oldest, 'down').input, '第二条');
  assert.deepEqual(navigateHistory(history, latest, 'down'), {
    input: '草稿', cursor: undefined, draft: '草稿',
  });
});

test('单个补全直接写回，多候选进入稳定选择菜单', () => {
  const session = {
    name: 'session', value: '/session ', label: '/session [会话 ID]', description: '会话',
  };
  const review = {
    name: 'review', value: '/review ', label: '/review [范围]', description: '审查',
  };
  assert.deepEqual(resolveCompletion('/ses', [session]), {
    input: '/session ', items: [], selectedIndex: 0,
  });
  assert.deepEqual(resolveCompletion('/r', [session, review]), {
    input: '/r', items: [session, review], selectedIndex: 0,
  });
  assert.equal(moveCompletionIndex(0, 2, 'up'), 1);
  assert.equal(moveCompletionIndex(1, 2, 'down'), 0);
});
