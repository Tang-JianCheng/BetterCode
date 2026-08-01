import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TeamError } from './errors.js';
import type { TeamPathGuard } from './path-guard.js';
import type { TeamRepository } from './repository.js';

export interface TeamWorkerDescriptor {
  version: 1;
  team: string;
  member: string;
  generation: number;
  repositoryId: string;
  projectRoot: string;
  configPath?: string;
  createdAt: string;
}

export function writeWorkerDescriptor(
  guard: TeamPathGuard,
  descriptor: TeamWorkerDescriptor,
): string {
  const file = guard.runtimeFile(descriptor.team, descriptor.member, 'worker');
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
    chmodSync(file, 0o600);
    return file;
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function readWorkerDescriptor(
  file: string,
  guard: TeamPathGuard,
  repository: TeamRepository,
): TeamWorkerDescriptor {
  const absolute = guard.assertPath(file);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new TeamError('TEAM_STATE_ERROR', 'Worker 描述文件必须是权限 0600 的普通文件');
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch {
    throw new TeamError('TEAM_DATA_CORRUPT', 'Worker 描述文件不是有效 JSON');
  }
  if (!validDescriptor(value)) throw new TeamError('TEAM_DATA_CORRUPT', 'Worker 描述文件字段无效');
  const expected = guard.runtimeFile(value.team, value.member, 'worker');
  if (path.resolve(expected) !== path.resolve(absolute)) {
    throw new TeamError('TEAM_PATH_OUTSIDE_ROOT', 'Worker 描述文件路径与成员身份不匹配');
  }
  const team = repository.get(value.team)?.team;
  const member = repository.getMember(value.team, value.member);
  if (!team || !member || team.repositoryId !== value.repositoryId || team.projectRoot !== path.resolve(value.projectRoot) ||
      team.generation !== value.generation || member.generation !== value.generation || member.state === 'terminated') {
    throw new TeamError('TEAM_STATE_ERROR', 'Worker 描述文件身份、仓库或运行代次已失效');
  }
  return structuredClone(value);
}

function validDescriptor(value: unknown): value is TeamWorkerDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as TeamWorkerDescriptor;
  return item.version === 1 && typeof item.team === 'string' && typeof item.member === 'string' &&
    Number.isInteger(item.generation) && typeof item.repositoryId === 'string' &&
    typeof item.projectRoot === 'string' && typeof item.createdAt === 'string' &&
    (item.configPath === undefined || typeof item.configPath === 'string');
}
