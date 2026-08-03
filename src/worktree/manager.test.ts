import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GitWorktreeClient } from './git-client.js';
import { WorktreeInitializer } from './initializer.js';
import { WorktreeManager } from './manager.js';
import { WorktreeMetadataStore } from './metadata-store.js';
import { WorktreePathGuard } from './path-guard.js';
import { resolveWorktreeOptions } from './types.js';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

async function fixture(t: test.TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-worktree-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  git(root, 'init');
  git(root, 'config', 'user.name', 'BetterCode Test');
  git(root, 'config', 'user.email', 'bettercode@example.test');
  writeFileSync(path.join(root, '.gitignore'), '.bettercode/worktrees/\n.bettercode/worktree-state/\n.env\n');
  writeFileSync(path.join(root, 'base.txt'), 'base');
  git(root, 'add', '.');
  git(root, 'commit', '-m', '初始化');
  const guard = new WorktreePathGuard(root);
  const metadata = new WorktreeMetadataStore(guard);
  const client = new GitWorktreeClient();
  const initializer = new WorktreeInitializer(guard, client, resolveWorktreeOptions());
  const manager = new WorktreeManager(guard, metadata, client, initializer);
  await manager.initialize();
  t.after(() => manager.close());
  return { root, guard, metadata, manager };
}

test('Worktree Manager 创建专属分支并自动清理无变更任务', async t => {
  const { root, manager } = await fixture(t);
  const beforeCwd = process.cwd();
  const lease = await manager.acquire('reviewer/sa-clean');
  assert.equal(process.cwd(), beforeCwd);
  assert.equal(readFileSync(path.join(lease.cwd, 'base.txt'), 'utf8'), 'base');
  assert.equal(git(lease.cwd, 'branch', '--show-current'), 'bettercode/worktree/reviewer/sa-clean');
  assert.equal(git(lease.cwd, 'rev-parse', 'HEAD'), git(root, 'rev-parse', 'HEAD'));
  const result = await manager.finalize(lease.leaseId);
  assert.equal(result.status, 'deleted');
  assert.equal(existsSync(lease.cwd), false);
  assert.equal(git(root, 'branch', '--list', 'bettercode/worktree/reviewer/sa-clean'), '');
});

test('Worktree Manager 保留 dirty 工作区并允许显式强制删除', async t => {
  const { manager, metadata } = await fixture(t);
  const lease = await manager.acquire('reviewer/sa-dirty');
  writeFileSync(path.join(lease.cwd, 'result.txt'), '未提交成果');
  const retained = await manager.finalize(lease.leaseId);
  assert.equal(retained.status, 'retained');
  assert.equal(existsSync(lease.cwd), true);
  assert.equal(metadata.read(lease.name)?.state, 'retained');
  const deleted = await manager.remove(lease.name, { force: true });
  assert.equal(deleted.status, 'deleted');
  assert.equal(existsSync(lease.cwd), false);
});

test('Worktree Manager 活动租约保护和快速恢复不调用 Git', async t => {
  const { manager } = await fixture(t);
  const lease = await manager.acquire('reviewer/sa-recover');
  await assert.rejects(() => manager.remove(lease.name, { force: true }), /活动租约/);
  await manager.exit(lease.leaseId);
  const internal = manager as unknown as { git: Record<string, unknown> };
  const originalGit = internal.git;
  internal.git = new Proxy(originalGit, {
    get() {
      return () => { throw new Error('快速恢复不应调用 Git'); };
    },
  });
  const recovered = await manager.enter(lease.name);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.cwd, lease.cwd);
  await manager.exit(recovered.leaseId);
});

test('Worktree Manager 保护未推送提交并在推送后允许删除', async t => {
  const { root, manager } = await fixture(t);
  const remote = mkdtempSync(path.join(tmpdir(), 'bettercode-worktree-remote-'));
  t.after(() => rmSync(remote, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  git(remote, 'init', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  const lease = await manager.acquire('reviewer/sa-push');
  writeFileSync(path.join(lease.cwd, 'committed.txt'), '提交成果');
  git(lease.cwd, 'add', 'committed.txt');
  git(lease.cwd, 'commit', '-m', '新增成果');
  const retained = await manager.finalize(lease.leaseId);
  assert.equal(retained.status, 'retained');
  assert.match(retained.status === 'retained' ? retained.reasons.join(' ') : '', /没有上游/);
  git(lease.cwd, 'push', '-u', 'origin', 'HEAD');
  const deleted = await manager.remove(lease.name);
  assert.equal(deleted.status, 'deleted');
  assert.equal(existsSync(lease.cwd), false);
});

test('Worktree Manager 只清理已被目标分支包含的干净成果', async t => {
  const { root, manager } = await fixture(t);
  const lease = await manager.acquire('team/alpha/alice');
  writeFileSync(path.join(lease.cwd, 'integrated.txt'), '成果');
  git(lease.cwd, 'add', 'integrated.txt');
  git(lease.cwd, 'commit', '-m', '团队成果');
  await manager.exit(lease.leaseId);
  const retained = await manager.removeIntegrated(lease.name, 'HEAD');
  assert.equal(retained.status, 'retained');
  assert.match(retained.status === 'retained' ? retained.reasons.join(' ') : '', /尚未/);
  git(root, 'merge', '--ff-only', lease.branch);
  const deleted = await manager.removeIntegrated(lease.name, 'HEAD');
  assert.equal(deleted.status, 'deleted');
});

test('Worktree Manager 已集成清理仍保护脏目录和活动租约', async t => {
  const { root, manager } = await fixture(t);
  const lease = await manager.acquire('team/alpha/bob');
  await assert.rejects(() => manager.removeIntegrated(lease.name, 'HEAD'), /活动租约/);
  await manager.exit(lease.leaseId);
  writeFileSync(path.join(lease.cwd, 'dirty.txt'), '未提交');
  const retained = await manager.removeIntegrated(lease.name, git(root, 'rev-parse', 'HEAD'));
  assert.equal(retained.status, 'retained');
  assert.match(retained.status === 'retained' ? retained.reasons.join(' ') : '', /未提交/);
});
