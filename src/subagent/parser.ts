import { parse as parseYaml } from 'yaml';
import type { AgentDefinitionMetadata } from './types.js';

const AGENT_NAME = /^[a-z][a-z0-9-]*$/u;
const ALLOWED_FIELDS = new Set([
  'name',
  'description',
  'tools',
  'disallowed_tools',
  'background_tools',
  'model',
  'max_iterations',
  'permission_mode',
]);

export class AgentDefinitionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentDefinitionParseError';
  }
}

function splitDocument(content: string): { frontmatter: string; body: string } {
  const normalized = content.replace(/^\uFEFF/u, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u);
  if (!match) throw new AgentDefinitionParseError('Agent 文件必须以完整 YAML frontmatter 开头');
  return { frontmatter: match[1], body: match[2].trim() };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentDefinitionParseError('Agent frontmatter 必须是对象');
  }
  return value as Record<string, unknown>;
}

function toolList(value: unknown, field: string, required: boolean): string[] | undefined {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new AgentDefinitionParseError(`${field} 必须是非空工具名组成的字符串数组`);
  }
  const tools = value.map(item => (item as string).trim());
  if (new Set(tools).size !== tools.length) {
    throw new AgentDefinitionParseError(`${field} 不能包含重复工具`);
  }
  return tools;
}

export function parseAgentDefinitionDocument(content: string): {
  metadata: AgentDefinitionMetadata;
  body: string;
} {
  const { frontmatter, body } = splitDocument(content);
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch (error) {
    throw new AgentDefinitionParseError(
      `Agent frontmatter YAML 无效: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const value = record(parsed);
  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new AgentDefinitionParseError(`Agent frontmatter 包含未知字段: ${key}`);
    }
  }
  const name = typeof value.name === 'string' ? value.name.trim().toLowerCase() : '';
  if (!AGENT_NAME.test(name)) {
    throw new AgentDefinitionParseError(`Agent 名称无效: ${String(value.name ?? '')}`);
  }
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (!description || /[\r\n]/u.test(description)) {
    throw new AgentDefinitionParseError(`Agent ${name} 的说明必须是单行非空字符串`);
  }
  const tools = toolList(value.tools, `Agent ${name} 的 tools`, false);
  const disallowedTools = toolList(
    value.disallowed_tools ?? [],
    `Agent ${name} 的 disallowed_tools`,
    true,
  )!;
  const backgroundTools = toolList(
    value.background_tools,
    `Agent ${name} 的 background_tools`,
    true,
  )!;
  if (value.model !== 'inherit' && value.model !== 'haiku' &&
      value.model !== 'sonnet' && value.model !== 'opus') {
    throw new AgentDefinitionParseError(
      `Agent ${name} 的 model 必须是 inherit、haiku、sonnet 或 opus`,
    );
  }
  if (!Number.isInteger(value.max_iterations) ||
      (value.max_iterations as number) < 1 || (value.max_iterations as number) > 100) {
    throw new AgentDefinitionParseError(`Agent ${name} 的 max_iterations 必须是 1 到 100 的整数`);
  }
  if (value.permission_mode !== 'strict' && value.permission_mode !== 'default' &&
      value.permission_mode !== 'allow') {
    throw new AgentDefinitionParseError(
      `Agent ${name} 的 permission_mode 必须是 strict、default 或 allow`,
    );
  }
  if (!body) throw new AgentDefinitionParseError(`Agent ${name} 的正文不能为空`);
  return {
    metadata: {
      name,
      description,
      ...(tools === undefined ? {} : { tools }),
      disallowedTools,
      backgroundTools,
      model: value.model,
      maxIterations: value.max_iterations as number,
      permissionMode: value.permission_mode,
    },
    body,
  };
}

export function extractAgentDefinitionName(content: string, fallback: string): string {
  try {
    const { frontmatter } = splitDocument(content);
    const parsed = parseYaml(frontmatter);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const name = (parsed as Record<string, unknown>).name;
      if (typeof name === 'string' && AGENT_NAME.test(name.trim().toLowerCase())) {
        return name.trim().toLowerCase();
      }
    }
  } catch {}
  return fallback.trim().toLowerCase();
}
