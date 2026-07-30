import type { SkillMetadata } from '../skill/types.js';
import type { CommandDefinition } from './types.js';

export function createSkillCommandDefinitions(
  skills: readonly Pick<SkillMetadata, 'name' | 'description'>[],
): CommandDefinition[] {
  return skills.map(skill => ({
    name: skill.name,
    aliases: [],
    description: skill.description,
    usage: `/${skill.name} [参数]`,
    argumentHint: '[参数]',
    type: 'prompt',
    handler: ({ args, raw, ui }) => ui.runSkill(skill.name, args, raw),
  }));
}
