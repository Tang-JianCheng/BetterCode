import { truncateUtf8 } from '../tool/output-limit.js';
import type { SubAgentTaskSnapshot } from './types.js';

const MAX_DETAIL_TEXT_BYTES = 4 * 1024;

function label(task: SubAgentTaskSnapshot): string {
  return task.kind === 'defined' ? `defined/${task.role ?? 'unknown'}` : 'fork';
}

export function formatTaskList(tasks: readonly SubAgentTaskSnapshot[]): string {
  if (tasks.length === 0) return '当前会话没有子 Agent 任务。';
  return [
    '子 Agent 任务（使用 /tasks <任务 ID> 查看详情）:',
    ...[...tasks]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(task => {
        const background = task.executionMode === 'background'
          ? `，后台/${task.backgroundReason ?? 'unknown'}`
          : '';
        return `  ${task.id} [${task.state}] ${label(task)}${background} - ${task.task}`;
      }),
  ].join('\n');
}

export function formatTaskDetail(task: SubAgentTaskSnapshot | undefined, taskId: string): string {
  if (!task) return `未找到当前会话中的子 Agent 任务: ${taskId}。使用 /tasks 查看任务列表。`;
  const result = truncateUtf8(
    task.result?.trim() || task.error?.message || '暂无结果',
    MAX_DETAIL_TEXT_BYTES,
  ).value;
  return [
    `任务 ID: ${task.id}`,
    `类型: ${label(task)}`,
    `状态: ${task.state}`,
    `执行方式: ${task.executionMode}${task.backgroundReason ? ` (${task.backgroundReason})` : ''}`,
    `停止原因: ${task.stopReason ?? '暂无'}`,
    `迭代: ${task.iterations}`,
    `Token: 输入 ${task.usage.inputTokens} / 输出 ${task.usage.outputTokens} / 总计 ${task.usage.totalTokens}`,
    `缓存: 创建 ${task.usage.cacheCreationInputTokens} / 命中 ${task.usage.cacheReadInputTokens}`,
    `任务: ${task.task}`,
    `结果: ${result}`,
  ].join('\n');
}
