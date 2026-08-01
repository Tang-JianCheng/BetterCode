import { randomUUID } from 'node:crypto';
import { AtomicJsonStore, isRevisionedRecord } from './atomic-store.js';
import { TeamProcessRunner } from './backend/process-runner.js';
import { TeamError } from './errors.js';
import type { TeamIntegrationGit } from './integration-git.js';
import type { TeamPathGuard } from './path-guard.js';
import type { TeamRepository } from './repository.js';
import type { TeamTaskService } from './task-service.js';
import type {
  LeadActor,
  ResolvedTeamOptions,
  TeamIntegrationRecord,
  TeamIntegrationValidationResult,
  TeamTaskRecord,
} from './types.js';
import type { WorktreeManager } from '../worktree/manager.js';
import type { WorktreeLease } from '../worktree/types.js';

export interface IntegrationValidationRunner {
  run(command: string, cwd: string, signal?: AbortSignal): Promise<TeamIntegrationValidationResult>;
}

export class ShellIntegrationValidationRunner implements IntegrationValidationRunner {
  constructor(private readonly runner = new TeamProcessRunner(120_000, 128 * 1024)) {}

  async run(command: string, cwd: string, signal?: AbortSignal): Promise<TeamIntegrationValidationResult> {
    const shell = process.env.SHELL || '/bin/sh';
    const result = await this.runner.run({ command: shell, args: ['-lc', command], cwd, signal });
    return {
      command,
      ok: result.exitCode === 0 && !result.timedOut,
      exitCode: result.exitCode,
      output: `${result.stdout}${result.stderr}`.trim().slice(0, 16_000),
    };
  }
}

export class TeamIntegrationManager {
  private readonly leases = new Map<string, WorktreeLease>();

  constructor(
    private readonly guard: TeamPathGuard,
    private readonly repository: TeamRepository,
    private readonly tasks: TeamTaskService,
    private readonly worktrees: WorktreeManager,
    private readonly git: TeamIntegrationGit,
    private readonly options: ResolvedTeamOptions['integration'],
    private readonly validator: IntegrationValidationRunner = new ShellIntegrationValidationRunner(),
  ) {}

  async start(actor: LeadActor, taskIds?: readonly string[], signal?: AbortSignal): Promise<TeamIntegrationRecord> {
    const team = this.requireLead(actor);
    await this.git.assertClean(team.projectRoot);
    const leadBranch = await this.git.branch(team.projectRoot);
    const leadHead = await this.git.head(team.projectRoot);
    const ordered = this.tasks.topologicalOrder(actor.team, taskIds);
    if (ordered.length === 0) throw new TeamError('TEAM_INTEGRATION_ERROR', '没有可集成的任务');
    for (const task of ordered) await this.validateTask(team.projectRoot, task);
    const id = randomUUID();
    const worktreeName = `team-integration/${actor.team}/${id}`;
    const lease = await this.worktrees.acquire(worktreeName);
    this.leases.set(id, lease);
    const now = new Date().toISOString();
    let record = this.write({
      version: 1,
      revision: 0,
      id,
      team: actor.team,
      leadBranch,
      leadHead,
      worktreeName,
      worktreeRoot: lease.cwd,
      branch: lease.branch,
      orderedTaskIds: ordered.map(task => task.id),
      mergedTaskIds: [],
      state: 'preparing',
      conflictFiles: [],
      validationResults: [],
      createdAt: now,
      updatedAt: now,
    }, 0);
    try {
      record = await this.advance(actor, record, signal);
      return record;
    } catch (error) {
      const latest = this.read(actor.team, id) ?? record;
      if (latest.state !== 'completed' && latest.state !== 'aborted') {
        this.write({ ...latest, state: 'failed', updatedAt: new Date().toISOString() }, latest.revision);
      }
      throw error;
    }
  }

  status(actor: LeadActor, integrationId: string): TeamIntegrationRecord {
    this.requireLead(actor);
    const record = this.read(actor.team, integrationId);
    if (!record) throw new TeamError('TEAM_INTEGRATION_ERROR', `集成事务不存在: ${integrationId}`);
    return record;
  }

  async continue(actor: LeadActor, integrationId: string, signal?: AbortSignal): Promise<TeamIntegrationRecord> {
    this.requireLead(actor);
    let record = this.status(actor, integrationId);
    if (record.state !== 'conflicted' || !record.currentTaskId) {
      throw new TeamError('TEAM_INTEGRATION_ERROR', '集成事务当前没有可继续的冲突');
    }
    const lease = await this.ensureLease(record);
    await this.git.continueMerge(lease.cwd);
    record = this.write({
      ...record,
      mergedTaskIds: [...record.mergedTaskIds, record.currentTaskId],
      currentTaskId: undefined,
      state: 'merging',
      conflictFiles: [],
      updatedAt: new Date().toISOString(),
    }, record.revision);
    return this.advance(actor, record, signal);
  }

  async abort(actor: LeadActor, integrationId: string): Promise<TeamIntegrationRecord> {
    this.requireLead(actor);
    let record = this.status(actor, integrationId);
    if (record.state === 'completed' || record.state === 'aborted') return record;
    const lease = await this.ensureLease(record);
    if (record.state === 'conflicted') await this.git.abortMerge(lease.cwd);
    record = this.write({ ...record, state: 'aborted', conflictFiles: [], updatedAt: new Date().toISOString() }, record.revision);
    await this.worktrees.exit(lease.leaseId);
    this.leases.delete(record.id);
    await this.worktrees.remove(record.worktreeName, { force: true });
    return record;
  }

