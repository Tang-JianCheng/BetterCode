import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TeamMailboxService } from './mailbox-service.js';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import type { LeadActor, MemberActor, TeamMemberRecord } from './types.js';

const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

function setup(t: test.TestContext, wake?: (team: string, member: string) => Promise<void>) {
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-team-mail-service-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const guard = new TeamPathGuard(home);
  const repository = new TeamRepository(guard);
  repository.create({ name: 'alpha', repositoryId: 'repo', projectRoot: '/tmp/repo' });
  const active = repository.activate('alpha', 'session', 'repo').team;
  const now = new Date().toISOString();
  for (const name of ['one', 'two']) {
    const member: TeamMemberRecord = {
      version: 1, revision: 0, name, role: 'general', roleRevision: 1, state: 'idle',
      backend: 'coroutine', requiresApproval: false, rootDir: '/tmp/repo',
      contextPath: guard.contextFile('alpha', name), generation: active.generation,
      usage, createdAt: now, lastActiveAt: now,
    };
    repository.writeMember('alpha', member, 0);
  }
  const lead: LeadActor = { kind: 'lead', team: 'alpha', sessionId: 'session', generation: active.generation };
  const member: MemberActor = { kind: 'member', team: 'alpha', member: 'one', generation: active.generation };
  const service = new TeamMailboxService(
    guard,
    repository,
    { lockTimeoutMs: 1_000, retryIntervalMs: 5, staleLockMs: 200 },
    wake ? { wake } : undefined,
  );
  return { service, lead, member };
}

test('消息身份与时间由系统生成且协议字段受校验', async t => {
  const { service, lead, member } = setup(t);
  const delivered = await service.send(lead, { recipient: 'one', body: '你好' });
  assert.equal(delivered.message.sender, 'lead');
  assert.equal(delivered.message.read, false);
  assert.match(delivered.message.timestamp, /^\d{4}-/u);
  assert.deepEqual(service.unread(member).map(item => item.body), ['你好']);
  await assert.rejects(service.send(member, {
    recipient: 'lead', type: 'approval_request', body: '计划', taskId: 'task-1',
  }), /关联任务、审批和计划版本/);
  await assert.rejects(service.send(lead, { recipient: '../other', body: '越界' }), /名称/);
});

test('广播生成独立消息且默认不唤醒', async t => {
  const wakeCalls: string[] = [];
  const { service, lead } = setup(t, async (_team, member) => { wakeCalls.push(member); });
  const result = await service.broadcast(lead, { body: '公告' });
  assert.equal(result.delivered.length, 2);
  assert.equal(new Set(result.delivered.map(item => item.message.id)).size, 2);
  assert.deepEqual(wakeCalls, []);
});

test('唤醒失败不撤销已落盘消息', async t => {
  const { service, lead, member } = setup(t, async () => { throw new Error('窗格不可用'); });
  const result = await service.send(lead, {
    recipient: 'one', type: 'task_notification', body: '开始任务', taskId: 'task-0001',
  });
  assert.match(result.wakeError ?? '', /窗格不可用/);
  assert.deepEqual(service.unread(member).map(item => item.body), ['开始任务']);
});
