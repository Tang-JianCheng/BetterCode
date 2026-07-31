import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  copyFileSync,
} from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type { GitWorktreeClientContract } from './git-client.js';
import type { WorktreePathGuard } from './path-guard.js';
import {
  MAX_WORKTREE_RULE_MATCHES,
  type ResolvedWorktreeOptions,
  type WorktreeInitializationDiagnostic,
  type WorktreeMetadata,
  type WorktreeRule,
  WorktreeError,
} from './types.js';

function relativeUnix(value: string): string {
  return value.split(path.sep).join('/');
}

export class WorktreeInitializer {
  constructor(
    private readonly guard: WorktreePathGuard,
    private readonly git: GitWorktreeClientContract,
    private readonly options: ResolvedWorktreeOptions,
  ) {}

  async initialize(metadata: WorktreeMetadata): Promise<readonly WorktreeInitializationDiagnostic[]> {
    const diagnostics: WorktreeInitializationDiagnostic[] = [];
    await this.attempt('git_hooks', { source: metadata.mainRoot, required: false }, diagnostics, async () => {
      await this.git.configureHooks(metadata.mainRoot, metadata.worktreeRoot);
    });
    await this.applyCopyRules(metadata, this.options.copyFiles, 'copy', false, diagnostics);
    await this.applyCopyRules(metadata, this.options.ignoredFiles, 'ignored_file', true, diagnostics);
    for (const rule of this.options.symlinks) {
      await this.attempt('symlink', rule, diagnostics, async () => this.link(metadata, rule));
    }
    return diagnostics;
  }

  private async applyCopyRules(
    metadata: WorktreeMetadata,
    rules: readonly WorktreeRule[],
    kind: 'copy' | 'ignored_file',
    ignoredOnly: boolean,
    diagnostics: WorktreeInitializationDiagnostic[],
  ): Promise<void> {
    for (const rule of rules) {
      await this.attempt(kind, rule, diagnostics, async () => {
        let matches = await fg(rule.source, {
          cwd: metadata.mainRoot,
          dot: true,
          onlyFiles: false,
          unique: true,
          followSymbolicLinks: false,
        });
        if (matches.length > MAX_WORKTREE_RULE_MATCHES) throw new Error(`匹配超过 ${MAX_WORKTREE_RULE_MATCHES} 项`);
        if (ignoredOnly && matches.length > 0) {
          const ignored = await this.git.isIgnored(metadata.mainRoot, matches);
          matches = matches.filter(item => ignored.has(item));
        }
        if (matches.length === 0 && rule.required) throw new Error(`必需初始化源不存在: ${rule.source}`);
        for (const match of matches) {
          const source = path.resolve(metadata.mainRoot, match);
          this.guard.assertSource(source);
          const targetRelative = rule.target
            ? matches.length === 1 ? rule.target : path.join(rule.target, path.basename(match))
            : match;
          if (targetRelative === '.git' || targetRelative.startsWith('.git/') ||
              targetRelative.startsWith('.bettercode/worktrees') ||
              targetRelative.startsWith('.bettercode/worktree-state')) {
            throw new Error(`禁止写入运行或 Git 内部目录: ${targetRelative}`);
          }
          const target = this.guard.assertTarget(metadata.worktreeRoot, path.resolve(metadata.worktreeRoot, targetRelative));
          this.copy(source, target);
        }
      });
    }
  }

  private copy(source: string, target: string): void {
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error(`不复制符号链接: ${source}`);
    if (existsSync(target)) {
      const targetStat = lstatSync(target);
      if (stat.isDirectory() && targetStat.isDirectory()) {
        for (const entry of fg.sync('*', { cwd: source, dot: true, onlyFiles: false, followSymbolicLinks: false })) {
          this.copy(path.join(source, entry), path.join(target, entry));
        }
        return;
      }
      throw new Error(`初始化目标已存在: ${target}`);
    }
    if (stat.isDirectory()) {
      mkdirSync(target, { recursive: true, mode: stat.mode });
      for (const entry of fg.sync('*', { cwd: source, dot: true, onlyFiles: false, followSymbolicLinks: false })) {
        this.copy(path.join(source, entry), path.join(target, entry));
      }
      return;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    chmodSync(target, stat.mode);
  }

  private link(metadata: WorktreeMetadata, rule: WorktreeRule): void {
    const sourceCandidate = path.resolve(metadata.mainRoot, rule.source);
    if (!existsSync(sourceCandidate)) return;
    const source = this.guard.assertSource(sourceCandidate);
    const targetRelative = rule.target ?? rule.source;
    const target = this.guard.assertTarget(metadata.worktreeRoot, path.resolve(metadata.worktreeRoot, targetRelative));
    mkdirSync(path.dirname(target), { recursive: true });
    const relativeSource = path.relative(path.dirname(target), source);
    if (existsSync(target)) {
      if (lstatSync(target).isSymbolicLink() && path.resolve(path.dirname(target), readlinkSync(target)) === source) return;
      throw new Error(`软链目标已存在: ${target}`);
    }
    symlinkSync(relativeUnix(relativeSource), target, process.platform === 'win32' ? 'junction' : undefined);
  }

  private async attempt(
    kind: WorktreeInitializationDiagnostic['kind'],
    rule: Pick<WorktreeRule, 'source' | 'target' | 'required'>,
    diagnostics: WorktreeInitializationDiagnostic[],
    action: () => void | Promise<void>,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        kind,
        source: rule.source,
        ...(rule.target ? { target: rule.target } : {}),
        required: rule.required,
        message: message.slice(0, 1000),
      });
      if (rule.required) throw new WorktreeError('INITIALIZATION_FAILED', `必需初始化规则失败: ${rule.source}`);
    }
  }
}
