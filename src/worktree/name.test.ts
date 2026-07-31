import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWorktreeName } from './name.js';

test('Worktree 名称支持安全嵌套并拒绝路径遍历和非法 Git 引用', () => {
  assert.equal(validateWorktreeName('reviewer/sa-1234_ab.cd'), 'reviewer/sa-1234_ab.cd');
  for (const value of [
    '', '/root', 'a//b', 'a/../b', 'a/./b', 'a\\b', 'a..b', 'a.lock', 'a/@{b', '.hidden', 'trail.',
  ]) {
    assert.throws(() => validateWorktreeName(value), /Worktree 名称/);
  }
});

test('Worktree 名称执行总长和单段长度上限', () => {
  assert.equal(validateWorktreeName('a'.repeat(48)), 'a'.repeat(48));
  assert.throws(() => validateWorktreeName('a'.repeat(49)), /名称段无效/);
  assert.throws(() => validateWorktreeName(`a/${'b'.repeat(48)}/${'c'.repeat(48)}/${'d'.repeat(30)}`), /长度/);
});
