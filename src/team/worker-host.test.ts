import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import { resolveTeamOptions, type TeamMemberRecord, type TeamMessage } from './types.js';
import { readWorkerDescriptor, writeWorkerDescriptor, type TeamWorkerDescriptor } from './worker-entry.js';
import { TeamWorkerHost } from './worker-host.js';

const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

function fixture(t: test.TestContext) {
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-worker-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const guard = new TeamPathGuard(home);
  const repository = new TeamRepository(guard);
  const snapshot = repository.create({ name: 'alpha', repositoryId: 'repo-1', projectRoot: home });
  const member: TeamMemberRecord = {
    version: 1, revision: 0, name: 'alice', role: 'reader', roleRevision: 1, state: 'idle', backend: 'coroutine',
    requiresApproval: false, rootDir: home, contextPath: guard.contextFile('alpha', 'alice'), generation: snapshot.team.generation,
    usage, createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(),
  };
  repository.writeMember('alpha', member, 0);
  const descriptor: TeamWorkerDescriptor = {
    version: 1, team: 'alpha', member: 'alice', generation: snapshot.team.generation,
    repositoryId: 'repo-1', projectRoot: home, createdAt: new Date().toISOString(),
  };
  return { home, guard, repository, descriptor };
}

test('Worker 描述文件使用 0600 并校验身份与运行代次', t => {
  const { guard, repository, descriptor } = fixture(t);
  const file = writeWorkerDescriptor(guard, descriptor);
  assert.deepEqual(readWorkerDescriptor(file, guard, repository), descriptor);
  chmodSync(file, 0o644);
  assert.throws(() => readWorkerDescriptor(file, guard, repository), /0600/);
});

test('Worker 描述文件拒绝旧代次和路径身份篡改', t => {
  const { guard, repository, descriptor } = fixture(t);
  const file = writeWorkerDescriptor(guard, { ...descriptor, generation: descriptor.generation + 1 });
  assert.throws(() => readWorkerDescriptor(file, guard, repository), /已失效/);
});

test('Worker Host 用实例租约阻止同一成员双跑', async t => {
  const { guard, repository, descriptor } = fixture(t);
  const options = resolveTeamOptions({ runtime: { heartbeat_interval_ms: 20, heartbeat_timeout_ms: 500, inbox_poll_interval_ms: 20 } });
  const controller = new AbortController();
  const host = new TeamWorkerHost({
    descriptor, guard, repository, mailbox: { unread: () => [] }, operation: { runOnce: async () => {} },
    runtime: options.runtime,
  });
  const running = host.start(controller.signal);
  await new Promise(resolve => setTimeout(resolve, 30));
  const duplicate = new TeamWorkerHost({
    descriptor, guard, repository, mailbox: { unread: () => [] }, operation: { runOnce: async () => {} },
    runtime: options.runtime,
  });
  await assert.rejects(() => duplicate.start(AbortSignal.timeout(100)), /租约|持有/);
  controller.abort();
  await running;
});

test('Worker Host 只为可执行协议消息恢复并合并重复唤醒', async t => {
  const { guard, repository, descriptor } = fixture(t);
  const options = resolveTeamOptions({ runtime: { heartbeat_interval_ms: 20, heartbeat_timeout_ms: 500, inbox_poll_interval_ms: 100 } });
  let messages: TeamMessage[] = [];
  let runs = 0;
  const controller = new AbortController();
  const host = new TeamWorkerHost({
    descriptor, guard, repository, mailbox: { unread: () => messages },
    operation: { runOnce: async () => { runs += 1; messages = []; } }, runtime: options.runtime,
  });
  const running = host.start(controller.signal);
  await new Promise(resolve => setTimeout(resolve, 20));
  messages = [{ type: 'text', wake: false } as TeamMessage];
  host.wake();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(runs, 0);
  messages = [{ type: 'text', wake: true } as TeamMessage];
  host.wake();
  host.wake();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(runs, 1);
  controller.abort();
  await running;
});

test('Worker Host 在团队代次变化后停止', async t => {
  const { guard, repository, descriptor } = fixture(t);
  const options = resolveTeamOptions({ runtime: { heartbeat_interval_ms: 10, heartbeat_timeout_ms: 500, inbox_poll_interval_ms: 10 } });
  const controller = new AbortController();
  const host = new TeamWorkerHost({
    descriptor, guard, repository, mailbox: { unread: () => [] }, operation: { runOnce: async () => {} }, runtime: options.runtime,
  });
  const running = host.start(controller.signal);
  await new Promise(resolve => setTimeout(resolve, 15));
  repository.activate('alpha', 'new-session', 'repo-1');
  await assert.rejects(running, /代次|失效/);
});
