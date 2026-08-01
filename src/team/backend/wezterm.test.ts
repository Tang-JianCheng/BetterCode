import assert from 'node:assert/strict';
import test from 'node:test';
import type { TeamMemberRecord } from '../types.js';
import type { ProcessRunInput, ProcessRunResult, TeamProcessRunner } from './process-runner.js';
import { WezTermBackend } from './wezterm.js';

const member = { name: 'coder' } as TeamMemberRecord;
const result = (stdout = '', exitCode = 0): ProcessRunResult => ({ stdout, stderr: '', exitCode, signal: null, timedOut: false, truncated: false, durationMs: 1 });

test('WezTerm 后端只在对应终端中探测并创建 pane', async () => {
  const calls: ProcessRunInput[] = [];
  const runner = { run: async (input: ProcessRunInput) => { calls.push(input); return result(calls.length === 1 ? '' : '42\n'); } } as TeamProcessRunner;
  const backend = new WezTermBackend(runner);
  assert.equal((await backend.probe({ cwd: '/repo', environment: {}, workerDescriptor: '/safe' })).available, false);
  assert.equal((await backend.probe({ cwd: '/repo', environment: { TERM_PROGRAM: 'WezTerm' }, workerDescriptor: '/safe' })).available, true);
  const instance = await backend.spawn({ member, context: { cwd: '/repo', environment: {}, workerDescriptor: '/worker.json' } });
  assert.equal(instance.paneId, '42');
  assert.deepEqual(calls[1]?.args?.slice(0, 5), ['cli', 'split-pane', '--cwd', '/repo', '--']);
  assert.equal(calls[1]?.args?.at(-1), '/worker.json');
});

test('WezTerm 后端拒绝非法 pane ID', async () => {
  const runner = { run: async () => result('42\n43') } as unknown as TeamProcessRunner;
  await assert.rejects(
    () => new WezTermBackend(runner).spawn({ member, context: { cwd: '/repo', environment: {}, workerDescriptor: '/safe' } }),
    /创建窗格失败/,
  );
});
