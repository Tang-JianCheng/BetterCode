import path from 'node:path';
import { ToolFailure } from '../tool/errors.js';
import { PathGuard } from '../tool/path-guard.js';
import type { JsonObject, Tool } from '../tool/types.js';
import { stableStringifyJson } from '../tool/stable-json.js';
import type { PermissionSubject } from './types.js';

function normalizeGlob(value: string): string {
  const normalized = value.replaceAll(path.sep, '/');
  if (path.isAbsolute(value) || normalized.split('/').includes('..')) {
    throw new ToolFailure('PATH_OUTSIDE_ROOT', `路径模式超出项目根目录: ${value}`);
  }
  return normalized;
}

export class SandboxPolicy {
  constructor(private readonly pathGuard: PathGuard) {}

  resolveSubject(tool: Tool, input: JsonObject): PermissionSubject {
    const profile = tool.permission;
    if (profile.targetKind === 'arguments') {
      try {
        return { target: stableStringifyJson(input) };
      } catch (error) {
        throw new ToolFailure(
          'INVALID_ARGUMENTS',
          `权限参数对象无效: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const raw = input[profile.targetArgument] ?? profile.defaultTarget;
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new ToolFailure(
        'INVALID_ARGUMENTS',
        `权限目标参数无效: ${profile.targetArgument}`,
      );
    }

    if (profile.targetKind === 'path') {
      return { target: this.pathGuard.resolveForWrite(raw).relative };
    }
    if (profile.targetKind === 'glob') {
      return { target: normalizeGlob(raw) };
    }
    return { target: raw };
  }
}
