import { randomUUID } from 'node:crypto';
import type { Tool } from '../tool/types.js';
import { AtomicJsonStore, isRevisionedRecord } from './atomic-store.js';
import { TeamError } from './errors.js';
import { TeamMailboxService } from './mailbox-service.js';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import { TeamTaskService } from './task-service.js';
import type {
  LeadActor,
  MemberActor,
  TeamApprovalCollection,
  TeamApprovalRecord,
} from './types.js';

function validCollection(value: unknown): value is TeamApprovalCollection {
  return isRevisionedRecord(value) && typeof value === 'object' && value !== null &&
    (value as TeamApprovalCollection).version === 1 &&
    typeof (value as TeamApprovalCollection).approvals === 'object';
}

function emptyCollection(): TeamApprovalCollection {
  return { version: 1, revision: 0, approvals: {} };
}

export class TeamApprovalService {
  constructor(
    private readonly guard: TeamPathGuard,
    private readonly repository: TeamRepository,
    private readonly tasks: TeamTaskService,
    private readonly mailbox: TeamMailboxService,
  ) {}

  async submit(actor: MemberActor, input: {
    taskId: string;
    plan: string;
    expectedOperations?: readonly string[];
  }): Promise<TeamApprovalRecord> {
    const member = this.requireMember(actor);
    if (!member.requiresApproval) throw new TeamError('TEAM_STATE_ERROR', '该成员不需要计划审批');
    const task = this.tasks.get(actor.team, input.taskId);
    if (!task || task.assignee !== actor.member || task.state !== 'ready') {
      throw new TeamError('TEAM_STATE_ERROR', '当前任务不能提交审批计划');
    }
    const plan = input.plan.trim();
    if (!plan) throw new TeamError('TEAM_STATE_ERROR', '审批计划不能为空');
    const approval = this.update(actor.team, collection => {
      let nextVersion = 1;
      for (const existing of Object.values(collection.approvals)) {
        if (existing.taskId !== input.taskId || existing.member !== actor.member) continue;
        nextVersion = Math.max(nextVersion, existing.planVersion + 1);
        if (existing.state === 'pending' || existing.state === 'approved') existing.state = 'superseded';
      }
      const record: TeamApprovalRecord = {
        id: randomUUID(),
        taskId: input.taskId,
        member: actor.member,
        planVersion: nextVersion,
        plan: plan.slice(0, 64 * 1024),
        expectedOperations: [...new Set((input.expectedOperations ?? []).map(item => item.trim()).filter(Boolean))],
        state: 'pending',
        requestedAt: new Date().toISOString(),
      };
      collection.approvals[record.id] = record;
      return record;
    });
    this.tasks.markWaitingApproval(actor, input.taskId);
    await this.mailbox.send(actor, {
      recipient: 'lead',
      type: 'approval_request',
      body: approval.plan,
      summary: `成员 ${actor.member} 请求审批任务 ${input.taskId}`,
      taskId: input.taskId,
      approvalId: approval.id,
      planVersion: approval.planVersion,
    });
    return approval;
  }

  async decide(actor: LeadActor, input: {
    approvalId: string;
    decision: 'approve' | 'reject';
    comment?: string;
  }): Promise<TeamApprovalRecord> {
    this.requireLead(actor);
    const approval = this.update(actor.team, collection => {
      const current = collection.approvals[input.approvalId];
      if (!current) throw new TeamError('TEAM_STATE_ERROR', `审批不存在: ${input.approvalId}`);
      if (current.state !== 'pending') throw new TeamError('TEAM_STATE_ERROR', '审批已经处理或失效');
      const task = this.tasks.get(actor.team, current.taskId);
      if (!task || task.assignee !== current.member || task.state !== 'waiting_approval') {
        throw new TeamError('TEAM_STATE_ERROR', '审批关联的任务或成员已变化');
      }
      const next: TeamApprovalRecord = {
        ...current,
        state: input.decision === 'approve' ? 'approved' : 'rejected',
        decidedAt: new Date().toISOString(),
        decidedBy: 'lead',
        ...(input.comment?.trim() ? { comment: input.comment.trim().slice(0, 10_000) } : {}),
      };
      collection.approvals[next.id] = next;
      return next;
    });
    if (input.decision === 'approve') this.tasks.approve(actor, approval.taskId);
    else this.tasks.markReadyAfterRejection(actor, approval.taskId);
    await this.mailbox.send(actor, {
      recipient: approval.member,
      type: 'approval_response',
      body: approval.comment ?? (input.decision === 'approve' ? '计划已批准' : '计划已驳回'),
      summary: `任务 ${approval.taskId} 的计划已${input.decision === 'approve' ? '批准' : '驳回'}`,
      taskId: approval.taskId,
      approvalId: approval.id,
      planVersion: approval.planVersion,
      decision: input.decision,
      wake: true,
    });
    return approval;
  }

  activeApproval(team: string, taskId: string, member: string): TeamApprovalRecord | undefined {
    return Object.values(this.collection(team).approvals)
      .filter(item => item.taskId === taskId && item.member === member && item.state === 'approved')
      .sort((left, right) => right.planVersion - left.planVersion)[0];
  }

  authorizeTool(actor: MemberActor, taskId: string, tool: Tool): void {
    if (tool.effect !== 'side_effect') return;
    const member = this.requireMember(actor);
    if (!member.requiresApproval) return;
    if (!this.activeApproval(actor.team, taskId, actor.member)) {
      throw new TeamError('TEAM_APPROVAL_REQUIRED', '当前任务尚未获得有效计划批准');
    }
  }

  list(actor: LeadActor): TeamApprovalRecord[] {
    this.requireLead(actor);
    return Object.values(this.collection(actor.team).approvals)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
      .map(item => structuredClone(item));
  }

  supersedeTask(team: string, taskId: string): void {
    this.update(team, collection => {
      for (const approval of Object.values(collection.approvals)) {
        if (approval.taskId === taskId && (approval.state === 'pending' || approval.state === 'approved')) {
          approval.state = 'superseded';
        }
      }
    });
  }

  private collection(team: string): TeamApprovalCollection {
    return this.store(team).read() ?? emptyCollection();
  }

  private update<T>(team: string, mutate: (collection: TeamApprovalCollection) => T): T {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const store = this.store(team);
      const current = store.read() ?? emptyCollection();
      const draft = structuredClone(current);
      const result = mutate(draft);
      try {
        store.write(draft, current.revision);
        return structuredClone(result);
      } catch (error) {
        if (!(error instanceof TeamError) || error.code !== 'TEAM_CONFLICT' || attempt === 2) throw error;
      }
    }
    throw new TeamError('TEAM_CONFLICT', '更新审批记录失败');
  }

  private store(team: string): AtomicJsonStore<TeamApprovalCollection> {
    return new AtomicJsonStore(this.guard.team(team).approvalsFile, validCollection);
  }

  private requireLead(actor: LeadActor) {
    const team = this.repository.get(actor.team)?.team;
    if (!team || team.generation !== actor.generation || team.state !== 'active') {
      throw new TeamError('TEAM_STATE_ERROR', 'Team Lead 身份已失效');
    }
    return team;
  }

  private requireMember(actor: MemberActor) {
    const team = this.repository.get(actor.team)?.team;
    const member = this.repository.getMember(actor.team, actor.member);
    if (!team || !member || team.generation !== actor.generation || member.generation !== actor.generation) {
      throw new TeamError('TEAM_STATE_ERROR', '团队成员身份已失效');
    }
    return member;
  }
}
