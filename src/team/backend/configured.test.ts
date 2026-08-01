import assert from 'node:assert/strict';
import test from 'node:test';
import type { TeamCustomTerminalConfig } from '../../config/types.js';
import type { TeamMemberRecord } from '../types.js';
import { ConfiguredTerminalBackend } from './configured.js';
import type { ProcessRunInput, ProcessRunResult, TeamProcessRunner } from './process-runner.js';

const member = { name: 'coder' } as TeamMemberRecord;
const config: TeamCustomTerminalConfig = {
  name: 'terminal-x',
  detect: { command: 'detect', args: ['--cwd', '{cwd}'] },
  spawn: { command: 'spawn', args: ['{worker_descriptor}', '{cwd}'] },
  wake: { command: 'wake', args: ['{pane_id}'] },
  terminate: { command: 'stop', args: ['{pane_id}'] },
};
const result = (stdout = ''): ProcessRunResult => ({ stdout, stderr: '', exitCode: 0, signal: null, timedOut: false, truncated: false, durationMs: 1 });

test('配置终端只在单个 argv 元素内替换占位符', async () => {
  const calls: ProcessRunInput[] = [];
  const runner = { run: async (input: ProcessRunInput) => { calls.push(input); return result(input.command === 'spawn' ? 'pane:1' : ''); } } as TeamProcessRunner;
  const backend = new ConfiguredTerminalBackend(config, runner);
  assert.equal((await backend.probe({ cwd: '/repo with space', environment: {}, workerDescriptor: '/worker' })).available, true);
  const instance = await backend.spawn({ member, context: { cwd: '/repo with space', environment: {}, workerDescriptor: '/tmp/a;echo.json' } });
  assert.equal(instance.backendName, 'terminal-x');
  assert.deepEqual(calls[1]?.args, ['/tmp/a;echo.json', '/repo with space']);
  await backend.wake(instance);
  assert.deepEqual(calls[2]?.args, ['pane:1']);
});

test('配置终端拒绝未知占位符和非法 pane ID', async () => {
  const invalid = { ...config, detect: { command: 'detect', args: ['{unknown}'] } };
  const runner = { run: async () => result('bad pane') } as unknown as TeamProcessRunner;
  await assert.rejects(
    () => new ConfiguredTerminalBackend(invalid, runner).probe({ cwd: '/repo', environment: {}, workerDescriptor: '/safe' }),
    /缺少占位符值/,
  );
  await assert.rejects(
    () => new ConfiguredTerminalBackend(config, runner).spawn({ member, context: { cwd: '/repo', environment: {}, workerDescriptor: '/safe' } }),
    /创建窗格失败/,
  );
});
