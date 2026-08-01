import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TeamError } from './errors.js';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import { TeamTaskService } from './task-service.js';
import type { LeadActor, MemberActor, TeamMemberRecord } from './types.js';

const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

function setup(t: test.TestContext) {
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-team-task-'));
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
  const member = (name: string): MemberActor => ({ kind: 'member', team: 'alpha', member: name, generation: active.generation });
  return { service: new TeamTaskService(guard, repository), lead, member };
}

test('任务依赖形成稳定 DAG 并传播阻塞状态', t => {
  const { service, lead, member } = setup(t);
  const first = service.create(lead, { title: '基础', description: '先完成基础' });
  const second = service.create(lead, { title: '后续', description: '依赖基础', dependencies: [first.id] });
  assert.equal(first.state, 'pending');
  assert.equal(second.state, 'blocked');
  service.assign(lead, first.id, 'one');
  service.assign(lead, second.id, 'two');
  service.report(member('one'), { taskId: first.id, state: 'running' });
  service.report(member('one'), { taskId: first.id, state: 'completed', resultSummary: '完成' });
  assert.equal(service.get('alpha', second.id)?.state, 'ready');
  assert.deepEqual(service.topologicalOrder('alpha').map(task => task.id), [first.id, second.id]);
});

test('任务依赖拒绝未知、自依赖和循环', t => {
  const { service, lead } = setup(t);
  assert.throws(() => service.create(lead, {
    title: '坏任务', description: '未知依赖', dependencies: ['task-9999'],
  }), (error: unknown) => error instanceof TeamError && error.code === 'TEAM_TASK_NOT_FOUND');
  const first = service.create(lead, { title: '一', description: '一' });
  const second = service.create(lead, { title: '二', description: '二', dependencies: [first.id] });
  assert.throws(() => service.update(lead, { taskId: first.id, dependencies: [second.id] }), /循环/);
  assert.throws(() => service.update(lead, { taskId: first.id, dependencies: [first.id] }), /自身/);
});

test('任务所有权、终态和重新打开受状态机约束', t => {
  const { service, lead, member } = setup(t);
  const task = service.create(lead, { title: '实现', description: '完成实现' });
  service.assign(lead, task.id, 'one');
  assert.throws(() => service.report(member('two'), { taskId: task.id, state: 'running' }), /自己的任务/);
  service.report(member('one'), { taskId: task.id, state: 'running' });
  service.report(member('one'), { taskId: task.id, state: 'completed', branch: 'team/one', commit: 'abc' });
  assert.equal(service.cancel(lead, task.id, '无需继续').state, 'completed');
  assert.equal(service.reopen(lead, task.id).state, 'ready');
  assert.equal(service.get('alpha', task.id)?.history.at(-1)?.reason, '重新打开任务');
});
