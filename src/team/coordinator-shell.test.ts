import assert from 'node:assert/strict';
import test from 'node:test';
import { CoordinatorShellPolicy } from './coordinator-shell.js';

const policy = new CoordinatorShellPolicy(() => ({
  leadRoot: '/repo', memberRoots: ['/repo/.bettercode/worktrees/team/alpha/alice'], integrationRoot: '/repo/.bettercode/worktrees/integration/one',
}));

test('Coordinator Shell 允许受控 Git 只读命令与团队目录', () => {
  assert.equal(policy.authorize('git status --short', '/repo'), undefined);
  assert.equal(policy.authorize('git diff --stat HEAD -- src/team/file.ts', '/repo'), undefined);
  assert.equal(policy.authorize('git log --oneline -20', '/repo'), undefined);
  assert.equal(policy.authorize('git -C .bettercode/worktrees/team/alpha/alice show --stat HEAD', '/repo'), undefined);
  assert.equal(policy.authorize('git worktree list --porcelain', '/repo'), undefined);
  assert.equal(policy.authorize('git merge-base --is-ancestor HEAD feature/test', '/repo'), undefined);
});

test('Coordinator Shell 只在活动集成目录允许 merge 控制', () => {
  assert.equal(policy.authorize('git -C .bettercode/worktrees/integration/one merge --continue', '/repo'), undefined);
  assert.match(policy.authorize('git merge --abort', '/repo')?.error?.message ?? '', /活动集成目录/);
  assert.match(policy.authorize('git -C /tmp merge --continue', '/repo')?.error?.message ?? '', /不属于/);
});

test('Coordinator Shell 拒绝 shell 语义、解释器和危险 Git 参数', () => {
  for (const command of [
    'sh -c "git status"',
    'git status; rm -rf .',
    'git status | cat',
    'git diff > out',
    'git status $(touch x)',
    'git -c alias.x=!sh x',
    'git push origin main',
    'git branch -D main',
    'git config --global user.name x',
  ]) {
    assert.equal(policy.authorize(command, '/repo')?.ok, false, command);
  }
});
