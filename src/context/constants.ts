import type { ContextManagerOptions } from './types.js';

export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const CONTEXT_DIRECTORY = '.bettercode/context';

export const CONTEXT_SUMMARY_HEADINGS = [
  '当前目标与任务状态',
  '用户要求、明确约束和偏好',
  '已确认的方案与关键决策',
  '已完成工作、工具结果与可验证结论',
  '相关文件、代码位置和已落盘结果路径',
  '待办事项、依赖关系和建议下一步',
  '错误、风险、失败尝试与未解决问题',
] as const;

export const DEFAULT_CONTEXT_OPTIONS: ContextManagerOptions = {
  singleToolResultTokens: 8_000,
  toolBatchTokens: 16_000,
  toolPreviewTokens: 1_000,
  recentHistoryTokens: 10_000,
  recentHistoryMessages: 5,
  automaticReserveTokens: 13_000,
  manualReserveTokens: 3_000,
  summaryMaxOutputTokens: 2_048,
  summaryFailureLimit: 3,
};

export function resolveContextOptions(
  input: Partial<ContextManagerOptions> = {},
): ContextManagerOptions {
  const options = { ...DEFAULT_CONTEXT_OPTIONS, ...input };
  for (const [name, value] of Object.entries(options)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`上下文选项 ${name} 必须是正整数`);
    }
  }
  if (options.toolPreviewTokens >= options.singleToolResultTokens) {
    throw new Error('工具结果预览阈值必须小于单结果落盘阈值');
  }
  if (options.manualReserveTokens >= options.automaticReserveTokens) {
    throw new Error('手动压缩安全余量必须小于自动压缩安全余量');
  }
  return options;
}
