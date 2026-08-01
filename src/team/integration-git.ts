import { TeamError } from './errors.js';
import { TeamProcessRunner, type ProcessRunResult } from './backend/process-runner.js';

const OBJECT_PATTERN = /^[0-9a-f]{7,64}$/u;
const REF_PATTERN = /^(?!-)(?!.*\.\.)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u;

export interface GitMergeResult {
  ok: boolean;
  conflicts: readonly string[];
  output: string;
}

export class TeamIntegrationGit {
  constructor(
    private readonly runner = new TeamProcessRunner(30_000, 128 * 1024),
    private readonly command = 'git',
  ) {}

  async assertClean(rootDir: string): Promise<void> {
    const result = await this.run(rootDir, ['status', '--porcelain=v1', '--untracked-files=all']);
    if (result.stdout.length > 0) throw new TeamError('TEAM_INTEGRATION_ERROR', 'Team Lead 工作区存在未提交修改');
  }

  async head(rootDir: string): Promise<string> {
    const value = (await this.run(rootDir, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();
    if (!OBJECT_PATTERN.test(value)) throw new TeamError('TEAM_INTEGRATION_ERROR', '无法解析 Git HEAD');
    return value;
  }

  async branch(rootDir: string): Promise<string> {
    const value = (await this.run(rootDir, ['branch', '--show-current'])).stdout.trim();
    if (!REF_PATTERN.test(value)) throw new TeamError('TEAM_INTEGRATION_ERROR', '当前 Git 分支无效或处于 detached HEAD');
    return value;
  }

  async merge(rootDir: string, commit: string): Promise<GitMergeResult> {
    this.assertObject(commit);
    const result = await this.tryRun(rootDir, ['merge', '--no-ff', '--no-edit', commit]);
    const conflicts = await this.conflicts(rootDir);
    if (result.exitCode !== 0 && conflicts.length === 0) {
      throw new TeamError('TEAM_INTEGRATION_ERROR', result.stderr.trim() || 'Git merge 失败');
    }
    return { ok: result.exitCode === 0, conflicts, output: bounded(result) };
  }

  async conflicts(rootDir: string): Promise<string[]> {
    const result = await this.run(rootDir, ['diff', '--name-only', '--diff-filter=U', '-z']);
    return result.stdout.split('\0').filter(Boolean).sort();
  }

  async hasUnmerged(rootDir: string): Promise<boolean> {
    return (await this.conflicts(rootDir)).length > 0;
  }

  async continueMerge(rootDir: string): Promise<void> {
    if (await this.hasUnmerged(rootDir)) throw new TeamError('TEAM_INTEGRATION_ERROR', '仍有未解决的合并冲突');
    await this.run(rootDir, ['-c', 'core.editor=true', 'merge', '--continue']);
  }

  async abortMerge(rootDir: string): Promise<void> {
    const result = await this.tryRun(rootDir, ['merge', '--abort']);
    if (result.exitCode !== 0 && !/MERGE_HEAD|no merge/iu.test(result.stderr)) {
      throw new TeamError('TEAM_INTEGRATION_ERROR', result.stderr.trim() || 'Git merge --abort 失败');
    }
  }

  async fastForward(rootDir: string, sourceRef: string, expectedHead: string): Promise<string> {
    this.assertRef(sourceRef);
    this.assertObject(expectedHead);
    const current = await this.head(rootDir);
    if (current !== expectedHead) throw new TeamError('TEAM_INTEGRATION_ERROR', 'Team Lead HEAD 在集成期间发生变化');
    await this.run(rootDir, ['merge', '--ff-only', sourceRef]);
    return this.head(rootDir);
  }

  async verifyCommit(rootDir: string, commit: string): Promise<void> {
    this.assertObject(commit);
    await this.run(rootDir, ['cat-file', '-e', `${commit}^{commit}`]);
  }

  async isAncestor(rootDir: string, ancestor: string, descendant: string): Promise<boolean> {
    this.assertObject(ancestor);
    this.assertRef(descendant);
    const result = await this.tryRun(rootDir, ['merge-base', '--is-ancestor', ancestor, descendant]);
    if (result.exitCode === 0) return true;
    if (result.exitCode === 1) return false;
    throw new TeamError('TEAM_INTEGRATION_ERROR', result.stderr.trim() || '无法验证提交与分支关系');
  }

  private assertObject(value: string): void {
    if (!OBJECT_PATTERN.test(value)) throw new TeamError('TEAM_INTEGRATION_ERROR', `Git commit 无效: ${value}`);
  }

  private assertRef(value: string): void {
    if (!REF_PATTERN.test(value)) throw new TeamError('TEAM_INTEGRATION_ERROR', `Git 引用无效: ${value}`);
  }

  private async run(cwd: string, args: readonly string[]): Promise<ProcessRunResult> {
    const result = await this.tryRun(cwd, args);
    if (result.exitCode !== 0) throw new TeamError('TEAM_INTEGRATION_ERROR', result.stderr.trim() || `git ${args[0]} 失败`);
    return result;
  }

  private tryRun(cwd: string, args: readonly string[]): Promise<ProcessRunResult> {
    return this.runner.run({ command: this.command, args, cwd });
  }
}

function bounded(result: ProcessRunResult): string {
  return `${result.stdout}${result.stderr}`.trim().slice(0, 16_000);
}
