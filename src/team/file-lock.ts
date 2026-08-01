import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { TeamError } from './errors.js';

interface LockPayload {
  version: 1;
  pid: number;
  instanceId: string;
  createdAt: string;
  expiresAt: string;
  generation?: number;
}

export interface FileLockOptions {
  lockTimeoutMs: number;
  retryIntervalMs: number;
  staleLockMs: number;
  generationValid?: (generation: number | undefined) => boolean;
  now?: () => number;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new TeamError('TEAM_STATE_ERROR', '等待团队文件锁时已取消'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new TeamError('TEAM_STATE_ERROR', '等待团队文件锁时已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal) {
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      setTimeout(cleanup, milliseconds).unref();
    }
  });
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class FileLock {
  private readonly instanceId = randomUUID();
  private readonly now: () => number;

  constructor(
    private readonly lockFile: string,
    private readonly options: FileLockOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async withLock<T>(
    action: () => Promise<T> | T,
    signal?: AbortSignal,
    generation?: number,
  ): Promise<T> {
    const started = this.now();
    while (true) {
      if (signal?.aborted) throw new TeamError('TEAM_STATE_ERROR', '等待团队文件锁时已取消');
      if (this.tryAcquire(generation)) break;
      this.recoverStale();
      if (this.now() - started >= this.options.lockTimeoutMs) {
        throw new TeamError('TEAM_LOCK_TIMEOUT', `获取团队文件锁超时: ${this.lockFile}`);
      }
      await delay(this.options.retryIntervalMs, signal);
    }
    try {
      return await action();
    } finally {
      this.release();
    }
  }

  private tryAcquire(generation?: number): boolean {
    let descriptor: number | undefined;
    try {
      const directory = path.dirname(this.lockFile);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
      descriptor = openSync(this.lockFile, 'wx', 0o600);
      const now = this.now();
      const payload: LockPayload = {
        version: 1,
        pid: process.pid,
        instanceId: this.instanceId,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.options.staleLockMs).toISOString(),
        ...(generation === undefined ? {} : { generation }),
      };
      writeFileSync(descriptor, `${JSON.stringify(payload)}\n`, 'utf8');
      closeSync(descriptor);
      return true;
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }

  private recoverStale(): void {
    const payload = this.readPayload();
    if (!payload) return;
    const expired = this.now() > Date.parse(payload.expiresAt);
    if (!expired) return;
    const generationInvalid = this.options.generationValid
      ? !this.options.generationValid(payload.generation)
      : false;
    if (processAlive(payload.pid) && !generationInvalid) return;
    try {
      const current = this.readPayload();
      if (current?.instanceId === payload.instanceId) rmSync(this.lockFile, { force: true });
    } catch {}
  }

  private release(): void {
    try {
      const payload = this.readPayload();
      if (payload?.instanceId === this.instanceId) rmSync(this.lockFile, { force: true });
    } catch {}
  }

  private readPayload(): LockPayload | undefined {
    if (!existsSync(this.lockFile)) return undefined;
    try {
      const value = JSON.parse(readFileSync(this.lockFile, 'utf8')) as Partial<LockPayload>;
      if (value.version !== 1 || !Number.isInteger(value.pid) || typeof value.instanceId !== 'string' ||
          typeof value.expiresAt !== 'string') return undefined;
      return value as LockPayload;
    } catch {
      return undefined;
    }
  }
}
