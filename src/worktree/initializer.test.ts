import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GitWorktreeClient } from './git-client.js';
import { WorktreeInitializer } from './initializer.js';
import { WorktreePathGuard } from './path-guard.js';
import { resolveWorktreeOptions, type WorktreeMetadata } from './types.js';

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

test('Worktree 初始化复制本地配置、软链依赖并区分 required', async t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'bettercode-initializer-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'repo');
  mkdirSync(root);
  git(root, 'init');
  writeFileSync(path.join(root, '.gitignore'), '.env\n');
  writeFileSync(path.join(root, '.env'), 'LOCAL=1\n', { mode: 0o600 });
  mkdirSync(path.join(root, 'node_modules'));
  writeFileSync(path.join(root, 'node_modules', 'marker'), 'dependency');
  const guard = new WorktreePathGuard(root);
  guard.ensureRoots();
  const worktreeRoot = guard.location('reviewer/sa-init').rootDir;
  mkdirSync(worktreeRoot, { recursive: true });
  const metadata: WorktreeMetadata = {
    version: 1,
    name: 'reviewer/sa-init',
    repositoryId: path.join(root, '.git'),
    mainRoot: guard.mainRoot,
    worktreeRoot,
    gitDir: path.join(root, '.git', 'worktrees', 'sa-init'),
    branch: 'bettercode/worktree/reviewer/sa-init',
    baseCommit: 'a'.repeat(40),
    state: 'creating',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    initializationComplete: false,
  };
  const client = new GitWorktreeClient();
  const initializer = new WorktreeInitializer(guard, client, resolveWorktreeOptions());
  const diagnostics = await initializer.initialize(metadata);
  assert.equal(readFileSync(path.join(worktreeRoot, '.env'), 'utf8'), 'LOCAL=1\n');
  assert.equal(existsSync(path.join(worktreeRoot, 'node_modules')), true);
  assert.equal(
    realpathSync(path.resolve(worktreeRoot, readlinkSync(path.join(worktreeRoot, 'node_modules')))),
    realpathSync(path.join(root, 'node_modules')),
  );
  assert.deepEqual(diagnostics, []);

  const strict = new WorktreeInitializer(guard, client, resolveWorktreeOptions({
    copy_files: [{ source: 'missing.file', required: true }],
  }));
  await assert.rejects(() => strict.initialize(metadata), /必需初始化规则失败/);

  const outside = path.join(parent, 'outside.txt');
  writeFileSync(outside, 'outside');
  const escaped = new WorktreeInitializer(guard, client, resolveWorktreeOptions({
    copy_files: [{ source: '../outside.txt', required: true }],
  }));
  await assert.rejects(() => escaped.initialize(metadata), /必需初始化规则失败/);
});
