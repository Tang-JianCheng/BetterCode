import {
  createToolError,
  createToolSuccess,
  type JsonObject,
  type Tool,
  type ToolContext,
  type ToolResult,
} from '../tool/types.js';
import { AGENT_TOOL_NAME } from './types.js';

export class AgentTool implements Tool {
  readonly name = AGENT_TOOL_NAME;
  readonly description = [
    '把独立子任务委派给子 Agent。defined 需要 role 和 task，可选择后台；fork 继承当前请求上下文并强制后台。',
    '子 Agent不能继续调用 agent；后台任务先返回任务 ID，完成结果会在主 Agent下一次自然请求时回流。',
  ].join('');
  readonly inputSchema = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['defined', 'fork'] },
      task: { type: 'string', minLength: 1 },
      role: { type: 'string', minLength: 1 },
      background: { type: 'boolean' },
    },
    required: ['type', 'task'],
    additionalProperties: false,
  };
  readonly effect = 'read_only' as const;
  readonly permission = { targetKind: 'arguments' as const, risk: 'read' as const };

  execute(input: JsonObject, _context: ToolContext): Promise<ToolResult> {
    const type = input.type;
    const task = typeof input.task === 'string' ? input.task.trim() : '';
    if (!task) return Promise.resolve(createToolError('INVALID_ARGUMENTS', 'agent.task 必须是非空字符串'));
    if (type === 'defined') {
      const role = typeof input.role === 'string' ? input.role.trim().toLowerCase() : '';
      if (!role) return Promise.resolve(createToolError('INVALID_ARGUMENTS', 'defined agent 必须指定 role'));
      if (input.background !== undefined && typeof input.background !== 'boolean') {
        return Promise.resolve(createToolError('INVALID_ARGUMENTS', 'agent.background 必须是布尔值'));
      }
      return Promise.resolve(createToolSuccess('子 Agent 请求已准备调度。', {
        subagentDispatch: true,
        subagentType: 'defined',
      }));
    }
    if (type === 'fork') {
      if (input.role !== undefined || input.background !== undefined) {
        return Promise.resolve(createToolError('INVALID_ARGUMENTS', 'fork agent 不允许 role 或 background'));
      }
      return Promise.resolve(createToolSuccess('Fork 子 Agent请求已准备调度。', {
        subagentDispatch: true,
        subagentType: 'fork',
      }));
    }
    return Promise.resolve(createToolError('INVALID_ARGUMENTS', 'agent.type 必须是 defined 或 fork'));
  }
}
