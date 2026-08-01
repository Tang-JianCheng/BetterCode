import assert from 'node:assert/strict';
import test from 'node:test';
import { TeamBackendManager } from './manager.js';
import type { BackendProbeContext, TeamMemberBackend } from './types.js';

const context: BackendProbeContext = { cwd: '/repo', environment: {}, workerDescriptor: '/descriptor.json' };

function backend(name: string, kind: TeamMemberBackend['kind'], probe: TeamMemberBackend['probe']): TeamMemberBackend {
  return {
    name,
    kind,
    probe,
    spawn: async () => ({ kind, id: name }),
    wake: async () => {},
    terminate: async () => ({ stopped: true, forced: false, uncertain: false }),
  };
}

test('后端管理器按注册顺序选择第一个可用独立后端', async () => {
  const calls: string[] = [];
  const manager = new TeamBackendManager([
    backend('tmux', 'tmux', async () => { calls.push('tmux'); return { available: false, reason: '无会话' }; }),
    backend('wezterm', 'wezterm', async () => { calls.push('wezterm'); return { available: true }; }),
    backend('custom', 'custom', async () => { calls.push('custom'); return { available: true }; }),
  ]);
  const selected = await manager.select({ kind: 'auto' }, context);
  assert.equal(selected.backend.name, 'wezterm');
  assert.deepEqual(calls, ['tmux', 'wezterm']);
});

test('自动模式不静默降级到协程并保留探测诊断', async () => {
  const manager = new TeamBackendManager([
    backend('broken', 'tmux', async () => { throw new Error('探测异常'); }),
    backend('coroutine', 'coroutine', async () => ({ available: true })),
  ]);
  await assert.rejects(
    () => manager.select({ kind: 'auto' }, context),
    error => error instanceof Error && /显式指定 backend: coroutine/.test(error.message),
  );
  const selected = await manager.select({ kind: 'coroutine' }, context);
  assert.equal(selected.backend.kind, 'coroutine');
});

test('自定义后端可以按名称显式选择', async () => {
  const manager = new TeamBackendManager([
    backend('one', 'custom', async () => ({ available: true })),
    backend('two', 'custom', async () => ({ available: true })),
  ]);
  const selected = await manager.select({ kind: 'custom', name: 'two' }, context);
  assert.equal(selected.backend.name, 'two');
});
