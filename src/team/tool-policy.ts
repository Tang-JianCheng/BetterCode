import { createToolError, type ToolExecutionPolicy, type ToolResult } from '../tool/types.js';
import type { TeamApprovalService } from './approval-service.js';
import type { TeamActor } from './types.js';
import { TEAM_TOOL_NAMES } from './types.js';

const MEMBER_ACTIONS: Record<string, ReadonlySet<string>> = {
  team_status: new Set(['get']),
  team_task: new Set(['get', 'list', 'report']),
  team_message: new Set(['send', 'broadcast', 'read', 'mark_read']),
  team_approval: new Set(['submit', 'list']),
};

const PLAN_ACTIONS: Record<string, ReadonlySet<string>> = {
  team_status: new Set(['get']),
  team_member: new Set(['list']),
  team_task: new Set(['get', 'list']),
  team_message: new Set(['read']),
  team_approval: new Set(['list']),
  team_integrate: new Set(['status']),
};

export interface TeamToolPolicyOptions {
  actor(): TeamActor | undefined;
  currentTaskId?(): string | undefined;
  approvals?: Pick<TeamApprovalService, 'authorizeTool'>;
  coordinatorActive?(): boolean;
  authorizeCoordinatorCommand?(command: string, rootDir: string): ToolResult | undefined;
}

export class TeamToolPolicy implements ToolExecutionPolicy {
  constructor(private readonly options: TeamToolPolicyOptions) {}

  authorize(input: Parameters<ToolExecutionPolicy['authorize']>[0]): ToolResult | undefined {
    const actor = this.options.actor();
    const isTeamTool = TEAM_TOOL_NAMES.includes(input.call.name as typeof TEAM_TOOL_NAMES[number]);
    if (isTeamTool) {
      if (!actor) return createToolError('TEAM_UNAVAILABLE', '当前运行身份没有激活团队');
      const action = typeof input.call.arguments.action === 'string' ? input.call.arguments.action : 'get';
      if (actor.kind === 'member' && !MEMBER_ACTIONS[input.call.name]?.has(action)) {
        return createToolError('TEAM_STATE_ERROR', `团队成员无权执行 ${input.call.name}.${action}`);
      }
      if (input.mode === 'plan' && !PLAN_ACTIONS[input.call.name]?.has(action)) {
        return createToolError('TOOL_UNAVAILABLE', `Plan Mode 不允许执行团队变更: ${input.call.name}.${action}`);
      }
      return undefined;
    }

    if (actor?.kind === 'member' && input.tool.effect === 'side_effect') {
      const taskId = this.options.currentTaskId?.();
      if (!taskId) return createToolError('TEAM_APPROVAL_REQUIRED', '成员没有可执行的当前任务');
      try {
        this.options.approvals?.authorizeTool(actor, taskId, input.tool);
      } catch (error) {
        return createToolError('TEAM_APPROVAL_REQUIRED', error instanceof Error ? error.message : String(error));
      }
    }

    if (actor?.kind === 'lead' && this.options.coordinatorActive?.() && input.tool.effect === 'side_effect') {
      if (input.call.name !== 'run_command') {
        return createToolError('TEAM_STATE_ERROR', `Coordinator 模式不允许普通副作用工具: ${input.call.name}`);
      }
      const command = input.call.arguments.command;
      if (typeof command !== 'string') return createToolError('INVALID_ARGUMENTS', 'run_command.command 必须是字符串');
      return this.options.authorizeCoordinatorCommand?.(command, input.rootDir) ?? undefined;
    }
    return undefined;
  }
}
