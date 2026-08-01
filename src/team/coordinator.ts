import type { AgentDefinitionManager } from '../subagent/definition-manager.js';
import { createToolSuccess, type JsonObject, type ToolContext, type ToolResult } from '../tool/types.js';
import type { WorktreeManager } from '../worktree/manager.js';
import type { TeamBackendManager } from './backend/manager.js';
import type { BackendInstance, TeamBackendRequest } from './backend/types.js';
import { TeamError, teamDiagnostic } from './errors.js';
import type { TeamApprovalService } from './approval-service.js';
import type { TeamIntegrationManager } from './integration-manager.js';
import type { TeamMailboxService } from './mailbox-service.js';
import type { TeamPathGuard } from './path-guard.js';
import type { TeamRepository } from './repository.js';
import type { TeamTaskService } from './task-service.js';
import type { TeamToolHandler } from './tools.js';
import { TeamToolPolicy } from './tool-policy.js';
import { buildLeadSupplemental } from './prompts.js';
import type { ToolResult as PolicyToolResult } from '../tool/types.js';
import type {
  LeadActor,
  ResolvedTeamOptions,
  TeamActor,
  TeamBackendKind,
  TeamMemberRecord,
  TeamSnapshot,
  TeamToolName,
} from './types.js';
import { writeWorkerDescriptor } from './worker-entry.js';

export type TeamEvent =
  | { type: 'team_changed'; team: string; summary: string }
  | { type: 'member_changed'; team: string; member: string; summary: string }
  | { type: 'task_changed'; team: string; taskId: string; summary: string }
  | { type: 'integration_changed'; team: string; integrationId: string; summary: string };

export interface TeamCoordinatorOptions {
  projectRoot: string;
  repositoryId: string;
  configPath?: string;
  resolved: ResolvedTeamOptions;
  definitions: Pick<AgentDefinitionManager, 'get'>;
  repository: TeamRepository;
  tasks: TeamTaskService;
  mailbox: TeamMailboxService;
  approvals: TeamApprovalService;
  integrations: Pick<TeamIntegrationManager, 'start' | 'status' | 'continue' | 'abort'>;
  backends: TeamBackendManager;
  guard: TeamPathGuard;
  worktrees?: WorktreeManager;
  authorizeCoordinatorCommand?(command: string, rootDir: string): PolicyToolResult | undefined;
}

export class TeamCoordinator {
  private readonly listeners = new Set<(event: TeamEvent) => void>();
  private readonly activeSessions = new Map<string, string>();
  private closed = false;

  constructor(private readonly options: TeamCoordinatorOptions) {}

  listTeams(): TeamSnapshot[] {
    return this.options.repository.list();
  }

  createTeam(name: string, sessionId: string): TeamSnapshot {
    this.assertOpen();
    this.options.repository.create({
      name,
      repositoryId: this.options.repositoryId,
      projectRoot: this.options.projectRoot,
    });
    const snapshot = this.useTeam(name, sessionId);
    this.publish({ type: 'team_changed', team: snapshot.team.name, summary: `已创建并启用团队 ${snapshot.team.name}` });
    return snapshot;
  }

  useTeam(name: string, sessionId: string): TeamSnapshot {
    this.assertOpen();
    const current = this.options.repository.activeForSession(sessionId);
    const snapshot = current?.team.name === name
      ? current
      : this.options.repository.activate(name, sessionId, this.options.repositoryId);
    this.activeSessions.set(sessionId, snapshot.team.name);
    this.publish({ type: 'team_changed', team: snapshot.team.name, summary: `当前会话已切换到团队 ${snapshot.team.name}` });
    return snapshot;
  }

  active(sessionId: string): TeamSnapshot | undefined {
    const name = this.activeSessions.get(sessionId);
    return name ? this.options.repository.get(name) : this.options.repository.activeForSession(sessionId);
  }

