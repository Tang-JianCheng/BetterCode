import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TeamProcessRunner } from './backend/process-runner.js';
import { TeamIntegrationGit } from './integration-git.js';

function git(root: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture(t: test.TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-integration-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  git(root, 'init');
  git(root, 'config', 'user.name', 'BetterCode Test');
  git(root, 'config', 'user.email', 'bettercode@example.test');
  writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', '初始化');
  const mainBranch = git(root, 'branch', '--show-current');
  return { root, mainBranch, client: new TeamIntegrationGit(new TeamProcessRunner(), '/usr/bin/git') };
}

test('集成 Git 客户端读取状态并完成无冲突合并和快进', async t => {
  const { root, mainBranch, client } = fixture(t);
  const base = await client.head(root);
  git(root, 'checkout', '-b', 'member');
  writeFileSync(path.join(root, 'member.txt'), '成员成果\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', '成员成果');
  const commit = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', mainBranch);
  const integration = path.join(path.dirname(root), `${path.basename(root)}-worktree`);
  t.after(() => rmSync(integration, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  git(root, 'worktree', 'add', '-b', 'integration', integration, base);
  assert.equal((await client.merge(integration, commit)).ok, true);
  const next = await client.fastForward(root, 'integration', base);
  assert.equal(next, git(root, 'rev-parse', 'integration'));
});

test('集成 Git 客户端暴露冲突并支持解决后继续', async t => {
  const { root, mainBranch, client } = fixture(t);
  const base = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-b', 'member');
  writeFileSync(path.join(root, 'base.txt'), 'member\n');
  git(root, 'commit', '-am', '成员修改');
  const memberCommit = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', mainBranch);
  writeFileSync(path.join(root, 'base.txt'), 'lead\n');
  git(root, 'commit', '-am', 'Lead 修改');
  const integration = path.join(path.dirname(root), `${path.basename(root)}-conflict`);
  t.after(() => rmSync(integration, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  git(root, 'worktree', 'add', '-b', 'integration-conflict', integration, 'HEAD');
  const merged = await client.merge(integration, memberCommit);
  assert.equal(merged.ok, false);
  assert.deepEqual(merged.conflicts, ['base.txt']);
  writeFileSync(path.join(integration, 'base.txt'), 'resolved\n');
  git(integration, 'add', 'base.txt');
  await client.continueMerge(integration);
  assert.equal(await client.hasUnmerged(integration), false);
  assert.notEqual(await client.head(integration), base);
});

test('集成 Git 客户端支持 abort 并保护 Lead HEAD 变化', async t => {
  const { root, mainBranch, client } = fixture(t);
  const expected = await client.head(root);
  git(root, 'checkout', '-b', 'member');
  writeFileSync(path.join(root, 'base.txt'), 'member\n');
  git(root, 'commit', '-am', '成员修改');
  const memberCommit = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', mainBranch);
  writeFileSync(path.join(root, 'base.txt'), 'lead\n');
  git(root, 'commit', '-am', 'Lead 修改');
  const current = await client.head(root);
  await assert.rejects(() => client.fastForward(root, 'member', expected), /HEAD/);
  const result = await client.merge(root, memberCommit);
  assert.equal(result.ok, false);
  await client.abortMerge(root);
  assert.equal(await client.head(root), current);
  assert.equal(await client.hasUnmerged(root), false);
});
