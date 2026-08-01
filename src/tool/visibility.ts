import type { AgentMode } from '../agent/types.js';
import { TEAM_TOOL_NAMES } from '../team/types.js';
import type { ToolEffect } from './types.js';

const MEMBER_TEAM_TOOLS = new Set([
  'team_status',
  'team_task',
  'team_message',
  'team_approval',
]);

export interface ToolVisibilityInput {
  allNames: readonly string[];
  effectOf(name: string): ToolEffect | undefined;
  skillNames?: ReadonlySet<string>;
  team?: {
    active: boolean;
    actor: 'lead' | 'member';
    coordinator?: boolean;
  };
  mode: AgentMode;
}

export function resolveVisibleTools(input: ToolVisibilityInput): ReadonlySet<string> {
  const all = new Set(input.allNames);
  const names = new Set(input.skillNames ?? input.allNames);
  for (const tool of TEAM_TOOL_NAMES) names.delete(tool);

  if (input.team?.active) {
    const additions = input.team.actor === 'lead' ? TEAM_TOOL_NAMES : MEMBER_TEAM_TOOLS;
    for (const tool of additions) if (all.has(tool)) names.add(tool);
  }

  if (input.team?.active && input.team.actor === 'lead' && input.team.coordinator) {
    for (const name of [...names]) {
      if (name === 'agent' || (input.effectOf(name) === 'side_effect' && name !== 'run_command' &&
          !TEAM_TOOL_NAMES.includes(name as typeof TEAM_TOOL_NAMES[number]))) {
        names.delete(name);
      }
    }
    if (all.has('run_command')) names.add('run_command');
  }

  if (input.mode === 'plan') {
    for (const name of [...names]) {
      if (input.effectOf(name) === 'side_effect' &&
          !TEAM_TOOL_NAMES.includes(name as typeof TEAM_TOOL_NAMES[number])) names.delete(name);
    }
  }

  return names;
}
