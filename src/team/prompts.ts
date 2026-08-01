import { buildSystemPrompt } from '../prompt/builder.js';
import { SYSTEM_PROMPT_SECTIONS } from '../prompt/sections.js';
import type { PromptSection, SupplementalPromptContent } from '../prompt/types.js';
import type { AgentDefinition } from '../subagent/types.js';
import type { TeamMemberRecord, TeamMessage, TeamTaskRecord } from './types.js';

export interface MemberPromptEnvironment {
  team: string;
  member: TeamMemberRecord;
  task: TeamTaskRecord;
  cwd: string;
  branch?: string;
  messages?: readonly TeamMessage[];
}

const MEMBER_CONSTRAINTS: PromptSection = {
  id: 'team_member_constraints',
  priority: 590,
  title: 'BetterCode 团队成员约束',
  content: [
    '你是 BetterCode 长期团队中的独立成员，只处理分派给你的任务。',
    '你可以直接使用团队工具查看任务、读写邮箱和报告进度，但不得创建或终止成员，也不得继续委派 Agent。',
    '没有新任务时结束当前运行并保持空闲；收到后续消息时会恢复同一上下文。',
  ].join('\n'),
};

export function buildMemberSystemPrompt(definition: AgentDefinition, environment: MemberPromptEnvironment): string {
  return buildSystemPrompt([
    ...SYSTEM_PROMPT_SECTIONS,
    MEMBER_CONSTRAINTS,
    {
      id: 'team_member_role',
      priority: 570,
      title: `团队角色：${definition.name}`,
      content: definition.body,
    },
    {
      id: 'team_member_workspace',
      priority: 580,
      title: '团队工作目录',
      content: [
        `团队：${environment.team}`,
        `成员：${environment.member.name}`,
        `当前工作目录：${environment.cwd}`,
        ...(environment.branch ? [`专属分支：${environment.branch}`] : ['当前角色为只读成员，与 Team Lead 共享项目根目录。']),
        '所有路径和命令必须以当前工作目录为边界，不得操作 Team Lead 或其他成员的工作目录。',
      ].join('\n'),
    },
  ]);
}

export function buildMemberTaskPrompt(environment: MemberPromptEnvironment): string {
  const inbox = (environment.messages ?? []).map(message =>
    `- [${message.type}] ${message.sender}: ${message.body}`).join('\n');
  return [
    `执行团队任务 ${environment.task.id}：${environment.task.title}`,
    '',
    environment.task.description,
    '',
    `当前任务状态：${environment.task.state}`,
    inbox ? `未读团队消息：\n${inbox}` : '当前没有新的团队消息。',
    '',
    '开始工作前用 team_task.report 将任务标记为 running；完成后报告 completed 或 failed，并给出简洁结果摘要。',
  ].join('\n');
}

export function buildMemberSupplemental(environment: MemberPromptEnvironment): SupplementalPromptContent {
  return {
    activeSkills: [{
      name: 'BetterCode 团队运行上下文',
      content: [
        `团队：${environment.team}`,
        `成员：${environment.member.name}`,
        `当前任务：${environment.task.id}`,
        `工作目录：${environment.cwd}`,
      ].join('\n'),
    }],
  };
}

export function buildLeadSupplemental(status: Record<string, unknown>): SupplementalPromptContent {
  if (status.active !== true) return {};
  const team = status.team as { name?: string; generation?: number } | undefined;
  const members = Array.isArray(status.members) ? status.members.length : 0;
  const tasks = Array.isArray(status.tasks) ? status.tasks.length : 0;
  const coordinator = status.coordinator as { active?: boolean } | undefined;
  return {
    activeSkills: [{
      name: 'BetterCode Team Lead',
      content: [
        `你是团队 ${team?.name ?? 'unknown'} 的 Team Lead，当前运行代次为 ${team?.generation ?? 'unknown'}。`,
        `当前共有 ${members} 名成员、${tasks} 个任务。`,
        '优先使用 team_* 专用工具拆分任务、派发成员、处理审批和集成代码。',
        '成员之间可以直接通过团队邮箱协作，不要把所有消息都经由主对话中转。',
        coordinator?.active
          ? 'Coordinator 模式已启用：你只负责编排、决策和 Git 集成，不得直接修改项目文件。'
          : '普通 Team Lead 模式已启用：必要时仍可直接使用普通工具。',
      ].join('\n'),
    }],
  };
}
