import { SYSTEM_PROMPT_SECTIONS } from './sections.js';
import type { PromptSection } from './types.js';

export interface BuildSystemPromptOptions {
  customInstructions?: string;
  memorySection?: string;
}

function validateSections(sections: readonly PromptSection[]): void {
  const ids = new Set<string>();
  for (const section of sections) {
    if (!section.id.trim()) throw new Error('系统提示模块 ID 不能为空');
    if (ids.has(section.id)) throw new Error(`系统提示模块 ID 重复: ${section.id}`);
    if (!Number.isFinite(section.priority)) {
      throw new Error(`系统提示模块优先级无效: ${section.id}`);
    }
    if (!section.title.trim()) throw new Error(`系统提示模块标题不能为空: ${section.id}`);
    if (!section.content.trim()) throw new Error(`系统提示模块内容不能为空: ${section.id}`);
    ids.add(section.id);
  }
}

export function buildSystemPrompt(
  sections: readonly PromptSection[] = SYSTEM_PROMPT_SECTIONS,
  options: BuildSystemPromptOptions = {},
): string {
  const optionalSections: PromptSection[] = [];
  if (options.customInstructions?.trim()) {
    optionalSections.push({
      id: 'custom_instructions',
      priority: 95,
      title: '自定义指令',
      content: options.customInstructions,
    });
  }
  if (options.memorySection?.trim()) {
    optionalSections.push({
      id: 'memory',
      priority: 100,
      title: '长期记忆',
      content: options.memorySection,
    });
  }
  const complete = [...sections, ...optionalSections];
  validateSections(complete);
  return complete
    .sort((left, right) => right.priority - left.priority)
    .map(section => `## ${section.title.trim()}\n${section.content.trim()}`)
    .join('\n\n');
}
