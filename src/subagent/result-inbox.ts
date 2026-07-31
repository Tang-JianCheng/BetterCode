import type { Message } from '../provider/types.js';
import { truncateUtf8 } from '../tool/output-limit.js';
import type {
  AgentInstructionRuntime,
  PreparedSubAgentResultBatch,
  SubAgentResultEntry,
  SubAgentTaskSnapshot,
} from './types.js';

const MAX_RESULT_MESSAGE_BYTES = 4 * 1024;

function escapeBoundary(value: string): string {
  return value.replace(/<\s*\/?\s*subagent-result\b[^>]*>/giu, tag =>
    tag.replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
}

function formatResult(task: SubAgentTaskSnapshot): string {
  const summary = task.result?.trim() || task.error?.message || '没有可用结果。';
  const prefix = [
    `<subagent-result task_id="${task.id}">`,
    `状态：${task.state}`,
    `类型：${task.kind}${task.role ? ` / ${task.role}` : ''}`,
    `停止原因：${task.stopReason ?? 'unknown'}`,
    ...(task.worktree ? [
      `Worktree：${task.worktree.state}`,
      ...(task.worktree.path ? [`Worktree 路径：${task.worktree.path}`] : []),
      ...(task.worktree.branch ? [`Worktree 分支：${task.worktree.branch}`] : []),
      ...(task.worktree.reasons?.length ? [`Worktree 原因：${task.worktree.reasons.join('；')}`] : []),
    ] : []),
    `Token：输入 ${task.usage.inputTokens} / 输出 ${task.usage.outputTokens} / ` +
      `缓存创建 ${task.usage.cacheCreationInputTokens} / 缓存命中 ${task.usage.cacheReadInputTokens}`,
    '结果：',
  ].join('\n');
  const suffix = '\n</subagent-result>';
  const availableBytes = MAX_RESULT_MESSAGE_BYTES
    - Buffer.byteLength(prefix, 'utf8')
    - Buffer.byteLength(suffix, 'utf8');
  const result = truncateUtf8(escapeBoundary(summary), Math.max(0, availableBytes)).value;
  return `${prefix}\n${result}</subagent-result>`;
}

export class SubAgentResultInbox {
  private sequence = 0;
  private readonly entries = new Map<string, SubAgentResultEntry[]>();
  private closed = false;

  enqueue(task: SubAgentTaskSnapshot): void {
    if (
      this.closed ||
      task.executionMode !== 'background' ||
      (task.state !== 'completed' && task.state !== 'failed' && task.state !== 'cancelled')
    ) return;
    const list = this.entries.get(task.sessionId) ?? [];
    list.push({
      id: ++this.sequence,
      taskId: task.id,
      sessionId: task.sessionId,
      content: formatResult(task),
      createdAt: new Date().toISOString(),
    });
    this.entries.set(task.sessionId, list);
  }

  runtime(sessionId: string): AgentInstructionRuntime {
    return {
      prepare: () => this.prepare(sessionId),
      commit: throughId => this.commit(sessionId, throughId),
    };
  }

  discardSession(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  close(): void {
    this.closed = true;
    this.entries.clear();
  }

  private prepare(sessionId: string): PreparedSubAgentResultBatch | undefined {
    const entries = this.entries.get(sessionId) ?? [];
    const last = entries.at(-1);
    if (!last) return undefined;
    const cloned = entries.map(entry => ({ ...entry }));
    const messages: Array<Extract<Message, { role: 'instruction' }>> = cloned.map(entry => ({
      role: 'instruction',
      instructionKind: 'subagent_result',
      content: entry.content,
    }));
    return { throughId: last.id, entries: cloned, messages };
  }

  private commit(sessionId: string, throughId: number): readonly SubAgentResultEntry[] {
    const entries = this.entries.get(sessionId) ?? [];
    const committed = entries.filter(entry => entry.id <= throughId);
    const remaining = entries.filter(entry => entry.id > throughId);
    if (remaining.length > 0) this.entries.set(sessionId, remaining);
    else this.entries.delete(sessionId);
    return committed.map(entry => ({ ...entry }));
  }
}
