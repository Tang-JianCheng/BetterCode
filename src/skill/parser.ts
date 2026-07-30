import { parse as parseYaml } from 'yaml';
import type { SkillMetadata } from './types.js';

const SKILL_NAME = /^[a-z][a-z0-9-]*$/u;
const ALLOWED_FIELDS = new Set(['name', 'description', 'tools', 'mode', 'history', 'model']);

export interface ParsedSkillDocument {
  metadata: SkillMetadata;
  body: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function splitDocument(content: string): { frontmatter: string; body: string } {
  const normalized = content.replace(/^\uFEFF/u, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u);
  if (!match) throw new Error('Skill 文件必须以完整 YAML frontmatter 开头');
  return { frontmatter: match[1], body: match[2].trim() };
}

export function parseSkillDocument(content: string): ParsedSkillDocument {
  const { frontmatter, body } = splitDocument(content);
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch (error) {
    throw new Error(`Skill frontmatter YAML 无效: ${error instanceof Error ? error.message : String(error)}`);
  }
  const value = record(parsed, 'Skill frontmatter');
  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`Skill frontmatter 包含未知字段: ${key}`);
  }

  const name = typeof value.name === 'string' ? value.name.trim().toLowerCase() : '';
  if (!SKILL_NAME.test(name)) throw new Error(`Skill 名称无效: ${String(value.name ?? '')}`);
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (!description || /[\r\n]/u.test(description)) throw new Error(`Skill ${name} 的说明必须是单行非空字符串`);
  if (!Array.isArray(value.tools) || value.tools.some(tool => typeof tool !== 'string')) {
    throw new Error(`Skill ${name} 的 tools 必须是字符串数组`);
  }
  const tools = value.tools.map(tool => (tool as string).trim()).filter(Boolean);
  if (tools.length !== value.tools.length || new Set(tools).size !== tools.length) {
    throw new Error(`Skill ${name} 的 tools 不能为空或重复`);
  }
  if (value.mode !== 'shared' && value.mode !== 'isolated') {
    throw new Error(`Skill ${name} 的 mode 必须是 shared 或 isolated`);
  }
  if (!body) throw new Error(`Skill ${name} 的正文不能为空`);

  if (value.mode === 'shared') {
    if (value.history !== undefined) throw new Error(`共享 Skill ${name} 不能配置 history`);
    if (value.model !== undefined) throw new Error(`共享 Skill ${name} 不能配置 model`);
    return { metadata: { name, description, tools, mode: 'shared', history: 0 }, body };
  }

  const history = value.history ?? 0;
  if (!Number.isInteger(history) || (history as number) < 0) {
    throw new Error(`Skill ${name} 的 history 必须是非负整数`);
  }
  const model = value.model === undefined
    ? undefined
    : typeof value.model === 'string' && value.model.trim()
      ? value.model.trim()
      : (() => { throw new Error(`Skill ${name} 的 model 必须是非空字符串`); })();
  return {
    metadata: {
      name,
      description,
      tools,
      mode: 'isolated',
      history: history as number,
      ...(model ? { model } : {}),
    },
    body,
  };
}

export function extractSkillName(content: string, fallback: string): string {
  try {
    const { frontmatter } = splitDocument(content);
    const parsed = parseYaml(frontmatter);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const name = (parsed as Record<string, unknown>).name;
      if (typeof name === 'string' && SKILL_NAME.test(name.trim().toLowerCase())) {
        return name.trim().toLowerCase();
      }
    }
  } catch {}
  return fallback.trim().toLowerCase();
}

export function renderSkillBody(body: string, args: string): string {
  return body.replaceAll('{{args}}', args);
}
