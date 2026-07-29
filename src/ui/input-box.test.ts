import assert from 'node:assert/strict';
import test from 'node:test';
import { navigateHistory } from './input-box.js';

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
