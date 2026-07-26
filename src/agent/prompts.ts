import type { SavedPlan } from './types.js';

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
