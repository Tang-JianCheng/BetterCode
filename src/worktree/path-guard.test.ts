import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorktreePathGuard } from './path-guard.js';

test('Worktree 路径守卫拒绝相似前缀和外部符号链接', t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'bettercode-worktree-path-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'repo');
  const outside = path.join(parent, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  const guard = new WorktreePathGuard(root);
  guard.ensureRoots();
  const location = guard.location('reviewer/sa-1');
  mkdirSync(path.dirname(location.rootDir), { recursive: true });
  symlinkSync(outside, location.rootDir);
  assert.throws(() => guard.assertExistingWorktree(location.rootDir), /越界/);
  assert.throws(() => guard.assertTarget(path.join(root, '.bettercode', 'worktrees'), path.join(parent, 'repo-other', 'x')), /越界/);
});
