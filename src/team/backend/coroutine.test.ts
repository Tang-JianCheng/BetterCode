import assert from 'node:assert/strict';
import test from 'node:test';
import type { TeamMemberRecord } from '../types.js';
import { CoroutineBackend } from './coroutine.js';

const member = { name: 'coder' } as TeamMemberRecord;
const input = { member, context: { cwd: '/repo', environment: {}, workerDescriptor: '/worker' } };

test('协程后端隔离启动、唤醒和取消', async () => {
  const events: string[] = [];
  const backend = new CoroutineBackend({
    run: async (_member, signal) => new Promise<void>(resolve => {
      events.push('run');
      signal.addEventListener('abort', () => { events.push('abort'); resolve(); }, { once: true });
    }),
    wake: async () => { events.push('wake'); },
  });
  const instance = await backend.spawn(input);
  await new Promise(resolve => setImmediate(resolve));
  await backend.wake(instance);
  const result = await backend.terminate(instance, AbortSignal.timeout(500));
  assert.equal(result.stopped, true);
  assert.deepEqual(events, ['run', 'wake', 'abort']);
});

test('单个协程失败不会影响其他成员实例', async () => {
  let runs = 0;
  const backend = new CoroutineBackend({
    run: async (_member, signal) => {
      runs += 1;
      if (runs === 1) throw new Error('成员失败');
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  });
  await backend.spawn(input);
  const second = await backend.spawn(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await backend.terminate(second, AbortSignal.timeout(500))).stopped, true);
});
