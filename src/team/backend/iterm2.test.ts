import assert from 'node:assert/strict';
import test from 'node:test';
import type { TeamMemberRecord } from '../types.js';
import { ITerm2Backend } from './iterm2.js';
import type { ProcessRunInput, ProcessRunResult, TeamProcessRunner } from './process-runner.js';

const member = { name: 'coder' } as TeamMemberRecord;
const result = (stdout = ''): ProcessRunResult => ({ stdout, stderr: '', exitCode: 0, signal: null, timedOut: false, truncated: false, durationMs: 1 });

test('iTerm2 后端使用固定 AppleScript 并转义 Worker 路径', async () => {
  const calls: ProcessRunInput[] = [];
  const runner = { run: async (input: ProcessRunInput) => { calls.push(input); return result('ABCDEF12-3456\n'); } } as TeamProcessRunner;
  const backend = new ITerm2Backend(runner);
  const instance = await backend.spawn({ member, context: { cwd: '/repo', environment: {}, workerDescriptor: "/tmp/a b'c.json" } });
  assert.equal(instance.paneId, 'ABCDEF12-3456');
  assert.equal(calls[0]?.command, 'osascript');
  assert.equal(calls[0]?.args?.[0], '-e');
  assert.match(calls[0]?.args?.[2] ?? '', /'"'"'/);
  assert.doesNotMatch(calls[0]?.args?.[1] ?? '', /a b/);
});

test('iTerm2 后端在非 iTerm 环境中不可用并校验 session ID', async () => {
  const runner = { run: async () => result('bad id;') } as unknown as TeamProcessRunner;
  const backend = new ITerm2Backend(runner);
  assert.equal((await backend.probe({ cwd: '/repo', environment: {}, workerDescriptor: '/safe' })).available, false);
  await assert.rejects(
    () => backend.spawn({ member, context: { cwd: '/repo', environment: {}, workerDescriptor: '/safe' } }),
    /创建窗格失败/,
  );
});