  private async advance(actor: LeadActor, initial: TeamIntegrationRecord, signal?: AbortSignal): Promise<TeamIntegrationRecord> {
    let record = initial;
    const lease = await this.ensureLease(record);
    for (const taskId of record.orderedTaskIds.slice(record.mergedTaskIds.length)) {
      if (signal?.aborted) throw new TeamError('TEAM_INTEGRATION_ERROR', '集成已取消');
      const task = this.tasks.get(actor.team, taskId)!;
      record = this.write({ ...record, state: 'merging', currentTaskId: taskId, updatedAt: new Date().toISOString() }, record.revision);
      const merged = await this.git.merge(lease.cwd, task.commit!);
      if (!merged.ok) {
        return this.write({
          ...record,
          state: 'conflicted',
          conflictFiles: merged.conflicts,
          updatedAt: new Date().toISOString(),
        }, record.revision);
      }
      record = this.write({
        ...record,
        mergedTaskIds: [...record.mergedTaskIds, taskId],
        currentTaskId: undefined,
        updatedAt: new Date().toISOString(),
      }, record.revision);
    }
    record = this.write({ ...record, state: 'validating', validationResults: [], updatedAt: new Date().toISOString() }, record.revision);
    const results: TeamIntegrationValidationResult[] = [];
    for (const command of this.options.validationCommands) {
      const result = await this.validator.run(command, lease.cwd, signal);
      results.push(result);
      record = this.write({ ...record, validationResults: results, updatedAt: new Date().toISOString() }, record.revision);
      if (!result.ok) return this.write({ ...record, state: 'failed', updatedAt: new Date().toISOString() }, record.revision);
    }
    record = this.write({ ...record, state: 'ready', updatedAt: new Date().toISOString() }, record.revision);
    await this.git.fastForward(this.requireLead(actor).projectRoot, record.branch, record.leadHead);
    for (const taskId of record.orderedTaskIds) this.tasks.markIntegrated(actor, taskId, record.id);
    record = this.write({ ...record, state: 'completed', updatedAt: new Date().toISOString() }, record.revision);
    await this.worktrees.exit(lease.leaseId);
    this.leases.delete(record.id);
    await this.worktrees.removeIntegrated(record.worktreeName, record.leadBranch);
    for (const taskId of record.orderedTaskIds) {
      const task = this.tasks.get(actor.team, taskId);
      const member = task?.assignee ? this.repository.getMember(actor.team, task.assignee) : undefined;
      if (member?.worktreeName) {
        const removed = await this.worktrees.removeIntegrated(member.worktreeName, record.leadBranch);
        if (removed.status === 'deleted') {
          this.repository.writeMember(actor.team, {
            ...member,
            rootDir: this.requireLead(actor).projectRoot,
            worktreeName: undefined,
            worktreeBranch: undefined,
          }, member.revision);
        }
      }
    }
    return record;
  }

  private async validateTask(rootDir: string, task: TeamTaskRecord): Promise<void> {
    if (task.state !== 'completed' || !task.branch || !task.commit) {
      throw new TeamError('TEAM_INTEGRATION_ERROR', `任务 ${task.id} 尚未完成代码提交`);
    }
    await this.git.verifyCommit(rootDir, task.commit);
    if (!await this.git.isAncestor(rootDir, task.commit, task.branch)) {
      throw new TeamError('TEAM_INTEGRATION_ERROR', `任务 ${task.id} 的提交不属于登记分支`);
    }
  }

  private async ensureLease(record: TeamIntegrationRecord): Promise<WorktreeLease> {
    const existing = this.leases.get(record.id);
    if (existing) return existing;
    const lease = await this.worktrees.enter(record.worktreeName);
    this.leases.set(record.id, lease);
    return lease;
  }

  private requireLead(actor: LeadActor) {
    const team = this.repository.get(actor.team)?.team;
    if (!team || team.state !== 'active' || team.generation !== actor.generation) {
      throw new TeamError('TEAM_STATE_ERROR', 'Team Lead 身份已失效');
    }
    return team;
  }

  private read(team: string, id: string): TeamIntegrationRecord | undefined {
    return this.store(team, id).read();
  }

  private write(record: TeamIntegrationRecord, expectedRevision: number): TeamIntegrationRecord {
    return this.store(record.team, record.id).write(record, expectedRevision);
  }

  private store(team: string, id: string): AtomicJsonStore<TeamIntegrationRecord> {
    return new AtomicJsonStore(this.guard.integrationFile(team, id), validIntegration);
  }
}

function validIntegration(value: unknown): value is TeamIntegrationRecord {
  if (!isRevisionedRecord(value) || typeof value !== 'object' || value === null) return false;
  const record = value as TeamIntegrationRecord;
  return record.version === 1 && typeof record.id === 'string' && typeof record.team === 'string' &&
    typeof record.leadHead === 'string' && typeof record.worktreeRoot === 'string' &&
    Array.isArray(record.orderedTaskIds) && Array.isArray(record.mergedTaskIds) &&
    Array.isArray(record.conflictFiles) && Array.isArray(record.validationResults) &&
    typeof record.state === 'string' && typeof record.createdAt === 'string' && typeof record.updatedAt === 'string';
}
