import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileLock } from './file-lock.js';
import { TeamError } from './errors.js';

test('文件锁串行执行并在完成后释放', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-team-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'resource.lock');
  const lock = new FileLock(file, { lockTimeoutMs: 500, retryIntervalMs: 10, staleLockMs: 100 });
  const order: string[] = [];
  await Promise.all([
    lock.withLock(async () => {
      order.push('first-start');
      await new Promise(resolve => setTimeout(resolve, 30));
      order.push('first-end');
    }),
    new Promise<void>(resolve => setTimeout(resolve, 5)).then(() => lock.withLock(() => {
      order.push('second');
    })),
  ]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
});

test('文件锁超时返回结构化错误', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-team-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'resource.lock');
  writeFileSync(file, JSON.stringify({
    version: 1,
    pid: process.pid,
    instanceId: 'other',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
  }));
  const lock = new FileLock(file, { lockTimeoutMs: 30, retryIntervalMs: 10, staleLockMs: 100 });
  await assert.rejects(lock.withLock(() => undefined), (error: unknown) =>
    error instanceof TeamError && error.code === 'TEAM_LOCK_TIMEOUT');
});

test('失效代次允许回收陈旧活进程锁', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-team-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(root, { recursive: true });
  const file = path.join(root, 'resource.lock');
  let now = Date.now();
  writeFileSync(file, JSON.stringify({
    version: 1,
    pid: process.pid,
    instanceId: 'old',
    generation: 1,
    createdAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now - 100).toISOString(),
  }));
  const lock = new FileLock(file, {
    lockTimeoutMs: 100,
    retryIntervalMs: 10,
    staleLockMs: 50,
    generationValid: generation => generation === 2,
    now: () => now,
  });
  await lock.withLock(() => { now += 1; }, undefined, 2);
  assert.equal(now > 0, true);
});
