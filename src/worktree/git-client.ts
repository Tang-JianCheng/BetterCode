import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type {
  GitProtectionStatus,
  GitRepositoryIdentity,
  WorktreeMetadata,
} from './types.js';
import { WorktreeError } from './types.js';

const MAX_GIT_OUTPUT_BYTES = 128 * 1024;
const DEFAULT_GIT_TIMEOUT_MS = 30_000;

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface GitWorktreeClientContract {
  inspectRepository(rootDir: string): Promise<GitRepositoryIdentity>;
  resolveHead(rootDir: string): Promise<string>;
  create(input: { mainRoot: string; rootDir: string; branch: string; baseCommit: string }): Promise<string>;
  configureHooks(mainRoot: string, rootDir: string): Promise<void>;
  isIgnored(mainRoot: string, paths: readonly string[]): Promise<ReadonlySet<string>>;
  inspectProtection(metadata: WorktreeMetadata): Promise<GitProtectionStatus>;
  assertRegistered(metadata: WorktreeMetadata): Promise<void>;
  removeWorktree(metadata: WorktreeMetadata, force: boolean): Promise<void>;
  deleteBranch(metadata: WorktreeMetadata, force: boolean): Promise<void>;
}

export class GitWorktreeClient implements GitWorktreeClientContract {
  constructor(private readonly timeoutMs = DEFAULT_GIT_TIMEOUT_MS) {}

  async inspectRepository(rootDir: string): Promise<GitRepositoryIdentity> {
    try {
      const mainRoot = realpathSync((await this.run(rootDir, ['rev-parse', '--show-toplevel'])).stdout.trim());
      const commonRaw = (await this.run(mainRoot, ['rev-parse', '--git-common-dir'])).stdout.trim();
      const commonGitDir = realpathSync(path.resolve(mainRoot, commonRaw));
      return { mainRoot, commonGitDir, repositoryId: commonGitDir };
    } catch (error) {
      if (error instanceof WorktreeError) throw error;
      throw new WorktreeError('NOT_GIT_REPOSITORY', `当前目录不是可用 Git 仓库: ${rootDir}`);
    }
  }