  leadActor(sessionId: string): LeadActor | undefined {
    const team = this.active(sessionId)?.team;
    return team ? { kind: 'lead', team: team.name, sessionId, generation: team.generation } : undefined;
  }

  status(sessionId: string): Record<string, unknown> {
    const actor = this.leadActor(sessionId);
    if (!actor) return { active: false, coordinator: this.options.resolved.coordinator };
    const snapshot = this.active(sessionId)!;
    const tasks = this.options.tasks.list(actor);
    return {
      active: true,
      team: snapshot.team,
      members: snapshot.members,
      tasks,
      pendingApprovals: this.options.approvals.list(actor).filter(item => item.state === 'pending').length,
      unreadMessages: this.options.mailbox.unread(actor).length,
      coordinator: this.options.resolved.coordinator,
    };
  }

  promptContent(sessionId: string) {
    return buildLeadSupplemental(this.status(sessionId));
  }

  toolPolicy(sessionId: () => string): TeamToolPolicy {
    return new TeamToolPolicy({
      actor: () => this.leadActor(sessionId()),
      approvals: this.options.approvals,
      coordinatorActive: () => this.options.resolved.coordinator.active,
      ...(this.options.authorizeCoordinatorCommand ? {
        authorizeCoordinatorCommand: this.options.authorizeCoordinatorCommand,
      } : {}),
    });
  }

  async archiveTeam(name: string): Promise<TeamSnapshot> {
    const snapshot = this.options.repository.get(name);
    if (!snapshot) throw new TeamError('TEAM_NOT_FOUND', `团队不存在: ${name}`);
    const actor: LeadActor = { kind: 'lead', team: name, sessionId: 'archive', generation: snapshot.team.generation };
    for (const member of snapshot.members.filter(item => item.state !== 'terminated')) {
      await this.terminateMember(actor, member.name, '团队归档');
    }
    const archived = this.options.repository.archive(name);
    this.publish({ type: 'team_changed', team: name, summary: `团队 ${name} 已归档` });
    return archived;
  }

  restoreTeam(name: string): TeamSnapshot {
    const snapshot = this.options.repository.restore(name);
    this.publish({ type: 'team_changed', team: name, summary: `团队 ${name} 已恢复` });
    return snapshot;
  }

  toolHandler(actor: (context: ToolContext) => TeamActor | undefined): TeamToolHandler {
    return { execute: (tool, input, context) => this.executeTool(actor, tool, input, context) };
  }

  async wake(team: string, memberName: string): Promise<void> {
    const member = this.options.repository.getMember(team, memberName);
    if (!member?.backendInstanceId) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', '成员后端实例不存在');
    const backend = this.options.backends.get(member.backend, member.backendName);
    if (!backend) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', `成员后端未注册: ${member.backend}`);
    await backend.wake(this.instance(member));
  }

