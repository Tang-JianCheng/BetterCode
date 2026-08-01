import { randomUUID } from 'node:crypto';
import { TeamError } from './errors.js';
import { MailboxStore } from './mailbox-store.js';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import type { ResolvedTeamOptions, TeamActor, TeamMessage, TeamMessageType } from './types.js';

export interface MemberWakeDispatcher {
  wake(team: string, member: string): Promise<void>;
}

export interface SendMessageInput {
  recipient: string;
  type?: TeamMessageType;
  body: string;
  summary?: string;
  taskId?: string;
  approvalId?: string;
  planVersion?: number;
  decision?: 'approve' | 'reject';
  wake?: boolean;
}

export interface MessageDeliveryResult {
  message: TeamMessage;
  wakeError?: string;
}

export class TeamMailboxService {
  constructor(
    private readonly guard: TeamPathGuard,
    private readonly repository: TeamRepository,
    private readonly options: ResolvedTeamOptions['mailbox'],
    private readonly wakeDispatcher?: MemberWakeDispatcher,
  ) {}

  async send(actor: TeamActor, input: SendMessageInput, signal?: AbortSignal): Promise<MessageDeliveryResult> {
    const team = this.requireTeam(actor);
    const sender = actor.kind === 'lead' ? 'lead' : actor.member;
    const recipient = this.guard.memberName(input.recipient, { allowLead: true });
    if (recipient !== 'lead' && !this.repository.getMember(actor.team, recipient)) {
      throw new TeamError('TEAM_MEMBER_NOT_FOUND', `收件人不存在: ${recipient}`);
    }
    const type = input.type ?? 'text';
    this.validateProtocol(type, input);
    const body = input.body.trim();
    if (!body) throw new TeamError('TEAM_STATE_ERROR', '消息正文不能为空');
    const defaultWake = type === 'task_notification' || type === 'approval_response';
    const message: TeamMessage = {
      id: randomUUID(),
      type,
      sender,
      recipient,
      body: body.slice(0, 128 * 1024),
      summary: (input.summary?.trim() || body).slice(0, 500),
      timestamp: new Date().toISOString(),
      read: false,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.approvalId ? { approvalId: input.approvalId } : {}),
      ...(input.planVersion === undefined ? {} : { planVersion: input.planVersion }),
      ...(input.decision ? { decision: input.decision } : {}),
      wake: input.wake ?? defaultWake,
    };
    await this.store(actor.team, recipient, team.generation).append(message, signal, team.generation);
    let wakeError: string | undefined;
    if (message.wake && recipient !== 'lead' && this.wakeDispatcher) {
      try {
        await this.wakeDispatcher.wake(actor.team, recipient);
      } catch (error) {
        wakeError = error instanceof Error ? error.message : String(error);
      }
    }
    return { message: structuredClone(message), ...(wakeError ? { wakeError } : {}) };
  }

  async broadcast(
    actor: TeamActor,
    input: Omit<SendMessageInput, 'recipient'>,
    signal?: AbortSignal,
  ): Promise<{ delivered: MessageDeliveryResult[]; failed: { recipient: string; message: string }[] }> {
    const members = this.repository.listMembers(actor.team)
      .filter(member => member.state !== 'terminated')
      .map(member => member.name)
      .filter(member => actor.kind !== 'member' || member !== actor.member);
    const delivered: MessageDeliveryResult[] = [];
    const failed: { recipient: string; message: string }[] = [];
    for (const recipient of members) {
      try {
        delivered.push(await this.send(actor, { ...input, recipient, wake: input.wake ?? false }, signal));
      } catch (error) {
        failed.push({ recipient, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { delivered, failed };
  }

  unread(actor: TeamActor, afterId?: string): TeamMessage[] {
    const team = this.requireTeam(actor);
    const recipient = actor.kind === 'lead' ? 'lead' : actor.member;
    return this.store(actor.team, recipient, team.generation).unread(afterId);
  }

  async markRead(actor: TeamActor, ids: readonly string[], signal?: AbortSignal): Promise<void> {
    const team = this.requireTeam(actor);
    const recipient = actor.kind === 'lead' ? 'lead' : actor.member;
    await this.store(actor.team, recipient, team.generation).markRead(ids, signal, team.generation);
  }

  private store(team: string, recipient: string, generation: number): MailboxStore {
    return new MailboxStore(this.guard.mailboxFile(team, recipient), {
      ...this.options,
      generationValid: value => value === generation,
    });
  }

  private requireTeam(actor: TeamActor) {
    const team = this.repository.get(actor.team)?.team;
    if (!team || team.state !== 'active' || team.generation !== actor.generation) {
      throw new TeamError('TEAM_STATE_ERROR', '团队消息 actor 已失效');
    }
    if (actor.kind === 'member') {
      const member = this.repository.getMember(actor.team, actor.member);
      if (!member || member.generation !== actor.generation || member.state === 'terminated') {
        throw new TeamError('TEAM_STATE_ERROR', '团队成员消息身份已失效');
      }
    }
    return team;
  }

  private validateProtocol(type: TeamMessageType, input: SendMessageInput): void {
    if (type === 'task_notification' || type === 'member_idle' || type === 'member_interrupted') {
      if (!input.taskId) throw new TeamError('TEAM_STATE_ERROR', `${type} 必须关联 taskId`);
    }
    if (type === 'approval_request' || type === 'approval_response') {
      if (!input.taskId || !input.approvalId || !Number.isInteger(input.planVersion)) {
        throw new TeamError('TEAM_STATE_ERROR', `${type} 必须关联任务、审批和计划版本`);
      }
    }
    if (type === 'approval_response' && input.decision !== 'approve' && input.decision !== 'reject') {
      throw new TeamError('TEAM_STATE_ERROR', 'approval_response 必须包含 approve 或 reject');
    }
  }
}
