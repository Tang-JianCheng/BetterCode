import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AgentDefinition } from '../subagent/types.js';
import type { ToolContext } from '../tool/types.js';
import { TeamApprovalService } from './approval-service.js';
import { TeamBackendManager } from './backend/manager.js';
import type { BackendInstance, TeamMemberBackend } from './backend/types.js';
import { TeamCoordinator } from './coordinator.js';
import type { TeamIntegrationManager } from './integration-manager.js';
import { TeamMailboxService } from './mailbox-service.js';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import { TeamTaskService } from './task-service.js';
import { resolveTeamOptions } from './types.js';

function fixture(t: test.TestContext) {
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-coordinator-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const guard = new TeamPathGuard(home);
  const repository = new TeamRepository(guard);
  const tasks = new TeamTaskService(guard, repository);
  const wakes: string[] = [];
  const mailbox = new TeamMailboxService(guard, repository, resolveTeamOptions().mailbox, {
    wake: async (team, member) => { wakes.push(`${team}/${member}`); },
  });
  const approvals = new TeamApprovalService(guard, repository, tasks, mailbox);
  const events: string[] = [];
  const instances = new Map<string, BackendInstance>();
  const backend: TeamMemberBackend = {
    kind: 'coroutine', name: 'coroutine', probe: async () => ({ available: true }),
    spawn: async input => {
      const instance = { kind: 'coroutine' as const, id: `co-${input.member.name}` };
      instances.set(input.member.name, instance);
      return instance;
    },
    wake: async instance => { events.push(`wake:${instance.id}`); },
    terminate: async instance => { events.push(`stop:${instance.id}`); return { stopped: true, forced: false, uncertain: false }; },
  };
  const definition = { name: 'coder' } as AgentDefinition;
  const integration = {
    start: async () => ({ id: 'i1', state: 'completed' }),
    status: () => ({ id: 'i1', state: 'completed' }),
    continue: async () => ({ id: 'i1', state: 'completed' }),
    abort: async () => ({ id: 'i1', state: 'aborted' }),
  } as unknown as TeamIntegrationManager;
  const coordinator = new TeamCoordinator({
    projectRoot: home, repositoryId: 'repo-1', resolved: resolveTeamOptions(),
    definitions: { get: name => name === 'coder' ? definition : undefined },
    repository, tasks, mailbox, approvals, integrations: integration,
    backends: new TeamBackendManager([backend]), guard,
  });
  coordinator.subscribe(event => events.push(event.summary));
  const context = { rootDir: home, signal: new AbortController().signal, maxOutputBytes: 1024 } as ToolContext;
  return { home, guard, repository, tasks, mailbox, approvals, coordinator, wakes, events, context };
}

async function execute(
  coordinator: TeamCoordinator,
  actor: Parameters<TeamCoordinator['toolHandler']>[0],
  tool: Parameters<ReturnType<TeamCoordinator['toolHandler']>['execute']>[0],
  input: Parameters<ReturnType<TeamCoordinator['toolHandler']>['execute']>[1],
  context: ToolContext,
) {
  const result = await coordinator.toolHandler(actor).execute(tool, input, context);
  assert.equal(result.ok, true, result.error?.message);
  return JSON.parse(result.output) as Record<string, unknown>;
}

test('TeamCoordinator 创建团队、成员并保持会话绑定', async t => {
  const { coordinator, repository, context, events } = fixture(t);
  const team = coordinator.createTeam('alpha', 's1');
  const actor = () => coordinator.leadActor('s1');
  const member = await execute(coordinator, actor, 'team_member', {
    action: 'create', member: 'alice', role: 'coder', backend: 'coroutine', requires_approval: true,
  }, context);
  assert.equal(member.name, 'alice');
  assert.equal(repository.getMember('alpha', 'alice')?.state, 'idle');
  assert.equal(coordinator.active('s1')?.team.name, 'alpha');
  assert.equal(team.team.generation, coordinator.leadActor('s1')?.generation);
  assert.ok(events.some(item => /创建成员 alice/.test(item)));
});

