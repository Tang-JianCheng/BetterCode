import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TeamApprovalService } from './approval-service.js';
import { TeamMailboxService } from './mailbox-service.js';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import { TeamTaskService } from './task-service.js';
import type { Tool } from '../tool/types.js';
import type { LeadActor, MemberActor, TeamMemberRecord } from './types.js';

const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

function setup(t: test.TestContext) {
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-team-approval-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const guard = new TeamPathGuard(home);
  const repository = new TeamRepository(guard);
  repository.create({ name: 'alpha', repositoryId: 'repo', projectRoot: '/tmp/repo' });
  const active = repository.activate('alpha', 'session', 'repo').team;
  const now = new Date().toISOString();
  const record: TeamMemberRecord = {
    version: 1, revision: 0, name: 'worker', role: 'general', roleRevision: 1, state: 'idle',
    backend: 'coroutine', requiresApproval: true, rootDir: '/tmp/repo',
    contextPath: guard.contextFile('alpha', 'worker'), generation: active.generation,
    usage, createdAt: now, lastActiveAt: now,
  };
  repository.writeMember('alpha', record, 0);
  const lead: LeadActor = { kind: 'lead', team: 'alpha', sessionId: 'session', generation: active.generation };
  const member: MemberActor = { kind: 'member', team: 'alpha', member: 'worker', generation: active.generation };
  const tasks = new TeamTaskService(guard, repository);
  const task = tasks.create(lead, { title: '实现', description: '实现功能' });
  tasks.assign(lead, task.id, 'worker');
  const mailbox = new TeamMailboxService(guard, repository, { lockTimeoutMs: 1_000, retryIntervalMs: 5, staleLockMs: 200 });
  return { service: new TeamApprovalService(guard, repository, tasks, mailbox), tasks, lead, member, task };
}

const writeTool = { effect: 'side_effect' } as Tool;

test('审批按任务与计划版本放行副作用工具', async t => {
  const { service, lead, member, task } = setup(t);
  const approval = await service.submit(member, { taskId: task.id, plan: '先读后改', expectedOperations: ['write_file'] });
  assert.throws(() => service.authorizeTool(member, task.id, writeTool), /尚未获得/);
  const decided = await service.decide(lead, { approvalId: approval.id, decision: 'approve' });
  assert.equal(decided.state, 'approved');
  assert.doesNotThrow(() => service.authorizeTool(member, task.id, writeTool));
});

test('驳回计划不放行且新版本使旧记录失效', async t => {
  const { service, tasks, lead, member, task } = setup(t);
  const first = await service.submit(member, { taskId: task.id, plan: '第一版' });
  await service.decide(lead, { approvalId: first.id, decision: 'reject', comment: '补充测试' });
  assert.equal(tasks.get('alpha', task.id)?.state, 'ready');
  const second = await service.submit(member, { taskId: task.id, plan: '第二版' });
  assert.equal(second.planVersion, 2);
  await assert.rejects(service.decide(lead, { approvalId: first.id, decision: 'approve' }), /已经处理或失效/);
});
