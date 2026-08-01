import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TeamError } from './errors.js';

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export interface TeamPaths {
  teamDir: string;
  teamFile: string;
  tasksFile: string;
  approvalsFile: string;
  membersDir: string;
  contextsDir: string;
  operationsDir: string;
  mailboxesDir: string;
  runtimeDir: string;
  integrationsDir: string;
  diagnosticsFile: string;
}

export class TeamPathGuard {
  readonly userHome: string;
  readonly rootDir: string;

  constructor(userHome = os.homedir()) {
    this.userHome = path.resolve(userHome);
    this.rootDir = path.join(this.userHome, '.bettercode', 'teams');
  }

  ensureRoot(): void {
    mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    this.assertPath(this.rootDir);
  }

  teamName(value: string): string {
    return this.name(value, '团队');
  }

  memberName(value: string, options: { allowLead?: boolean } = {}): string {
    const name = this.name(value, '成员');
    if (!options.allowLead && name === 'lead') {
      throw new TeamError('TEAM_INVALID_NAME', '成员名 lead 是 Team Lead 保留身份');
    }
    return name;
  }

  indexFile(): string {
    this.ensureRoot();
    return path.join(this.rootDir, 'index.json');
  }

  team(value: string): TeamPaths {
    const name = this.teamName(value);
    this.ensureRoot();
    const teamDir = this.assertPath(path.join(this.rootDir, name));
    return {
      teamDir,
      teamFile: path.join(teamDir, 'team.json'),
      tasksFile: path.join(teamDir, 'tasks.json'),
      approvalsFile: path.join(teamDir, 'approvals.json'),
      membersDir: path.join(teamDir, 'members'),
      contextsDir: path.join(teamDir, 'contexts'),
      operationsDir: path.join(teamDir, 'operations'),
      mailboxesDir: path.join(teamDir, 'mailboxes'),
      runtimeDir: path.join(teamDir, 'runtime'),
      integrationsDir: path.join(teamDir, 'integrations'),
      diagnosticsFile: path.join(teamDir, 'diagnostics.jsonl'),
    };
  }

  memberFile(team: string, member: string): string {
    const paths = this.team(team);
    const name = this.memberName(member);
    return this.assertPath(path.join(paths.membersDir, `${name}.json`));
  }

  contextFile(team: string, member: string): string {
    const paths = this.team(team);
    const name = this.memberName(member);
    return this.assertPath(path.join(paths.contextsDir, `${name}.json`));
  }

  mailboxFile(team: string, recipient: string): string {
    const paths = this.team(team);
    const name = this.memberName(recipient, { allowLead: true });
    return this.assertPath(path.join(paths.mailboxesDir, `${name}.jsonl`));
  }

  runtimeFile(team: string, member: string, suffix: 'lease' | 'worker'): string {
    const paths = this.team(team);
    const name = this.memberName(member);
    return this.assertPath(path.join(paths.runtimeDir, `${name}.${suffix}.json`));
  }

  assertPath(target: string): string {
    const absolute = path.resolve(target);
    const root = this.realOrNearest(this.rootDir);
    const checked = this.realOrNearest(absolute);
    if (!within(root, checked)) {
      throw new TeamError('TEAM_PATH_OUTSIDE_ROOT', `团队路径超出用户数据目录: ${target}`);
    }
    return absolute;
  }

  private name(value: string, label: string): string {
    const normalized = value.trim().toLowerCase();
    if (!NAME_PATTERN.test(normalized) || normalized === '.' || normalized === '..') {
      throw new TeamError(
        'TEAM_INVALID_NAME',
        `${label}名称只能包含小写字母、数字、短横线和下划线，长度为 1-64`,
      );
    }
    return normalized;
  }

  private realOrNearest(target: string): string {
    let current = path.resolve(target);
    const remainder: string[] = [];
    while (!existsSync(current)) {
      const parent = path.dirname(current);
      if (parent === current) break;
      remainder.unshift(path.basename(current));
      current = parent;
    }
    const base = existsSync(current) ? realpathSync(current) : current;
    return path.resolve(base, ...remainder);
  }
}
