import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileLock, type FileLockOptions } from './file-lock.js';
import { TeamError } from './errors.js';
import type { TeamMessage } from './types.js';

function validMessage(value: unknown): value is TeamMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as TeamMessage;
  return typeof message.id === 'string' && typeof message.type === 'string' &&
    typeof message.sender === 'string' && typeof message.recipient === 'string' &&
    typeof message.body === 'string' && typeof message.summary === 'string' &&
    typeof message.timestamp === 'string' && typeof message.read === 'boolean';
}

export class MailboxStore {
  private readonly lock: FileLock;

  constructor(readonly file: string, lockOptions: FileLockOptions) {
    this.lock = new FileLock(`${file}.lock`, lockOptions);
  }

  async append(message: TeamMessage, signal?: AbortSignal, generation?: number): Promise<void> {
    await this.lock.withLock(() => {
      const directory = path.dirname(this.file);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
      appendFileSync(this.file, `${JSON.stringify(message)}\n`, { encoding: 'utf8', mode: 0o600 });
      chmodSync(this.file, 0o600);
      const descriptor = openSync(this.file, 'r');
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    }, signal, generation);
  }

  readAll(): TeamMessage[] {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, 'utf8').split(/\r?\n/u);
    const messages: TeamMessage[] = [];
    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!validMessage(parsed)) throw new Error('字段无效');
        messages.push(parsed);
      } catch {
        if (index === lines.length - 1 || (index === lines.length - 2 && lines.at(-1) === '')) break;
        throw new TeamError('TEAM_DATA_CORRUPT', `邮箱中间包含损坏消息: ${path.basename(this.file)}`);
      }
    }
    return messages.map(message => structuredClone(message));
  }

  unread(afterId?: string): TeamMessage[] {
    const messages = this.readAll();
    const start = afterId ? messages.findIndex(message => message.id === afterId) + 1 : 0;
    return messages.slice(Math.max(0, start)).filter(message => !message.read);
  }

  async markRead(ids: readonly string[], signal?: AbortSignal, generation?: number): Promise<void> {
    const requested = new Set(ids);
    if (requested.size === 0) return;
    await this.lock.withLock(() => {
      const messages = this.readAll().map(message =>
        requested.has(message.id) ? { ...message, read: true } : message);
      this.rewrite(messages);
    }, signal, generation);
  }

  private rewrite(messages: readonly TeamMessage[]): void {
    const directory = path.dirname(this.file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.${path.basename(this.file)}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, messages.map(message => JSON.stringify(message)).join('\n') + '\n', {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      renameSync(temporary, this.file);
      chmodSync(this.file, 0o600);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
