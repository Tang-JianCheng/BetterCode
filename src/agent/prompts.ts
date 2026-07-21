import type { SavedPlan } from './types.js';

export function buildPlanRequest(task: string): string {
  return [
    '你现在处于 Plan Mode。请检查项目并为下面的任务制定可执行计划。',
    '只允许读取和搜索项目，不要写文件、修改文件或执行命令。',
    '最终回复应给出清晰、完整的实施步骤。',
    '',
    `任务：${task.trim()}`,
  ].join('\n');
}

export function buildExecutePlanRequest(plan: SavedPlan): string {
  return [
    '请执行当前会话中最近完成的计划。根据工具结果自行调整，直到任务完成。',
    '',
    `原任务：${plan.task}`,
    '',
    '计划：',
    plan.content,
  ].join('\n');
}