  subscribe(listener: (event: TeamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
    this.activeSessions.clear();
  }

  private async executeTool(
    actorSource: (context: ToolContext) => TeamActor | undefined,
    tool: TeamToolName,
    input: JsonObject,
    context: ToolContext,
  ): Promise<ToolResult> {
    const actor = actorSource(context);
    if (!actor) throw new TeamError('TEAM_STATE_ERROR', '当前没有激活团队身份');
    let value: unknown;
    switch (tool) {
      case 'team_status':
        value = actor.kind === 'lead' ? this.status(actor.sessionId) : {
          team: actor.team,
          member: this.options.repository.getMember(actor.team, actor.member),
          tasks: this.options.tasks.list(actor),
          unreadMessages: this.options.mailbox.unread(actor).length,
        };
        break;
      case 'team_member':
        value = await this.memberAction(actor as LeadActor, input, context.signal);
        break;
      case 'team_task':
        value = await this.taskAction(actor, input, context.signal);
        break;
      case 'team_message':
        value = await this.messageAction(actor, input, context.signal);
        break;
      case 'team_approval':
        value = await this.approvalAction(actor, input);
        break;
      case 'team_integrate':
        value = await this.integrationAction(actor as LeadActor, input, context.signal);
        break;
    }
    return createToolSuccess(JSON.stringify(value, null, 2));
  }

  private async memberAction(actor: LeadActor, input: JsonObject, signal: AbortSignal): Promise<unknown> {
    this.requireLead(actor);
    const action = String(input.action);
    if (action === 'list') return this.options.repository.listMembers(actor.team);
    const member = requiredString(input.member, 'member');
    if (action === 'create') return this.createMember(actor, {
      name: member,
      role: requiredString(input.role, 'role'),
      backend: optionalString(input.backend) ?? 'auto',
      requiresApproval: input.requires_approval === true,
    });
    if (action === 'resume') {
      await this.wake(actor.team, member);
      return this.options.repository.getMember(actor.team, member);
    }
    if (action === 'terminate') return this.terminateMember(actor, member, optionalString(input.reason) ?? 'Lead 请求终止', signal);
    throw new TeamError('TEAM_STATE_ERROR', `未知成员动作: ${action}`);
  }

  private async createMember(actor: LeadActor, input: {
    name: string;
    role: string;
    backend: string;
    requiresApproval: boolean;
  }): Promise<TeamMemberRecord> {
    const team = this.requireLead(actor);
    if (this.options.repository.getMember(actor.team, input.name)) throw new TeamError('TEAM_STATE_ERROR', '团队成员已存在');
    if (!this.options.definitions.get(input.role)) throw new TeamError('TEAM_STATE_ERROR', `成员角色不存在: ${input.role}`);
    const descriptorPath = this.options.guard.runtimeFile(actor.team, input.name, 'worker');
    const selected = await this.options.backends.select(parseBackend(input.backend), {
      cwd: team.projectRoot,
      environment: process.env,
      workerDescriptor: descriptorPath,
    });
    const now = new Date().toISOString();
    const emptyUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    let member = this.options.repository.writeMember(actor.team, {
      version: 1,
      revision: 0,
      name: input.name,
      role: input.role,
      roleRevision: 1,
      state: 'creating',
      backend: selected.backend.kind,
      ...(selected.backend.kind === 'custom' ? { backendName: selected.backend.name } : {}),
      requiresApproval: input.requiresApproval,
      rootDir: team.projectRoot,
      contextPath: this.options.guard.contextFile(actor.team, input.name),
      generation: actor.generation,
      usage: emptyUsage,
      createdAt: now,
      lastActiveAt: now,
    }, 0);
    writeWorkerDescriptor(this.options.guard, {
      version: 1,
      team: actor.team,
      member: member.name,
      generation: actor.generation,
      repositoryId: team.repositoryId,
      projectRoot: team.projectRoot,
      ...(this.options.configPath ? { configPath: this.options.configPath } : {}),
      createdAt: now,
    });
    try {
      const instance = await selected.backend.spawn({ member, context: {
        cwd: team.projectRoot, environment: process.env, workerDescriptor: descriptorPath,
      } });
      member = this.options.repository.writeMember(actor.team, {
        ...member,
        state: 'idle',
        backendInstanceId: instance.id,
        lastActiveAt: new Date().toISOString(),
      }, member.revision);
      this.publish({ type: 'member_changed', team: actor.team, member: member.name, summary: `已创建成员 ${member.name}` });
      return member;
    } catch (error) {
      this.options.repository.writeMember(actor.team, {
        ...member,
        state: 'failed',
        lastError: teamDiagnostic('TEAM_BACKEND_UNAVAILABLE', error instanceof Error ? error.message : String(error)),
      }, member.revision);
      throw error;
    }
  }

  private async terminateMember(actor: LeadActor, name: string, reason: string, signal = AbortSignal.timeout(10_000)): Promise<TeamMemberRecord> {
    this.requireLead(actor);
    let member = this.options.repository.getMember(actor.team, name);
    if (!member) throw new TeamError('TEAM_MEMBER_NOT_FOUND', `成员不存在: ${name}`);
    if (member.state === 'terminated') return member;
    member = this.options.repository.writeMember(actor.team, { ...member, state: 'stopping', lastActiveAt: new Date().toISOString() }, member.revision);
    const backend = this.options.backends.get(member.backend, member.backendName);
    if (backend && member.backendInstanceId) await backend.terminate(this.instance(member), signal);
    member = this.options.repository.writeMember(actor.team, {
      ...member,
      state: 'terminated',
      currentTaskId: undefined,
      lastActiveAt: new Date().toISOString(),
      lastError: teamDiagnostic('TEAM_STATE_ERROR', reason),
    }, member.revision);
    this.publish({ type: 'member_changed', team: actor.team, member: name, summary: `成员 ${name} 已终止` });
    return member;
  }

  private async taskAction(actor: TeamActor, input: JsonObject, signal: AbortSignal): Promise<unknown> {
    const action = String(input.action);
    if (action === 'list') return this.options.tasks.list(actor);
    if (action === 'get') return this.options.tasks.get(actor.team, requiredString(input.task_id, 'task_id'));
    if (actor.kind === 'member') {
      if (action !== 'report') throw new TeamError('TEAM_STATE_ERROR', '成员只能报告任务');
      const task = this.options.tasks.report(actor, {
        taskId: requiredString(input.task_id, 'task_id'),
        state: requiredString(input.state, 'state') as 'running' | 'completed' | 'failed',
        ...(optionalString(input.result_summary) ? { resultSummary: optionalString(input.result_summary) } : {}),
        ...(optionalString(input.branch) ? { branch: optionalString(input.branch) } : {}),
        ...(optionalString(input.commit) ? { commit: optionalString(input.commit) } : {}),
      });
      this.publish({ type: 'task_changed', team: actor.team, taskId: task.id, summary: `任务 ${task.id} 更新为 ${task.state}` });
      return task;
    }
    let task;
    if (action === 'create') task = this.options.tasks.create(actor, {
      title: requiredString(input.title, 'title'),
      description: requiredString(input.description, 'description'),
      dependencies: stringArray(input.dependencies),
    });
    else if (action === 'update') task = this.options.tasks.update(actor, {
      taskId: requiredString(input.task_id, 'task_id'),
      ...(optionalString(input.title) ? { title: optionalString(input.title) } : {}),
      ...(optionalString(input.description) ? { description: optionalString(input.description) } : {}),
      ...(Array.isArray(input.dependencies) ? { dependencies: stringArray(input.dependencies) } : {}),
    });
    else if (action === 'assign') {
      task = this.options.tasks.assign(actor, requiredString(input.task_id, 'task_id'), requiredString(input.member, 'member'));
      const member = this.options.repository.getMember(actor.team, task.assignee!)!;
      this.options.repository.writeMember(actor.team, { ...member, currentTaskId: task.id, lastActiveAt: new Date().toISOString() }, member.revision);
      if (task.state === 'ready') await this.options.mailbox.send(actor, {
        recipient: task.assignee!, type: 'task_notification', taskId: task.id,
        body: task.description, summary: `已分派任务 ${task.id}: ${task.title}`, wake: true,
      }, signal);
    } else if (action === 'reopen') task = this.options.tasks.reopen(actor, requiredString(input.task_id, 'task_id'));
    else if (action === 'cancel') task = this.options.tasks.cancel(actor, requiredString(input.task_id, 'task_id'), requiredString(input.reason, 'reason'));
    else throw new TeamError('TEAM_STATE_ERROR', `未知任务动作: ${action}`);
    this.publish({ type: 'task_changed', team: actor.team, taskId: task.id, summary: `任务 ${task.id} 更新为 ${task.state}` });
    return task;
  }

  private messageAction(actor: TeamActor, input: JsonObject, signal: AbortSignal): Promise<unknown> | unknown {
    const action = String(input.action);
    if (action === 'read') return this.options.mailbox.unread(actor);
    if (action === 'mark_read') return this.options.mailbox.markRead(actor, stringArray(input.message_ids), signal).then(() => ({ marked: stringArray(input.message_ids).length }));
    const payload = {
      body: requiredString(input.body, 'body'),
      ...(optionalString(input.summary) ? { summary: optionalString(input.summary) } : {}),
      ...(optionalString(input.task_id) ? { taskId: optionalString(input.task_id) } : {}),
      ...(optionalString(input.message_type) ? { type: optionalString(input.message_type) as never } : {}),
    };
    if (action === 'broadcast') return this.options.mailbox.broadcast(actor, payload, signal);
    return this.options.mailbox.send(actor, { ...payload, recipient: requiredString(input.recipient, 'recipient') }, signal);
  }

  private approvalAction(actor: TeamActor, input: JsonObject): Promise<unknown> | unknown {
    const action = String(input.action);
    if (action === 'list') return actor.kind === 'lead' ? this.options.approvals.list(actor) : [];
    if (action === 'submit' && actor.kind === 'member') return this.options.approvals.submit(actor, {
      taskId: requiredString(input.task_id, 'task_id'),
      plan: requiredString(input.plan, 'plan'),
      expectedOperations: stringArray(input.expected_operations),
    });
    if (action === 'decide' && actor.kind === 'lead') return this.options.approvals.decide(actor, {
      approvalId: requiredString(input.approval_id, 'approval_id'),
      decision: requiredString(input.decision, 'decision') as 'approve' | 'reject',
      ...(optionalString(input.comment) ? { comment: optionalString(input.comment) } : {}),
    });
    throw new TeamError('TEAM_STATE_ERROR', `当前身份不能执行审批动作: ${action}`);
  }

  private integrationAction(actor: LeadActor, input: JsonObject, signal: AbortSignal): Promise<unknown> | unknown {
    this.requireLead(actor);
    const action = String(input.action);
    if (action === 'start') return this.options.integrations.start(actor, stringArray(input.task_ids), signal);
    const id = requiredString(input.integration_id, 'integration_id');
    if (action === 'status') return this.options.integrations.status(actor, id);
    if (action === 'continue' || action === 'finalize') return this.options.integrations.continue(actor, id, signal);
    if (action === 'abort') return this.options.integrations.abort(actor, id);
    throw new TeamError('TEAM_STATE_ERROR', `未知集成动作: ${action}`);
  }

  private requireLead(actor: LeadActor) {
    const team = this.options.repository.get(actor.team)?.team;
    if (!team || team.generation !== actor.generation || team.state !== 'active') throw new TeamError('TEAM_STATE_ERROR', 'Team Lead 身份已失效');
    return team;
  }

  private instance(member: TeamMemberRecord): BackendInstance {
    return {
      kind: member.backend,
      id: member.backendInstanceId!,
      ...(member.backend !== 'coroutine' ? { paneId: member.backendInstanceId } : {}),
      ...(member.backendName ? { backendName: member.backendName } : {}),
    };
  }

  private publish(event: TeamEvent): void {
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch {}
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new TeamError('TEAM_STATE_ERROR', 'TeamCoordinator 已关闭');
  }
}

function parseBackend(value: string): TeamBackendRequest {
  if (value === 'auto') return { kind: 'auto' };
  if (value.startsWith('custom:')) return { kind: 'custom', name: value.slice('custom:'.length) };
  if (['tmux', 'wezterm', 'iterm2', 'coroutine'].includes(value)) return { kind: value as TeamBackendKind };
  throw new TeamError('TEAM_BACKEND_UNAVAILABLE', `成员后端无效: ${value}`);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TeamError('TEAM_STATE_ERROR', `${name} 不能为空`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : [];
}
