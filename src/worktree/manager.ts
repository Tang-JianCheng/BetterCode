import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { GitWorktreeClientContract } from './git-client.js';
import type { WorktreeInitializer } from './initializer.js';
import type { WorktreeMetadataStore } from './metadata-store.js';
import type { WorktreePathGuard } from './path-guard.js';
import type {
  GitRepositoryIdentity,
  WorktreeEvent,
  WorktreeHandle,
  WorktreeLease,
  WorktreeMetadata,
  WorktreeRemovalResult,
} from './types.js';
import { WorktreeError } from './types.js';

type Listener = (event: WorktreeEvent) => void;

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export class WorktreeManager {
  private identity?: GitRepositoryIdentity;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly leases = new Map<string, { name: string; released: boolean }>();
  private readonly leasesByName = new Map<string, Set<string>>();
  private readonly listeners = new Set<Listener>();
  private closed = false;

  constructor(
    private readonly guard: WorktreePathGuard,
    private readonly metadata: WorktreeMetadataStore,
    private readonly git: GitWorktreeClientContract,
    private readonly initializer: WorktreeInitializer,
  ) {}

  async initialize(): Promise<void> {
    this.guard.ensureRoots();
    this.identity = await this.git.inspectRepository(this.guard.mainRoot);
    if (this.identity.mainRoot !== this.guard.mainRoot) {
      throw new WorktreeError('NOT_GIT_REPOSITORY', 'BetterCode 必须从 Git 仓库根目录启动 Worktree 隔离');
    }
  }

  async create(name: string): Promise<WorktreeHandle> {
    return this.serial(name, async () => this.createLocked(name));
  }

  async enter(name: string): Promise<WorktreeLease> {
    return this.serial(name, async () => {
      const handle = await this.recoverLocked(name);
      return this.createLease(handle);
    });
  }

  async acquire(name: string): Promise<WorktreeLease> {
    return this.serial(name, async () => this.createLease(await this.createLocked(name)));
  }

  async exit(leaseId: string): Promise<void> {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.released) return;
    await this.serial(lease.name, async () => {
      if (lease.released) return;
      lease.released = true;
      const active = this.leasesByName.get(lease.name);
      active?.delete(leaseId);
      this.leases.delete(leaseId);
      if (active?.size === 0) {
        this.leasesByName.delete(lease.name);
        const metadata = this.metadata.read(lease.name);
        if (metadata) this.metadata.write({ ...metadata, lastUsedAt: new Date().toISOString() });
      }
      this.publish({ type: 'exited', name: lease.name, leaseId, activeLeases: active?.size ?? 0 });
    });
  }

  async finalize(leaseId: string): Promise<WorktreeRemovalResult> {
    const name = this.leases.get(leaseId)?.name;
    if (!name) return { status: 'missing', name: '' };
    await this.exit(leaseId);
    return this.remove(name);
  }

  async remove(name: string, options: { force?: boolean } = {}): Promise<WorktreeRemovalResult> {
    return this.serial(name, async () => this.removeLocked(name, options.force === true));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reportCleanupFailure(name: string, error: unknown): void {
    const worktreeError = error instanceof WorktreeError
      ? error
      : new WorktreeError('DELETE_FAILED', error instanceof Error ? error.message : String(error));
    this.publish({
      type: 'cleanup_failed',
      name,
      code: worktreeError.code,
      message: worktreeError.message.slice(0, 1000),
    });
  }

  activeLeaseCount(name: string): number {
    return this.leasesByName.get(name)?.size ?? 0;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.queues.values()]);
    this.listeners.clear();
  }

  private async createLocked(name: string): Promise<WorktreeHandle> {
    this.assertReady();
    const location = this.guard.location(name);
    if (existsSync(location.rootDir)) return this.recoverLocked(name);
    if (this.metadata.read(name)) throw new WorktreeError('DIRECTORY_CONFLICT', `Worktree 元数据已存在但目录缺失: ${name}`);
    const baseCommit = await this.git.resolveHead(this.guard.mainRoot);
    const now = new Date().toISOString();
    let created = false;
    let metadata: WorktreeMetadata = {
      version: 1,
      name,
      repositoryId: this.identity!.repositoryId,
      mainRoot: this.guard.mainRoot,
      worktreeRoot: location.rootDir,
      gitDir: path.join(this.identity!.commonGitDir, 'worktrees', `creating-${Date.now()}`),
      branch: location.branch,
      baseCommit,
      state: 'creating',
      createdAt: now,
      lastUsedAt: now,
      initializationComplete: false,
    };
    this.metadata.write(metadata);
    this.publish({ type: 'creating', name, cwd: location.rootDir, branch: location.branch });
    try {
      const gitDir = await this.git.create({
        mainRoot: this.guard.mainRoot,
        rootDir: location.rootDir,
        branch: location.branch,
        baseCommit,
      });
      created = true;
      metadata = { ...metadata, gitDir };
      const diagnostics = await this.initializer.initialize(metadata);
      metadata = { ...metadata, state: 'ready', initializationComplete: true };
      this.metadata.write(metadata);
      const handle = this.handle(metadata, false, diagnostics);
      this.publish({ type: 'created', handle });
      return handle;
    } catch (error) {
      if (created) {
        await this.git.removeWorktree(metadata, true).catch(() => {});
        await this.git.deleteBranch(metadata, true).catch(() => {});
      }
      this.metadata.remove(name);
      throw error;
    }
  }

  private async recoverLocked(name: string): Promise<WorktreeHandle> {
    this.assertReady();
    const location = this.guard.location(name);
    const metadata = this.metadata.read(name);
    if (!metadata || !existsSync(location.rootDir)) {
      throw new WorktreeError('METADATA_MISMATCH', `Worktree 目录或元数据不存在: ${name}`);
    }
    const root = this.guard.assertExistingWorktree(location.rootDir);
    if (metadata.repositoryId !== this.identity!.repositoryId || metadata.mainRoot !== this.guard.mainRoot ||
        metadata.worktreeRoot !== root || metadata.branch !== location.branch ||
        !metadata.initializationComplete || (metadata.state !== 'ready' && metadata.state !== 'retained')) {
      throw new WorktreeError('METADATA_MISMATCH', `Worktree 元数据与当前仓库不一致: ${name}`);
    }
    const pointer = readFileSync(path.join(root, '.git'), 'utf8').trim();
    const match = /^gitdir:\s*(.+)$/u.exec(pointer);
    if (!match) throw new WorktreeError('METADATA_MISMATCH', `Worktree Git 指针无效: ${name}`);
    const gitDir = realpathSync(path.resolve(root, match[1]));
    if (gitDir !== realpathSync(metadata.gitDir) || !within(this.identity!.commonGitDir, gitDir)) {
      throw new WorktreeError('METADATA_MISMATCH', `Worktree Git 目录归属不一致: ${name}`);
    }
    const head = readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (head !== `ref: refs/heads/${metadata.branch}`) {
      throw new WorktreeError('METADATA_MISMATCH', `Worktree 当前分支与元数据不一致: ${name}`);
    }
    const updated = { ...metadata, lastUsedAt: new Date().toISOString() };
    this.metadata.write(updated);
    const handle = this.handle(updated, true, []);
    this.publish({ type: 'recovered', handle });
    return handle;
  }

  private createLease(handle: WorktreeHandle): WorktreeLease {
    const leaseId = `wtl-${randomUUID()}`;
    this.leases.set(leaseId, { name: handle.name, released: false });
    const active = this.leasesByName.get(handle.name) ?? new Set<string>();
    active.add(leaseId);
    this.leasesByName.set(handle.name, active);
    this.publish({ type: 'entered', name: handle.name, leaseId, activeLeases: active.size });
    return { ...handle, leaseId };
  }

  private async removeLocked(name: string, force: boolean): Promise<WorktreeRemovalResult> {
    this.assertReady();
    const metadata = this.metadata.read(name);
    if (!metadata) return { status: 'missing', name };
    if (this.activeLeaseCount(name) > 0) throw new WorktreeError('ACTIVE_LEASE', `Worktree 仍有活动租约: ${name}`);
    const location = this.guard.location(name);
    const root = this.guard.assertExistingWorktree(location.rootDir);
    if (metadata.repositoryId !== this.identity!.repositoryId || metadata.worktreeRoot !== root ||
        metadata.branch !== location.branch) {
      throw new WorktreeError('METADATA_MISMATCH', `Worktree 删除归属校验失败: ${name}`);
    }
    await this.git.assertRegistered(metadata);
    if (!force) {
      let protection;
      try {
        protection = await this.git.inspectProtection(metadata);
      } catch (error) {
        return this.retain(metadata, [error instanceof Error ? error.message : String(error)]);
      }
      if (protection.dirty || protection.unpushed) return this.retain(metadata, protection.reasons);
    }
    this.metadata.write({ ...metadata, state: 'deleting' });
    try {
      await this.git.removeWorktree(metadata, force);
      await this.git.deleteBranch(metadata, force);
      this.metadata.remove(name);
      const result: WorktreeRemovalResult = { status: 'deleted', name, cwd: metadata.worktreeRoot, branch: metadata.branch };
      this.publish({ type: 'deleted', result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.metadata.write({ ...metadata, state: 'error', lastError: { code: 'DELETE_FAILED', message: message.slice(0, 1000) } });
      throw new WorktreeError('DELETE_FAILED', `删除 Worktree 失败: ${message}`);
    }
  }

  private retain(metadata: WorktreeMetadata, reasons: readonly string[]): WorktreeRemovalResult {
    const normalized = reasons.length ? [...reasons] : ['Worktree 状态不安全'];
    this.metadata.write({ ...metadata, state: 'retained', lastUsedAt: new Date().toISOString() });
    const result: WorktreeRemovalResult = {
      status: 'retained',
      name: metadata.name,
      cwd: metadata.worktreeRoot,
      branch: metadata.branch,
      reasons: normalized,
    };
    this.publish({ type: 'retained', result });
    return result;
  }

  private handle(
    metadata: WorktreeMetadata,
    recovered: boolean,
    diagnostics: WorktreeHandle['diagnostics'],
  ): WorktreeHandle {
    return {
      name: metadata.name,
      cwd: metadata.worktreeRoot,
      branch: metadata.branch,
      baseCommit: metadata.baseCommit,
      recovered,
      diagnostics,
    };
  }

  private assertReady(): void {
    if (this.closed) throw new WorktreeError('CANCELLED', 'Worktree 管理器已关闭');
    if (!this.identity) throw new WorktreeError('NOT_GIT_REPOSITORY', 'Worktree 管理器尚未初始化');
  }

  private serial<T>(name: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(name) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(action);
    const tail = operation.then(() => {}, () => {});
    this.queues.set(name, tail);
    return operation.finally(() => {
      if (this.queues.get(name) === tail) this.queues.delete(name);
    });
  }

  private publish(event: WorktreeEvent): void {
    const frozen = Object.freeze(structuredClone(event));
    for (const listener of this.listeners) {
      try {
        listener(frozen);
      } catch {}
    }
  }
}
