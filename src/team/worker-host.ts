import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TeamError } from './errors.js';
import type { TeamMailboxService } from './mailbox-service.js';
import type { TeamPathGuard } from './path-guard.js';
import type { TeamRepository } from './repository.js';
import type { MemberActor, MemberRuntimeLease, ResolvedTeamOptions, TeamMessage } from './types.js';
import type { TeamWorkerDescriptor } from './worker-entry.js';

const WAKE_MESSAGE_TYPES = new Set(['task_notification', 'approval_response']);

export interface TeamWorkerOperation {
  runOnce(signal: AbortSignal): Promise<void>;
}

export interface TeamWorkerHostOptions {
  descriptor: TeamWorkerDescriptor;
  guard: TeamPathGuard;
  repository: TeamRepository;
  mailbox: Pick<TeamMailboxService, 'unread'>;
  operation: TeamWorkerOperation;
  runtime: ResolvedTeamOptions['runtime'];
  paneId?: string;
  stdin?: NodeJS.ReadableStream;
  now?: () => Date;
}

export class TeamWorkerHost {
  private readonly instanceId = randomUUID();
  private readonly actor: MemberActor;
  private readonly leaseFile: string;
  private heartbeat?: NodeJS.Timeout;
  private wakePending = false;
  private wakeResolver?: () => void;

  constructor(private readonly options: TeamWorkerHostOptions) {
    this.actor = {
      kind: 'member',
      team: options.descriptor.team,
      member: options.descriptor.member,
      generation: options.descriptor.generation,
    };
    this.leaseFile = options.guard.runtimeFile(this.actor.team, this.actor.member, 'lease');
  }

  async start(signal: AbortSignal): Promise<void> {
    this.assertGeneration(false);
    this.acquireLease();
    const onInput = () => this.wake();
    const onAbort = () => this.wake();
    this.options.stdin?.on('data', onInput);
    signal.addEventListener('abort', onAbort, { once: true });
    this.heartbeat = setInterval(() => {
      try {
        this.assertGeneration();
        this.writeLease();
      } catch {
        this.wake();
      }
    }, this.options.runtime.heartbeatIntervalMs);
    this.heartbeat.unref();
    try {
      if (this.shouldRun()) await this.options.operation.runOnce(signal);
      while (!signal.aborted) {
        await this.waitForWake(signal);
        if (signal.aborted) break;
        this.assertGeneration();
        if (this.shouldRun()) await this.options.operation.runOnce(signal);
      }
    } finally {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      signal.removeEventListener('abort', onAbort);
      this.options.stdin?.removeListener('data', onInput);
      this.releaseLease();
    }
  }

  wake(): void {
    this.wakePending = true;
    this.wakeResolver?.();
    this.wakeResolver = undefined;
  }

  private shouldRun(): boolean {
    const member = this.options.repository.getMember(this.actor.team, this.actor.member);
    if (!member) return false;
    if (member.currentTaskId && ['creating', 'idle', 'running', 'interrupted'].includes(member.state)) return true;
    return this.options.mailbox.unread(this.actor).some(message => this.isWakeMessage(message));
  }

  private isWakeMessage(message: TeamMessage): boolean {
    return WAKE_MESSAGE_TYPES.has(message.type) || (message.type === 'text' && message.wake === true);
  }

  private waitForWake(signal: AbortSignal): Promise<void> {
    if (this.wakePending) {
      this.wakePending = false;
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const poll = setTimeout(() => {
        this.wakeResolver = undefined;
        resolve();
      }, this.options.runtime.inboxPollIntervalMs);
      this.wakeResolver = () => {
        clearTimeout(poll);
        this.wakePending = false;
        resolve();
      };
      if (signal.aborted) this.wakeResolver();
    });
  }

  private acquireLease(): void {
    const existing = this.readLease();
    if (existing && Date.now() - Date.parse(existing.heartbeatAt) < this.options.runtime.heartbeatTimeoutMs &&
        existing.instanceId !== this.instanceId) {
      throw new TeamError('TEAM_CONFLICT', `成员 Worker 已由进程 ${existing.pid} 持有`);
    }
    this.writeLease();
  }

  private writeLease(): void {
    this.assertGeneration();
    const lease: MemberRuntimeLease = {
      version: 1,
      team: this.actor.team,
      member: this.actor.member,
      generation: this.actor.generation,
      instanceId: this.instanceId,
      pid: process.pid,
      backend: this.options.repository.getMember(this.actor.team, this.actor.member)!.backend,
      ...(this.options.paneId ? { paneId: this.options.paneId } : {}),
      heartbeatAt: (this.options.now?.() ?? new Date()).toISOString(),
    };
    const directory = path.dirname(this.leaseFile);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `.${path.basename(this.leaseFile)}.${this.instanceId}.tmp`);
    try {
      writeFileSync(temporary, `${JSON.stringify(lease)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, this.leaseFile);
      chmodSync(this.leaseFile, 0o600);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  private readLease(): MemberRuntimeLease | undefined {
    if (!existsSync(this.leaseFile)) return undefined;
    try {
      const lease = JSON.parse(readFileSync(this.leaseFile, 'utf8')) as MemberRuntimeLease;
      return lease?.version === 1 && typeof lease.instanceId === 'string' && typeof lease.heartbeatAt === 'string'
        ? lease
        : undefined;
    } catch {
      return undefined;
    }
  }

  private releaseLease(): void {
    if (this.readLease()?.instanceId === this.instanceId) rmSync(this.leaseFile, { force: true });
  }

  private assertGeneration(checkLease = true): void {
    const team = this.options.repository.get(this.actor.team)?.team;
    const member = this.options.repository.getMember(this.actor.team, this.actor.member);
    const lease = this.readLease();
    if (!team || !member || team.generation !== this.actor.generation || member.generation !== this.actor.generation ||
        member.state === 'terminated' || (checkLease && lease && lease.instanceId !== this.instanceId &&
          Date.now() - Date.parse(lease.heartbeatAt) < this.options.runtime.heartbeatTimeoutMs)) {
      throw new TeamError('TEAM_STATE_ERROR', '成员 Worker 运行代次或租约已失效');
    }
  }
}
