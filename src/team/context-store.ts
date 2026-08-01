import { AtomicJsonStore, isRevisionedRecord } from './atomic-store.js';
import { TeamError } from './errors.js';
import { TeamPathGuard } from './path-guard.js';
import type { MemberContextSnapshot } from './types.js';

function validContext(value: unknown): value is MemberContextSnapshot {
  if (!isRevisionedRecord(value) || typeof value !== 'object' || value === null) return false;
  const context = value as MemberContextSnapshot;
  return context.version === 1 && typeof context.team === 'string' && typeof context.member === 'string' &&
    Number.isInteger(context.generation) && Number.isInteger(context.roleRevision) &&
    typeof context.systemPromptHash === 'string' && Array.isArray(context.messages) &&
    typeof context.usage === 'object' && Number.isInteger(context.lastSafeIteration) &&
    Array.isArray(context.uncertainOperationIds) && typeof context.updatedAt === 'string';
}

export class MemberContextStore {
  constructor(private readonly guard: TeamPathGuard) {}

  read(teamInput: string, memberInput: string, generation?: number): MemberContextSnapshot | undefined {
    const team = this.guard.teamName(teamInput);
    const member = this.guard.memberName(memberInput);
    const context = this.store(team, member).read();
    if (!context) return undefined;
    if (context.team !== team || context.member !== member) {
      throw new TeamError('TEAM_DATA_CORRUPT', '成员上下文身份不匹配');
    }
    if (generation !== undefined && context.generation !== generation) {
      throw new TeamError('TEAM_CONFLICT', '成员上下文属于旧运行代次');
    }
    return context;
  }

  write(snapshot: MemberContextSnapshot, expectedRevision: number): MemberContextSnapshot {
    const team = this.guard.teamName(snapshot.team);
    const member = this.guard.memberName(snapshot.member);
    return this.store(team, member).write({ ...snapshot, team, member }, expectedRevision);
  }

  private store(team: string, member: string): AtomicJsonStore<MemberContextSnapshot> {
    return new AtomicJsonStore(this.guard.contextFile(team, member), validContext);
  }
}
