import type { LLMProvider } from '../provider/types.js';
import type { AgentDefinition, AgentProviderResolver } from '../subagent/types.js';
import type { AgentDefinitionManager } from '../subagent/definition-manager.js';
import type { ToolRegistry } from '../tool/registry.js';
import type { PermissionMode } from '../permission/types.js';
import { TeamError } from './errors.js';
import { TEAM_TOOL_NAMES, type MemberActor, type TeamMemberRecord, type TeamTaskRecord } from './types.js';

const MEMBER_TEAM_TOOLS = new Set(['team_status', 'team_task', 'team_message', 'team_approval']);
const MEMBER_FORBIDDEN_TOOLS = new Set(['agent', 'load_skill', 'team_member', 'team_integrate']);

export interface TeamMemberRuntimeSnapshot {
  actor: MemberActor;
  definition: AgentDefinition;
  roleRevision: number;
  provider: LLMProvider;
  permissionMode: PermissionMode;
  maxIterations: number;
  visibleToolNames: ReadonlySet<string>;
  requiresWorktree: boolean;
  task: TeamTaskRecord;
}

export class TeamMemberRuntimeResolver {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly definitions: Pick<AgentDefinitionManager, 'get' | 'getSnapshot' | 'resolveProviderName'>,
    private readonly providers: AgentProviderResolver,
  ) {}

  resolve(team: string, member: TeamMemberRecord, task: TeamTaskRecord, inheritedProvider: LLMProvider): TeamMemberRuntimeSnapshot {
    const snapshot = this.definitions.getSnapshot();
    const definition = this.definitions.get(member.role);
    if (!definition) throw new TeamError('TEAM_STATE_ERROR', `成员角色不存在或不可用: ${member.role}`);
    const configuredProvider = this.definitions.resolveProviderName(definition);
    const provider = configuredProvider ? this.providers.resolve(configuredProvider) : inheritedProvider;
    const requested = new Set(definition.tools ?? this.registry.names());
    for (const name of definition.disallowedTools) requested.delete(name);
    for (const name of MEMBER_FORBIDDEN_TOOLS) requested.delete(name);
    for (const name of TEAM_TOOL_NAMES) requested.delete(name);
    for (const name of MEMBER_TEAM_TOOLS) if (this.registry.get(name)) requested.add(name);
    const visibleToolNames = new Set([...requested].filter(name => this.registry.get(name)));
    const requiresWorktree = [...visibleToolNames].some(name =>
      !MEMBER_TEAM_TOOLS.has(name) && this.registry.effectOf(name) === 'side_effect');
    return {
      actor: { kind: 'member', team, member: member.name, generation: member.generation },
      definition,
      roleRevision: snapshot.revision,
      provider,
      permissionMode: definition.permissionMode,
      maxIterations: definition.maxIterations,
      visibleToolNames,
      requiresWorktree,
      task: structuredClone(task),
    };
  }

}
