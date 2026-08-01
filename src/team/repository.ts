import { chmodSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { AtomicJsonStore, isRevisionedRecord } from './atomic-store.js';
import { TeamError, teamDiagnostic, type TeamDiagnostic } from './errors.js';
import { TeamPathGuard } from './path-guard.js';
import type {
  TeamIndexRecord,
  TeamMemberRecord,
  TeamRecord,
  TeamSnapshot,
  TeamState,
} from './types.js';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTeam(value: unknown): value is TeamRecord {
  if (!isRevisionedRecord(value) || !object(value)) return false;
  const state = value.state as TeamState;
  return value.version === 1 && typeof value.name === 'string' &&
    typeof value.repositoryId === 'string' && typeof value.projectRoot === 'string' &&
    typeof value.lead === 'string' && ['active', 'archiving', 'archived'].includes(state) &&
    Number.isInteger(value.generation) && typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string';
}

function validIndex(value: unknown): value is TeamIndexRecord {
  return isRevisionedRecord(value) && object(value) && value.version === 1 &&
    object(value.teams) && object(value.activeBySession);
}

function validMember(value: unknown): value is TeamMemberRecord {
  return isRevisionedRecord(value) && object(value) && value.version === 1 &&
    typeof value.name === 'string' && typeof value.role === 'string' &&
    typeof value.state === 'string' && typeof value.backend === 'string' &&
    typeof value.rootDir === 'string' && typeof value.contextPath === 'string' &&
    Number.isInteger(value.generation) && object(value.usage);
}

function emptyIndex(): TeamIndexRecord {
  return { version: 1, revision: 0, teams: {}, activeBySession: {} };
}

export interface CreateTeamInput {
  name: string;
  repositoryId: string;
  projectRoot: string;
  lead?: string;
}

export class TeamRepository {
  private readonly diagnostics: TeamDiagnostic[] = [];

  constructor(private readonly guard: TeamPathGuard) {
    guard.ensureRoot();
  }

  create(input: CreateTeamInput): TeamSnapshot {
    const name = this.guard.teamName(input.name);
    const paths = this.guard.team(name);
    if (existsSync(paths.teamFile)) {
      throw new TeamError('TEAM_ALREADY_EXISTS', `团队已存在: ${name}`);
    }
    mkdirSync(paths.teamDir, { recursive: true, mode: 0o700 });
    for (const directory of [
      paths.membersDir,
      paths.contextsDir,
      paths.operationsDir,
      paths.mailboxesDir,
      paths.runtimeDir,
      paths.integrationsDir,
    ]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
    }
    const now = new Date().toISOString();
    const record: TeamRecord = {
      version: 1,
      revision: 0,
      name,
      repositoryId: input.repositoryId,
      projectRoot: path.resolve(input.projectRoot),
      lead: input.lead?.trim() || 'lead',
      state: 'active',
      generation: 0,
      createdAt: now,
      updatedAt: now,
    };
    const team = this.teamStore(name).write(record, 0);
    this.updateIndex(index => ({
      ...index,
      teams: {
        ...index.teams,
        [name]: { state: team.state, projectRoot: team.projectRoot, updatedAt: team.updatedAt },
      },
    }));
    return { team, members: [], diagnostics: [] };
  }

  list(): TeamSnapshot[] {
    this.guard.ensureRoot();
    const snapshots: TeamSnapshot[] = [];
    for (const name of readdirSync(this.guard.rootDir)) {
      if (name === 'index.json' || name.startsWith('.')) continue;
      try {
        const snapshot = this.get(name);
        if (snapshot) snapshots.push(snapshot);
      } catch (error) {
        this.diagnostics.push(teamDiagnostic(
          error instanceof TeamError ? error.code : 'TEAM_DATA_CORRUPT',
          error instanceof Error ? error.message : String(error),
          name,
        ));
      }
    }
    return snapshots.sort((left, right) => left.team.name.localeCompare(right.team.name));
  }

  get(nameInput: string): TeamSnapshot | undefined {
    const name = this.guard.teamName(nameInput);
    const team = this.teamStore(name).read();
    if (!team) return undefined;
    return { team, members: this.listMembers(name), diagnostics: this.diagnosticsFor(name) };
  }

  activate(nameInput: string, sessionId: string, repositoryId: string): TeamSnapshot {
    const name = this.guard.teamName(nameInput);
    const store = this.teamStore(name);
    const current = store.read();
    if (!current) throw new TeamError('TEAM_NOT_FOUND', `团队不存在: ${name}`);
    if (current.state === 'archived') throw new TeamError('TEAM_ARCHIVED', `团队已归档: ${name}`);
    if (current.repositoryId !== repositoryId) {
      throw new TeamError('TEAM_REPOSITORY_MISMATCH', `团队不属于当前 Git 仓库: ${name}`);
    }
    const now = new Date().toISOString();
    const team = store.write({ ...current, generation: current.generation + 1, updatedAt: now }, current.revision);
    const members = this.listMembers(name).map(member => {
      if (member.state === 'terminated') return member;
      const interrupted = member.state === 'running' || member.state === 'stopping';
      return this.writeMember(name, {
        ...member,
        state: interrupted ? 'interrupted' : member.state,
        generation: team.generation,
        lastActiveAt: now,
        ...(interrupted ? {
          lastError: teamDiagnostic('TEAM_STATE_ERROR', 'BetterCode 重启后运行成员已标记为中断'),
        } : {}),
      }, member.revision);
    });
    this.updateIndex(index => ({
      ...index,
      teams: {
        ...index.teams,
        [name]: { state: team.state, projectRoot: team.projectRoot, updatedAt: team.updatedAt },
      },
      activeBySession: { ...index.activeBySession, [sessionId]: name },
    }));
    return { team, members, diagnostics: this.diagnosticsFor(name) };
  }

  activeForSession(sessionId: string): TeamSnapshot | undefined {
    const index = this.indexStore().read() ?? emptyIndex();
    const name = index.activeBySession[sessionId];
    return name ? this.get(name) : undefined;
  }

  clearActiveSession(sessionId: string): void {
    this.updateIndex(index => {
      const activeBySession = { ...index.activeBySession };
      delete activeBySession[sessionId];
      return { ...index, activeBySession };
    });
  }

  archive(nameInput: string): TeamSnapshot {
    return this.setTeamState(nameInput, 'archived');
  }

  restore(nameInput: string): TeamSnapshot {
    return this.setTeamState(nameInput, 'active');
  }

  writeMember(teamInput: string, member: TeamMemberRecord, expectedRevision: number): TeamMemberRecord {
    const team = this.guard.teamName(teamInput);
    const file = this.guard.memberFile(team, member.name);
    return new AtomicJsonStore(file, validMember).write(member, expectedRevision);
  }

  getMember(teamInput: string, memberInput: string): TeamMemberRecord | undefined {
    const team = this.guard.teamName(teamInput);
    const member = this.guard.memberName(memberInput);
    return new AtomicJsonStore(this.guard.memberFile(team, member), validMember).read();
  }

  listMembers(teamInput: string): TeamMemberRecord[] {
    const team = this.guard.teamName(teamInput);
    const directory = this.guard.team(team).membersDir;
    if (!existsSync(directory)) return [];
    const members: TeamMemberRecord[] = [];
    for (const name of readdirSync(directory).filter(file => file.endsWith('.json'))) {
      try {
        const member = new AtomicJsonStore(path.join(directory, name), validMember).read();
        if (member) members.push(member);
      } catch (error) {
        this.diagnostics.push(teamDiagnostic(
          error instanceof TeamError ? error.code : 'TEAM_DATA_CORRUPT',
          error instanceof Error ? error.message : String(error),
          `${team}/${name}`,
        ));
      }
    }
    return members.sort((left, right) => left.name.localeCompare(right.name));
  }

  getDiagnostics(): readonly TeamDiagnostic[] {
    return this.diagnostics.map(item => ({ ...item }));
  }

  private setTeamState(nameInput: string, state: 'active' | 'archived'): TeamSnapshot {
    const name = this.guard.teamName(nameInput);
    const store = this.teamStore(name);
    const current = store.read();
    if (!current) throw new TeamError('TEAM_NOT_FOUND', `团队不存在: ${name}`);
    const now = new Date().toISOString();
    const team = store.write({
      ...current,
      state,
      updatedAt: now,
      ...(state === 'archived' ? { archivedAt: now } : { archivedAt: undefined }),
    }, current.revision);
    this.updateIndex(index => {
      const activeBySession = Object.fromEntries(
        Object.entries(index.activeBySession).filter(([, active]) => active !== name || state !== 'archived'),
      );
      return {
        ...index,
        teams: {
          ...index.teams,
          [name]: { state, projectRoot: team.projectRoot, updatedAt: team.updatedAt },
        },
        activeBySession,
      };
    });
    return { team, members: this.listMembers(name), diagnostics: this.diagnosticsFor(name) };
  }

  private teamStore(name: string): AtomicJsonStore<TeamRecord> {
    return new AtomicJsonStore(this.guard.team(name).teamFile, validTeam);
  }

  private indexStore(): AtomicJsonStore<TeamIndexRecord> {
    return new AtomicJsonStore(this.guard.indexFile(), validIndex);
  }

  private updateIndex(update: (current: TeamIndexRecord) => TeamIndexRecord): TeamIndexRecord {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const store = this.indexStore();
      const current = store.read() ?? emptyIndex();
      try {
        return store.write(update(structuredClone(current)), current.revision);
      } catch (error) {
        if (!(error instanceof TeamError) || error.code !== 'TEAM_CONFLICT' || attempt === 2) throw error;
      }
    }
    throw new TeamError('TEAM_CONFLICT', '更新团队索引失败');
  }

  private diagnosticsFor(team: string): TeamDiagnostic[] {
    return this.diagnostics.filter(item => item.source === team || item.source?.startsWith(`${team}/`));
  }
}
