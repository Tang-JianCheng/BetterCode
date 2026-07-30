import {
  createToolError,
  createToolSuccess,
  type JsonObject,
  type Tool,
  type ToolContext,
  type ToolResult,
} from '../tool/types.js';
import type { SkillManager } from './manager.js';

export const LOAD_SKILL_TOOL_NAME = 'load_skill';

export class LoadSkillTool implements Tool {
  readonly name = LOAD_SKILL_TOOL_NAME;
  readonly description = '按名称加载可用 Skill。需要复用工作流时优先使用此工具；共享 Skill 会持续激活，独立 Skill 会在隔离对话中执行。';
  readonly inputSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      args: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  };
  readonly effect = 'read_only' as const;
  readonly permission = { targetKind: 'arguments' as const, risk: 'read' as const };

  constructor(private readonly manager: SkillManager) {}

  execute(input: JsonObject, _context: ToolContext): Promise<ToolResult> {
    const name = typeof input.name === 'string' ? input.name.trim().toLowerCase() : '';
    const args = typeof input.args === 'string' ? input.args : '';
    try {
      const resolution = this.manager.resolveLoad(name, args);
      if (resolution.status === 'shared') {
        return Promise.resolve(createToolSuccess(
          `Skill ${resolution.skill.name} 已激活，完整指令和工具白名单从下一轮开始生效。`,
          { skill: resolution.skill.name, skillMode: 'shared' },
        ));
      }
      return Promise.resolve(createToolSuccess(
        `Skill ${resolution.skill.name} 已准备独立执行。`,
        { skill: resolution.skill.name, skillMode: 'isolated', skillArgs: args },
      ));
    } catch (error) {
      return Promise.resolve(createToolError(
        'TOOL_UNAVAILABLE',
        error instanceof Error ? error.message : String(error),
      ));
    }
  }
}
