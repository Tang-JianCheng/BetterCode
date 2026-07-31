import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { validateWorktreeName } from './name.js';
import { WorktreeError } from './types.js';

export interface WorktreeLocation {
  name: string;
  rootDir: string;
  branch: string;
  metadataPath: string;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function nearestExisting(target: string): string {
  let current = target;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return realpathSync(current);
}

export class WorktreePathGuard {
  readonly mainRoot: string;
  readonly worktreesRoot: string;
  readonly metadataRoot: string;

  constructor(mainRoot: string) {
    try {
      this.mainRoot = realpathSync(mainRoot);
    } catch {
      throw new WorktreeError('PATH_OUTSIDE_ROOT', `项目根目录不存在: ${mainRoot}`);
    }
    this.worktreesRoot = path.join(this.mainRoot, '.bettercode', 'worktrees');
    this.metadataRoot = path.join(this.mainRoot, '.bettercode', 'worktree-state');
  }

  ensureRoots(): void {
    for (const root of [this.worktreesRoot, this.metadataRoot]) {
      const parent = nearestExisting(root);
      if (!isWithin(this.mainRoot, parent)) throw new WorktreeError('PATH_OUTSIDE_ROOT', `运行目录超出项目根目录: ${root}`);
      mkdirSync(root, { recursive: true, mode: 0o700 });
      if (lstatSync(root).isSymbolicLink() || !isWithin(this.mainRoot, realpathSync(root))) {
        throw new WorktreeError('PATH_OUTSIDE_ROOT', `运行目录不能是仓库外符号链接: ${root}`);
      }
    }
  }

  location(input: string): WorktreeLocation {
    const name = validateWorktreeName(input);
    const rootDir = path.resolve(this.worktreesRoot, ...name.split('/'));
    const metadataPath = path.resolve(this.metadataRoot, ...name.split('/')) + '.json';
    this.assertCandidate(this.worktreesRoot, rootDir);
    this.assertCandidate(this.metadataRoot, metadataPath);
    return { name, rootDir, branch: `bettercode/worktree/${name}`, metadataPath };
  }

  assertExistingWorktree(target: string): string {
    const absolute = realpathSync(target);
    if (lstatSync(target).isSymbolicLink() || !isWithin(realpathSync(this.worktreesRoot), absolute)) {
      throw new WorktreeError('PATH_OUTSIDE_ROOT', `Worktree 路径越界: ${target}`);
    }
    return absolute;
  }

  assertSource(target: string): string {
    const absolute = realpathSync(target);
    if (!isWithin(this.mainRoot, absolute) || isWithin(this.worktreesRoot, absolute) || isWithin(this.metadataRoot, absolute)) {
      throw new WorktreeError('PATH_OUTSIDE_ROOT', `初始化源路径越界: ${target}`);
    }
    return absolute;
  }

  assertTarget(worktreeRoot: string, target: string): string {
    const root = realpathSync(worktreeRoot);
    const candidate = path.resolve(target);
    const parent = nearestExisting(candidate);
    if (!isWithin(root, parent) || !isWithin(root, candidate)) {
      throw new WorktreeError('PATH_OUTSIDE_ROOT', `初始化目标路径越界: ${target}`);
    }
    return candidate;
  }

  private assertCandidate(root: string, target: string): void {
    if (!isWithin(root, target)) throw new WorktreeError('PATH_OUTSIDE_ROOT', `路径越界: ${target}`);
    const parent = nearestExisting(target);
    const expectedParent = nearestExisting(root);
    if (!isWithin(expectedParent, parent) && !isWithin(this.mainRoot, parent)) {
      throw new WorktreeError('PATH_OUTSIDE_ROOT', `路径父目录越界: ${target}`);
    }
  }
}
