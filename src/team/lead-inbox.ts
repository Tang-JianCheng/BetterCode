import type { Message } from '../provider/types.js';
import type { AgentInstructionRuntime, PreparedSubAgentResultBatch, SubAgentResultEntry } from '../subagent/types.js';
import { truncateUtf8 } from '../tool/output-limit.js';
import type { TeamMailboxService } from './mailbox-service.js';
import type { LeadActor, TeamMessage } from './types.js';

const MAX_NOTIFICATION_BYTES = 4 * 1024;
const IMPORTANT_TYPES = new Set([
  'task_notification',
  'status_notification',
  'approval_request',
  'member_idle',
  'member_interrupted',
  'system_notification',
]);

export class TeamLeadInbox {
  private sequence = 0;
  private readonly prepared = new Map<string, { throughId: number; ids: string[]; entries: SubAgentResultEntry[] }>();

  constructor(private readonly mailbox: Pick<TeamMailboxService, 'unread' | 'markRead'>) {}

  runtime(sessionId: string, actor: () => LeadActor | undefined): AgentInstructionRuntime {
    return {
      prepare: () => {
        const current = actor();
        return current ? this.prepare(sessionId, current) : undefined;
      },
      commit: throughId => {
        const current = actor();
        return current ? this.commit(sessionId, current, throughId) : [];
      },
    };
  }

  discardSession(sessionId: string): void {
    this.prepared.delete(sessionId);
  }

  private prepare(sessionId: string, actor: LeadActor): PreparedSubAgentResultBatch | undefined {
    const key = `${sessionId}:${actor.team}:${actor.generation}`;
    const existing = this.prepared.get(key);
    if (existing) return this.batch(existing);
    const messages = this.mailbox.unread(actor).filter(message => IMPORTANT_TYPES.has(message.type));
    if (messages.length === 0) return undefined;
    const throughId = ++this.sequence;
    const entries = messages.map(message => ({
      id: throughId,
      taskId: message.taskId ?? `team-${message.id}`,
      sessionId,
      content: formatNotification(actor.team, message),
      createdAt: message.timestamp,
    }));
    const prepared = { throughId, ids: messages.map(message => message.id), entries };
    this.prepared.set(key, prepared);
    return this.batch(prepared);
  }

  private commit(
    sessionId: string,
    actor: LeadActor,
    throughId: number,
  ): readonly SubAgentResultEntry[] {
    const key = `${sessionId}:${actor.team}:${actor.generation}`;
    const prepared = this.prepared.get(key);
    if (!prepared || prepared.throughId !== throughId) return [];
    void this.mailbox.markRead(actor, prepared.ids).catch(() => {});
    this.prepared.delete(key);
    return prepared.entries.map(entry => ({ ...entry }));
  }

  private batch(prepared: { throughId: number; entries: SubAgentResultEntry[] }): PreparedSubAgentResultBatch {
    const messages: Array<Extract<Message, { role: 'instruction' }>> = prepared.entries.map(entry => ({
      role: 'instruction',
      instructionKind: 'team_notification',
      content: entry.content,
    }));
    return { throughId: prepared.throughId, entries: prepared.entries.map(entry => ({ ...entry })), messages };
  }
}

function formatNotification(team: string, message: TeamMessage): string {
  const body = truncateUtf8(escapeBoundary(message.body), MAX_NOTIFICATION_BYTES).value;
  return [
    `<team-notification team="${team}" message_id="${message.id}">`,
    `类型：${message.type}`,
    `发件人：${message.sender}`,
    ...(message.taskId ? [`任务：${message.taskId}`] : []),
    `摘要：${message.summary}`,
    `正文：${body}`,
    '</team-notification>',
  ].join('\n');
}

function escapeBoundary(value: string): string {
  return value.replace(/<\s*\/?\s*team-notification\b[^>]*>/giu, tag =>
    tag.replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
}
