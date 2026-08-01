import {
  createToolError,
  type JsonObject,
  type Tool,
  type ToolContext,
  type ToolResult,
} from '../tool/types.js';
import type { TeamToolName } from './types.js';

export interface TeamToolHandler {
  execute(tool: TeamToolName, input: JsonObject, context: ToolContext): Promise<ToolResult>;
}

const ACTIONS: Record<TeamToolName, readonly string[]> = {
  team_status: ['get'],
  team_member: ['list', 'create', 'resume', 'terminate'],
  team_task: ['create', 'get', 'list', 'update', 'assign', 'report', 'reopen', 'cancel'],
  team_message: ['send', 'broadcast', 'read', 'mark_read'],
  team_approval: ['submit', 'list', 'decide'],
  team_integrate: ['start', 'status', 'continue', 'abort', 'finalize'],
};

const DESCRIPTIONS: Record<TeamToolName, string> = {
  team_status: '查询当前 BetterCode 团队、成员、任务、审批、邮箱与代码集成状态。',
  team_member: '创建、恢复、终止或列出长期团队成员。创建成员前必须先确认角色和后端。',
  team_task: '管理共享任务及依赖。成员只能查询和报告分派给自己的任务。',
  team_message: '向团队成员或 Team Lead 发送、广播和读取持久化邮箱消息。',
  team_approval: '成员提交逐任务计划，Team Lead 使用结构化决定批准或驳回。',
  team_integrate: '在临时集成 Worktree 中按任务依赖顺序合并成员代码。',
};

class TeamDispatchTool implements Tool {
  readonly effect;
  readonly permission = { targetKind: 'arguments' as const, risk: 'write' as const };
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;

  constructor(
    readonly name: TeamToolName,
    private readonly handler: TeamToolHandler,
  ) {
    this.effect = name === 'team_status' ? 'read_only' as const : 'side_effect' as const;
    this.description = DESCRIPTIONS[name];
    this.inputSchema = {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ACTIONS[name] },
        team: { type: 'string' },
        member: { type: 'string' },
        role: { type: 'string' },
        backend: { type: 'string' },
        requires_approval: { type: 'boolean' },
        task_id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        dependencies: { type: 'array', items: { type: 'string' } },
        state: { type: 'string' },
        result_summary: { type: 'string' },
        branch: { type: 'string' },
        commit: { type: 'string' },
        recipient: { type: 'string' },
        body: { type: 'string' },
        summary: { type: 'string' },
        message_type: { type: 'string' },
        message_ids: { type: 'array', items: { type: 'string' } },
        approval_id: { type: 'string' },
        plan: { type: 'string' },
        expected_operations: { type: 'array', items: { type: 'string' } },
        decision: { type: 'string', enum: ['approve', 'reject'] },
        comment: { type: 'string' },
        reason: { type: 'string' },
        integration_id: { type: 'string' },
        task_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['action'],
      additionalProperties: false,
    };
  }

  execute(input: JsonObject, context: ToolContext): Promise<ToolResult> {
    if (!ACTIONS[this.name].includes(String(input.action))) {
      return Promise.resolve(createToolError('INVALID_ARGUMENTS', `${this.name}.action 无效`));
    }
    return this.handler.execute(this.name, input, context).catch(error =>
      createToolError('TEAM_STATE_ERROR', error instanceof Error ? error.message : String(error)));
  }
}

export function createTeamTools(handler: TeamToolHandler): Tool[] {
  return (Object.keys(ACTIONS) as TeamToolName[]).map(name => new TeamDispatchTool(name, handler));
}