  async resolveHead(rootDir: string): Promise<string> {
    const value = (await this.run(rootDir, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();
    if (!/^[0-9a-f]{40,64}$/u.test(value)) throw new WorktreeError('GIT_STATE_UNKNOWN', '无法解析当前 HEAD');
    return value;
  }

  async create(input: { mainRoot: string; rootDir: string; branch: string; baseCommit: string }): Promise<string> {
    try {
      await this.run(input.mainRoot, ['worktree', 'add', '-b', input.branch, input.rootDir, input.baseCommit]);
      return this.readGitDir(input.rootDir);
    } catch (error) {
      throw new WorktreeError(
        'GIT_CREATE_FAILED',
        `创建 Git Worktree 失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async configureHooks(mainRoot: string, rootDir: string): Promise<void> {
    const configured = await this.tryRun(mainRoot, ['config', '--path', '--get', 'core.hooksPath']);
    if (configured.code !== 0 || !configured.stdout.trim()) return;
    const hooksPath = path.resolve(mainRoot, configured.stdout.trim());
    await this.run(mainRoot, ['config', 'extensions.worktreeConfig', 'true']);
    await this.run(rootDir, ['config', '--worktree', 'core.hooksPath', hooksPath]);
  }

  async isIgnored(mainRoot: string, paths: readonly string[]): Promise<ReadonlySet<string>> {
    if (paths.length === 0) return new Set();
    const result = await this.tryRun(mainRoot, ['check-ignore', '-z', '--stdin'], `${paths.join('\0')}\0`);
    if (result.code !== 0 && result.code !== 1) throw new WorktreeError('INITIALIZATION_FAILED', '无法检查 Git 忽略文件');
    return new Set(result.stdout.split('\0').filter(Boolean));
  }

  async inspectProtection(metadata: WorktreeMetadata): Promise<GitProtectionStatus> {
    try {
      const dirty = (await this.run(metadata.worktreeRoot, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout.length > 0;
      const ancestor = await this.tryRun(metadata.worktreeRoot, ['merge-base', '--is-ancestor', metadata.baseCommit, 'HEAD']);
      if (ancestor.code !== 0) {
        return { dirty, unpushed: true, hasNewCommits: true, reasons: ['当前分支已偏离创建基点'] };
      }
      const newCount = Number((await this.run(metadata.worktreeRoot, ['rev-list', '--count', `${metadata.baseCommit}..HEAD`])).stdout.trim());
      if (newCount === 0) return { dirty, unpushed: false, hasNewCommits: false, reasons: dirty ? ['存在未提交修改'] : [] };
      const upstream = await this.tryRun(metadata.worktreeRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
      if (upstream.code !== 0 || !upstream.stdout.trim()) {
        return { dirty, unpushed: true, hasNewCommits: true, reasons: [...(dirty ? ['存在未提交修改'] : []), '存在没有上游的新增提交'] };
      }
      const unpushedCount = Number((await this.run(metadata.worktreeRoot, ['rev-list', '--count', '@{upstream}..HEAD'])).stdout.trim());
      const unpushed = unpushedCount > 0;
      return {
        dirty,
        unpushed,
        hasNewCommits: true,
        upstream: upstream.stdout.trim(),
        reasons: [...(dirty ? ['存在未提交修改'] : []), ...(unpushed ? ['存在未推送提交'] : [])],
      };
    } catch (error) {
      throw new WorktreeError('GIT_STATE_UNKNOWN', `无法确认 Worktree 变更状态: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async assertRegistered(metadata: WorktreeMetadata): Promise<void> {
    const output = (await this.run(metadata.mainRoot, ['worktree', 'list', '--porcelain'])).stdout;
    const records = output.trim().split(/\n\n+/u).map(block => Object.fromEntries(
      block.split('\n').flatMap(line => {
        const split = line.indexOf(' ');
        return split < 0 ? [] : [[line.slice(0, split), line.slice(split + 1)]];
      }),
    ));
    const record = records.find(item => item.worktree && path.resolve(item.worktree) === path.resolve(metadata.worktreeRoot));
    if (!record || record.branch !== `refs/heads/${metadata.branch}`) {
      throw new WorktreeError('METADATA_MISMATCH', `Git Worktree 登记与元数据不一致: ${metadata.name}`);
    }
  }

  async removeWorktree(metadata: WorktreeMetadata, force: boolean): Promise<void> {
    await this.run(metadata.mainRoot, ['worktree', 'remove', ...(force ? ['--force'] : []), metadata.worktreeRoot]);
  }

  async deleteBranch(metadata: WorktreeMetadata, _force: boolean): Promise<void> {
    await this.run(metadata.mainRoot, ['branch', '-D', metadata.branch]);
  }

  private readGitDir(rootDir: string): string {
    const raw = readFileSync(path.join(rootDir, '.git'), 'utf8').trim();
    const match = /^gitdir:\s*(.+)$/u.exec(raw);
    if (!match) throw new WorktreeError('METADATA_MISMATCH', 'Worktree .git 指针无效');
    return realpathSync(path.resolve(rootDir, match[1]));
  }

  private async run(cwd: string, args: readonly string[], stdin?: string): Promise<GitResult> {
    const result = await this.tryRun(cwd, args, stdin);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} 退出码 ${result.code}`);
    return result;
  }

  private tryRun(cwd: string, args: readonly string[], stdin?: string): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', [...args], { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      const finish = (result?: GitResult, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(result!);
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(undefined, new Error(`Git 命令超过 ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes <= MAX_GIT_OUTPUT_BYTES) stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= MAX_GIT_OUTPUT_BYTES) stderr.push(chunk);
      });
      child.on('error', error => finish(undefined, error));
      child.on('close', code => finish({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code: code ?? 1,
      }));
      child.stdin.on('error', () => {});
      child.stdin.end(stdin);
    });
  }
}