test('TeamCoordinator 路由任务、消息与逐任务审批', async t => {
  const { coordinator, tasks, approvals, context, wakes } = fixture(t);
  coordinator.createTeam('alpha', 's1');
  const lead = () => coordinator.leadActor('s1');
  await execute(coordinator, lead, 'team_member', {
    action: 'create', member: 'alice', role: 'coder', backend: 'coroutine', requires_approval: true,
  }, context);
  const task = await execute(coordinator, lead, 'team_task', {
    action: 'create', title: '实现功能', description: '完成代码', dependencies: [],
  }, context);
  await execute(coordinator, lead, 'team_task', { action: 'assign', task_id: task.id, member: 'alice' }, context);
  assert.deepEqual(wakes, ['alpha/alice']);
  const member = () => ({ kind: 'member', team: 'alpha', member: 'alice', generation: coordinator.leadActor('s1')!.generation } as const);
  const approval = await execute(coordinator, member, 'team_approval', {
    action: 'submit', task_id: task.id, plan: '先测试再实现', expected_operations: ['edit_file'],
  }, context);
  assert.equal(tasks.get('alpha', String(task.id))?.state, 'waiting_approval');
  await execute(coordinator, lead, 'team_approval', { action: 'decide', approval_id: approval.id, decision: 'approve' }, context);
  assert.equal(tasks.get('alpha', String(task.id))?.state, 'running');
  assert.equal(approvals.list(coordinator.leadActor('s1')!)[0]?.state, 'approved');
});

test('TeamCoordinator 重启代次同步空闲成员并隔离旧 actor', async t => {
  const { coordinator, repository, context } = fixture(t);
  coordinator.createTeam('alpha', 's1');
  await execute(coordinator, () => coordinator.leadActor('s1'), 'team_member', {
    action: 'create', member: 'alice', role: 'coder', backend: 'coroutine',
  }, context);
  const oldGeneration = coordinator.leadActor('s1')!.generation;
  coordinator.useTeam('alpha', 's2');
  const current = coordinator.leadActor('s2')!;
  assert.ok(current.generation > oldGeneration);
  assert.equal(repository.getMember('alpha', 'alice')?.generation, current.generation);
  const oldActor = () => ({ kind: 'lead', team: 'alpha', sessionId: 's1', generation: oldGeneration } as const);
  await assert.rejects(() => coordinator.toolHandler(oldActor).execute('team_member', { action: 'list' }, context), /失效/);
});

test('TeamCoordinator 终止成员并归档团队', async t => {
  const { coordinator, repository, tasks, context, events } = fixture(t);
  coordinator.createTeam('alpha', 's1');
  const actor = () => coordinator.leadActor('s1');
  await execute(coordinator, actor, 'team_member', {
    action: 'create', member: 'alice', role: 'coder', backend: 'coroutine',
  }, context);
  const task = await execute(coordinator, actor, 'team_task', {
    action: 'create', title: '待终止任务', description: '验证终止语义', dependencies: [],
  }, context);
  await execute(coordinator, actor, 'team_task', { action: 'assign', task_id: task.id, member: 'alice' }, context);
  await execute(coordinator, actor, 'team_member', { action: 'terminate', member: 'alice', reason: '完成' }, context);
  assert.equal(repository.getMember('alpha', 'alice')?.state, 'terminated');
  assert.equal(tasks.get('alpha', String(task.id))?.state, 'cancelled');
  await execute(coordinator, actor, 'team_member', {
    action: 'create', member: 'bob', role: 'coder', backend: 'coroutine',
  }, context);
  const archiveTask = await execute(coordinator, actor, 'team_task', {
    action: 'create', title: '归档中任务', description: '由归档流程取消', dependencies: [],
  }, context);
  await execute(coordinator, actor, 'team_task', { action: 'assign', task_id: archiveTask.id, member: 'bob' }, context);
  const archived = await coordinator.archiveTeam('alpha');
  assert.equal(archived.team.state, 'archived');
  assert.equal(repository.getMember('alpha', 'bob')?.state, 'terminated');
  assert.equal(tasks.get('alpha', String(archiveTask.id))?.state, 'cancelled');
  assert.ok(events.includes('stop:co-alice'));
});
