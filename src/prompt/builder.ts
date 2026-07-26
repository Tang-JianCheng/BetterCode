import { SYSTEM_PROMPT_SECTIONS } from './sections.js';
import type { PromptSection } from './types.js';

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
): string {
  validateSections(sections);
  return [...sections]
    .sort((left, right) => right.priority - left.priority)
    .map(section => `## ${section.title.trim()}\n${section.content.trim()}`)
    .join('\n\n');
}
