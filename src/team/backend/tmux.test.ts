import assert from 'node:assert/strict';
import test from 'node:test';
import type { TeamMemberRecord } from '../types.js';
import { TmuxBackend } from './tmux.js';
import type { ProcessRunInput, ProcessRunResult, TeamProcessRunner } from './process-runner.js';

const member = { name: 'coder' } as TeamMemberRecord;
const ok = (stdout = ''): ProcessRunResult => ({ stdout, stderr: '', exitCode: 0, signal: null, timedOut: false, truncated: false, durationMs: 1 });

test('tmux 后端探测环境并用独立 argv 创建 Worker', async () => {
  const calls: ProcessRunInput[] = [];
  const runner = { run: async (input: ProcessRunInput) => { calls.push(input); return ok(calls.length === 1 ? '%1\n' : ''); } } as TeamProcessRunner;
  const backend = new TmuxBackend(runner);
  assert.equal((await backend.probe({ cwd: '/repo', environment: {}, workerDescriptor: '/safe' })).available, false);
  const instance = await backend.spawn({ member, context: { cwd: '/repo with space', environment: { TMUX: 'x' }, workerDescriptor: '/tmp/worker data.json' } });
  assert.equal(instance.paneId, '%1');
  assert.equal(calls[0]?.command, 'tmux');
  assert.deepEqual(calls[0]?.args?.slice(0, 7), ['split-window', '-P', '-F', '#{pane_id}', '-c', '/repo with space', '--']);
  assert.equal(calls[0]?.args?.at(-1), '/tmp/worker data.json');
});

test('tmux 后端拒绝伪造 pane ID', async () => {
  const runner = { run: async () => ok('%1; rm -rf /') } as unknown as TeamProcessRunner;
  await assert.rejects(
    () => new TmuxBackend(runner).spawn({ member, context: { cwd: '/repo', environment: {}, workerDescriptor: '/safe' } }),
    /pane ID 无效/,
  );
});
