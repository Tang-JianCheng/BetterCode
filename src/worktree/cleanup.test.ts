import assert from 'node:assert/strict';
import test from 'node:test';
import { WorktreeCleanupScheduler } from './cleanup.js';
import type { WorktreeManager } from './manager.js';
import type { WorktreeMetadataStore } from './metadata-store.js';
import type { WorktreeMetadata, WorktreeRemovalResult } from './types.js';

function metadata(name: string, lastUsedAt: string): WorktreeMetadata {
  return {
    version: 1,
    name,
    repositoryId: '/repo/.git',
    mainRoot: '/repo',
    worktreeRoot: `/repo/.bettercode/worktrees/${name}`,
    gitDir: `/repo/.git/worktrees/${name}`,
    branch: `bettercode/worktree/${name}`,
    baseCommit: 'a'.repeat(40),
    state: 'ready',
    createdAt: lastUsedAt,
    lastUsedAt,
    initializationComplete: true,
  };
}

test('过期清理只处理到期候选并合并并发扫描', async () => {
  const removed: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const manager = {
    activeLeaseCount: () => 0,
    remove: async (name: string): Promise<WorktreeRemovalResult> => {
      removed.push(name);
      await gate;
      return { status: 'deleted', name, cwd: `/repo/${name}`, branch: `branch/${name}` };
    },
  } as unknown as WorktreeManager;
  const store = {
    list: () => [
      metadata('expired', '2026-07-01T00:00:00.000Z'),
      metadata('fresh', '2026-07-30T00:00:00.000Z'),
    ],
  } as unknown as WorktreeMetadataStore;
  const scheduler = new WorktreeCleanupScheduler(manager, store, 7 * 24 * 60 * 60 * 1000, 60_000);
  const first = scheduler.runNow(new Date('2026-07-31T00:00:00.000Z'));
  const second = scheduler.runNow(new Date('2026-07-31T00:00:00.000Z'));
  assert.equal(first, second);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(removed, ['expired']);
  release();
  assert.equal((await first)[0].status, 'deleted');
  await scheduler.close();
});
