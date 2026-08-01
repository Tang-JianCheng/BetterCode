import assert from 'node:assert/strict';
import test from 'node:test';
import { TeamProcessRunner } from './process-runner.js';

test('ProcessRunner 保持 argv 边界且不启用 shell', async () => {
  const runner = new TeamProcessRunner();
  const result = await runner.run({
    command: process.execPath,
    args: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '带 空格', '; echo injected'],
    cwd: process.cwd(),
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), ['带 空格', '; echo injected']);
  assert.equal(result.timedOut, false);
  assert.equal(result.truncated, false);
  assert.ok(result.durationMs >= 0);
});

test('ProcessRunner 超时和取消都会终止子进程', async () => {
  const runner = new TeamProcessRunner(30);
  const timedOut = await runner.run({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: process.cwd(),
  });
  assert.equal(timedOut.timedOut, true);
  assert.notEqual(timedOut.signal, null);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const cancelled = await runner.run({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: process.cwd(),
    timeoutMs: 2_000,
    signal: controller.signal,
  });
  assert.equal(cancelled.timedOut, false);
  assert.notEqual(cancelled.signal, null);
});

test('ProcessRunner 对标准输出和错误输出分别限流', async () => {
  const runner = new TeamProcessRunner(2_000, 16);
  const result = await runner.run({
    command: process.execPath,
    args: ['-e', 'process.stdout.write("x".repeat(40)); process.stderr.write("y".repeat(40))'],
    cwd: process.cwd(),
  });
  assert.equal(Buffer.byteLength(result.stdout), 16);
  assert.equal(Buffer.byteLength(result.stderr), 16);
  assert.equal(result.truncated, true);
});
