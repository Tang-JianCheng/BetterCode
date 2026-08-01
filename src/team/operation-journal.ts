import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileLock, type FileLockOptions } from './file-lock.js';
import { TeamError } from './errors.js';
import { TeamPathGuard } from './path-guard.js';

export type OperationJournalEvent =
  | {
      type: 'tool_started';
      operationId: string;
      toolCallId: string;
      toolName: string;
      argumentsSummary: string;
      taskId: string;
      contextRevision: number;
      timestamp: string;
    }
  | {
      type: 'tool_finished';
      operationId: string;
      ok: boolean;
      resultSummary: string;
      timestamp: string;
    }
  | {
      type: 'tool_resolved';
      operationId: string;
      actor: 'lead';
      resolution: string;
      timestamp: string;
    };

const SECRET_PATTERN = /(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,}]+/giu;
const SECRET_KEY_PATTERN = /api[_-]?key|token|secret|password/iu;

function redact(value: string, limit: number): string {
  return value.replace(SECRET_PATTERN, '$1=[REDACTED]').slice(0, limit);
}

function redactStructured(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactStructured);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactStructured(item),
  ]));
}

export class OperationJournal {
  private readonly file: string;
  private readonly lock: FileLock;

  constructor(
    guard: TeamPathGuard,
    team: string,
    member: string,
    options: FileLockOptions,
  ) {
    const paths = guard.team(team);
    const name = guard.memberName(member);
    this.file = guard.assertPath(path.join(paths.operationsDir, `${name}.jsonl`));
    this.lock = new FileLock(`${this.file}.lock`, options);
  }

  async start(input: {
    toolCallId: string;
    toolName: string;
    arguments: unknown;
    taskId: string;
    contextRevision: number;
  }, generation?: number): Promise<string> {
    const operationId = randomUUID();
    await this.append({
      type: 'tool_started',
      operationId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      argumentsSummary: JSON.stringify(redactStructured(input.arguments)).slice(0, 2_000),
      taskId: input.taskId,
      contextRevision: input.contextRevision,
      timestamp: new Date().toISOString(),
    }, generation);
    return operationId;
  }

  finish(operationId: string, ok: boolean, result: string, generation?: number): Promise<void> {
    return this.append({
      type: 'tool_finished',
      operationId,
      ok,
      resultSummary: redact(result, 2_000),
      timestamp: new Date().toISOString(),
    }, generation);
  }

  resolve(operationId: string, resolution: string, generation?: number): Promise<void> {
    if (!this.uncertain().includes(operationId)) {
      throw new TeamError('TEAM_STATE_ERROR', `不确定操作不存在或已解决: ${operationId}`);
    }
    return this.append({
      type: 'tool_resolved',
      operationId,
      actor: 'lead',
      resolution: redact(resolution.trim(), 2_000),
      timestamp: new Date().toISOString(),
    }, generation);
  }

  events(): OperationJournalEvent[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split(/\r?\n/u).filter(Boolean).flatMap(line => {
      try {
        const event = JSON.parse(line) as OperationJournalEvent;
        return event?.operationId && event?.type ? [event] : [];
      } catch {
        return [];
      }
    });
  }

  uncertain(): string[] {
    const state = new Map<string, 'started' | 'finished' | 'resolved'>();
    for (const event of this.events()) state.set(event.operationId, event.type.replace('tool_', '') as 'started' | 'finished' | 'resolved');
    return [...state].filter(([, status]) => status === 'started').map(([id]) => id);
  }

  private async append(event: OperationJournalEvent, generation?: number): Promise<void> {
    await this.lock.withLock(() => {
      mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      appendFileSync(this.file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
      chmodSync(this.file, 0o600);
    }, undefined, generation);
  }
}
