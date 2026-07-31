import { buildSystemPrompt } from '../prompt/builder.js';
import { SYSTEM_PROMPT_SECTIONS } from '../prompt/sections.js';
import type { PromptSection } from '../prompt/types.js';
import type { AgentDefinition } from './types.js';

export interface DefinedAgentWorktreePrompt {
  cwd: string;
  branch: string;
  baseCommit: string;
}

const SUBAGENT_CONSTRAINTS: PromptSection = {
  id: 'subagent_constraints',
  priority: 575,
  title: '子 Agent 约束',
  content: [
    '你是独立运行的子 Agent，只完成当前收到的子任务，不得继续委派其他 Agent。',
    '运行过程不与用户交互；权限或信息不足时调整方案，并在无法继续时如实说明限制。',
    '完成后只输出一份可独立理解的结果，不要输出面向主 Agent 的过程旁白。',
  ].join('\n'),
};

export function buildDefinedAgentSystemPrompt(
  definition: AgentDefinition,
  worktree?: DefinedAgentWorktreePrompt,
): string {
  return buildSystemPrompt([
    ...SYSTEM_PROMPT_SECTIONS,
    SUBAGENT_CONSTRAINTS,
    {
      id: 'subagent_role',
      priority: 550,
      title: `子 Agent 角色：${definition.name}`,
      content: definition.body,
    },
    ...(worktree ? [{
      id: 'subagent_worktree',
      priority: 565,
      title: 'Worktree 隔离环境',
      content: [
        `当前工作目录：${worktree.cwd}`,
        `当前专属分支：${worktree.branch}`,
        `创建基点：${worktree.baseCommit}`,
        '所有文件和命令工具都必须在当前工作目录执行，不得操作主工作区，也不要假设主工作区后续修改已同步。',
      ].join('\n'),
    } satisfies PromptSection] : []),
  ]);
}

export function buildDefinedAgentTask(task: string): string {
  return `完成以下子任务，并只返回可独立理解的最终结果：\n\n${task.trim()}`;
}

export function buildForkAgentTask(task: string): string {
  return [
    '你是从当前请求上下文 Fork 出来的非交互子 Agent。',
    '独立完成下面的子任务，不得继续委派其他 Agent；完成后只返回结果摘要。',
    '',
    task.trim(),
  ].join('\n');
}
