import { arch, platform as osPlatform, release } from 'node:os';
import path from 'node:path';
import type { AgentMode } from '../agent/types.js';
import type {
  EnvironmentContext,
  EnvironmentSource,
  ReminderInput,
} from './types.js';

const DEFAULT_ENVIRONMENT_SOURCE: EnvironmentSource = {
  cwd: () => process.cwd(),
  platform: () => `${osPlatform()} ${release()} (${arch()})`,
  shell: () => process.env.SHELL || 'unknown',
  now: () => new Date(),
  timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
};

const MODE_INSTRUCTIONS = {
  plan: {
    full: [
      '当前处于 Plan Mode。只允许读取文件、查找文件和搜索代码，不得写入、编辑或执行命令。',
      '先检查与任务直接相关的项目事实，再输出清晰、完整、可执行的实施计划；不要实际修改项目。',
    ].join('\n'),
    compact: 'Plan Mode：保持只读，只分析必要事实并输出计划，不得修改项目。',
  },
  act: {
    full: [
      '当前处于 Act Mode。可以使用本次请求提供的完整工具集合执行任务。',
      '根据工具结果持续调整，完成必要修改与验证后再给出最终回复。',
    ].join('\n'),
    compact: 'Act Mode：可使用当前完整工具集合执行任务，并根据结果完成必要验证。',
  },
} as const satisfies Record<AgentMode, { full: string; compact: string }>;

function formatDate(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function escapeReminderBoundary(value: string): string {
  return value.replace(/<\s*\/?\s*system-reminder\b[^>]*>/gi, tag =>
    tag.replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? escapeReminderBoundary(cleaned) : undefined;
}

export function collectEnvironment(
  projectRoot: string,
  mode: AgentMode,
  source: EnvironmentSource = DEFAULT_ENVIRONMENT_SOURCE,
): EnvironmentContext {
  const timezone = source.timezone() || 'unknown';
  return {
    projectRoot: path.resolve(projectRoot),
    currentDirectory: path.resolve(source.cwd()),
    platform: source.platform() || 'unknown',
    shell: source.shell() || 'unknown',
    currentDate: formatDate(source.now(), timezone),
    timezone,
    mode,
  };
}

export function isFullModeReminder(iteration: number): boolean {
  if (!Number.isInteger(iteration) || iteration < 1) {
    throw new Error('Agent 轮次必须是大于零的整数');
  }
  return (iteration - 1) % 5 === 0;
}

export function buildSystemReminder(input: ReminderInput): string {
  const { environment, supplemental } = input;
  const sections: string[] = [];
  const skills = supplemental?.activeSkills
    ?.map(skill => ({
      name: cleanOptional(skill.name),
      content: cleanOptional(skill.content),
    }))
    .filter((skill): skill is { name: string; content: string } =>
      Boolean(skill.name && skill.content));
  if (skills?.length) {
    sections.push([
      '## 已激活的 Skill',
      ...skills.map(skill => `### ${skill.name}\n${skill.content}`),
    ].join('\n\n'));
  }

  sections.push(
    [
      '## 环境信息',
      `- 项目根目录：${environment.projectRoot}`,
      `- 当前工作目录：${environment.currentDirectory}`,
      `- 操作系统与平台：${environment.platform}`,
      `- Shell：${environment.shell}`,
      `- 当前日期：${environment.currentDate}`,
      `- 时区：${environment.timezone}`,
      `- 当前任务模式：${environment.mode}`,
    ].join('\n'),
    [
      '## 当前任务模式',
      isFullModeReminder(input.iteration)
        ? MODE_INSTRUCTIONS[environment.mode].full
        : MODE_INSTRUCTIONS[environment.mode].compact,
    ].join('\n'),
  );

  const availableSkills = supplemental?.availableSkills
    ?.map(skill => ({
      name: cleanOptional(skill.name),
      description: cleanOptional(skill.description),
    }))
    .filter((skill): skill is { name: string; description: string } =>
      Boolean(skill.name && skill.description));
  if (availableSkills?.length) {
    sections.push([
      '## 可用 Skill',
      '需要复用工作流时，优先调用 load_skill 按需加载。',
      ...availableSkills.map(skill => `- ${skill.name}: ${skill.description}`),
    ].join('\n'));
  }

  const customInstructions = cleanOptional(supplemental?.customInstructions);
  if (customInstructions) {
    sections.push(`## 自定义指令\n${customInstructions}`);
  }

  const longTermMemory = cleanOptional(supplemental?.longTermMemory);
  if (longTermMemory) {
    sections.push(`## 长期记忆\n${longTermMemory}`);
  }

  return `<system-reminder>\n${sections.join('\n\n')}\n</system-reminder>`;
}
