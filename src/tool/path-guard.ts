import {
  existsSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { ToolFailure } from './errors.js';

export interface GuardedPath {
  absolute: string;
  relative: string;
}

function isWithin(rootDir: string, target: string): boolean {
  const relative = path.relative(rootDir, target);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function assertRelativeInput(input: string): void {
  if (!input || typeof input !== 'string') {
    throw new ToolFailure('PATH_OUTSIDE_ROOT', '路径必须是非空相对路径');
  }

  if (path.isAbsolute(input)) {
    throw new ToolFailure('PATH_OUTSIDE_ROOT', '不允许使用绝对路径');
  }

  const segments = input.split(/[\\/]+/);
  if (segments.includes('..')) {
    throw new ToolFailure('PATH_OUTSIDE_ROOT', '路径不能越过项目根目录');
  }
}

export class PathGuard {
  readonly rootDir: string;

  constructor(rootDir: string) {
    try {
      this.rootDir = realpathSync(rootDir);
    } catch {
      throw new ToolFailure('PATH_OUTSIDE_ROOT', `项目根目录不存在: ${rootDir}`);
    }
  }

  resolveExisting(input: string): GuardedPath {
    assertRelativeInput(input);

    const candidate = path.resolve(this.rootDir, input);
    let absolute: string;
    try {
      absolute = realpathSync(candidate);
    } catch {
      throw new ToolFailure('FILE_NOT_FOUND', `文件不存在: ${input}`);
    }

    if (!isWithin(this.rootDir, absolute)) {
      throw new ToolFailure('PATH_OUTSIDE_ROOT', `路径超出项目根目录: ${input}`);
    }

    return this.toGuardedPath(absolute);
  }

  resolveForWrite(input: string): GuardedPath {
    assertRelativeInput(input);

    const candidate = path.resolve(this.rootDir, input);
    if (existsSync(candidate)) {
      return this.resolveExisting(input);
    }

    try {
      if (lstatSync(candidate).isSymbolicLink()) {
        throw new ToolFailure('PATH_OUTSIDE_ROOT', `不允许写入悬空符号链接: ${input}`);
      }
    } catch (error) {
      if (error instanceof ToolFailure) throw error;
    }

    let parent = path.dirname(candidate);
    while (!existsSync(parent)) {
      const next = path.dirname(parent);
      if (next === parent) {
        throw new ToolFailure('PATH_OUTSIDE_ROOT', `无法解析路径父目录: ${input}`);
      }
      parent = next;
    }

    let realParent: string;
    try {
      realParent = realpathSync(parent);
    } catch {
      throw new ToolFailure('PATH_OUTSIDE_ROOT', `无法解析路径父目录: ${input}`);
    }

    if (!isWithin(this.rootDir, realParent)) {
      throw new ToolFailure('PATH_OUTSIDE_ROOT', `路径超出项目根目录: ${input}`);
    }

    return this.toGuardedPath(candidate);
  }

  relative(absolute: string): string {
    return this.toGuardedPath(absolute).relative;
  }

  private toGuardedPath(absolute: string): GuardedPath {
    if (!isWithin(this.rootDir, absolute)) {
      throw new ToolFailure('PATH_OUTSIDE_ROOT', `路径超出项目根目录: ${absolute}`);
    }

    return {
      absolute,
      relative: path.relative(this.rootDir, absolute) || '.',
    };
  }

  static isDirectorySymlink(target: string): boolean {
    try {
      return lstatSync(target).isSymbolicLink();
    } catch {
      return false;
    }
  }
}
