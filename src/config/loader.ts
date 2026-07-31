import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type {
  AgentModelAliases,
  AppConfig,
  ProviderConfig,
  SubAgentConfig,
  WorktreeConfig,
  WorktreeCopyRuleConfig,
} from './types.js';

const AGENT_MODEL_TIERS = new Set(['haiku', 'sonnet', 'opus']);
const SUBAGENT_FIELDS = new Set([
  'foreground_timeout_ms',
  'fork_max_iterations',
  'retained_tasks',
  'denied_tools',
]);
const WORKTREE_FIELDS = new Set([
  'retention_days',
  'cleanup_interval_ms',
  'copy_files',
  'ignored_files',
  'symlinks',
]);
const WORKTREE_RULE_FIELDS = new Set(['source', 'target', 'required']);

/**
 * 校验单个 provider 配置，不合法时抛 Error。
 */
function validateProvider(p: ProviderConfig, index: number): void {
  const prefix = `providers[${index}]`;

  if (!p.name || typeof p.name !== 'string') {
    throw new Error(`${prefix}: name 字段必须是非空字符串`);
  }
  if (p.protocol !== 'anthropic' && p.protocol !== 'openai') {
    throw new Error(`${prefix} (${p.name}): protocol 必须是 "anthropic" 或 "openai"，当前值: "${p.protocol}"`);
  }
  if (!p.model || typeof p.model !== 'string') {
    throw new Error(`${prefix} (${p.name}): model 字段必须是非空字符串`);
  }
  if (p.context_window !== undefined &&
      (!Number.isInteger(p.context_window) || p.context_window <= 0)) {
    throw new Error(`${prefix} (${p.name}): context_window 必须是正整数`);
  }
  if (!p.base_url || typeof p.base_url !== 'string') {
    throw new Error(`${prefix} (${p.name}): base_url 字段必须是非空字符串`);
  }
  if (!p.api_key || typeof p.api_key !== 'string') {
    throw new Error(`${prefix} (${p.name}): api_key 字段必须是非空字符串`);
  }
}

/**
 * 替换字符串中的 ${VAR} 环境变量占位。
 * 未设置的环境变量保留原占位符，不抛异常——实际使用时 API 会返回认证错误。
 */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      console.warn(`⚠ 环境变量 ${varName} 未设置，将使用原始配置值`);
      return match;
    }
    return envValue;
  });
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} 必须是 ${minimum} 到 ${maximum} 的整数`);
  }
  return value as number;
}

function parseAgentModels(value: unknown, providerNames: ReadonlySet<string>): AgentModelAliases | undefined {
  if (value === undefined) return undefined;
  const raw = record(value, 'agent_models');
  const aliases: AgentModelAliases = {};
  for (const [tier, providerName] of Object.entries(raw)) {
    if (!AGENT_MODEL_TIERS.has(tier)) throw new Error(`agent_models 包含未知档位: ${tier}`);
    if (typeof providerName !== 'string' || !providerName.trim()) {
      throw new Error(`agent_models.${tier} 必须是非空 Provider 名称`);
    }
    const normalized = providerName.trim();
    if (!providerNames.has(normalized)) {
      throw new Error(`agent_models.${tier} 指向不存在 Provider: ${normalized}`);
    }
    aliases[tier as keyof AgentModelAliases] = normalized;
  }
  return aliases;
}

function parseSubAgents(value: unknown): SubAgentConfig | undefined {
  if (value === undefined) return undefined;
  const raw = record(value, 'subagents');
  for (const key of Object.keys(raw)) {
    if (!SUBAGENT_FIELDS.has(key)) throw new Error(`subagents 包含未知字段: ${key}`);
  }
  let deniedTools: string[] | undefined;
  if (raw.denied_tools !== undefined) {
    if (!Array.isArray(raw.denied_tools) ||
        raw.denied_tools.some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error('subagents.denied_tools 必须是非空字符串数组');
    }
    deniedTools = [...new Set(raw.denied_tools.map(item => (item as string).trim()))];
  }
  return {
    ...(raw.foreground_timeout_ms === undefined ? {} : {
      foreground_timeout_ms: positiveInteger(
        raw.foreground_timeout_ms,
        'subagents.foreground_timeout_ms',
        1_000,
        3_600_000,
      ),
    }),
    ...(raw.fork_max_iterations === undefined ? {} : {
      fork_max_iterations: positiveInteger(
        raw.fork_max_iterations,
        'subagents.fork_max_iterations',
        1,
        100,
      ),
    }),
    ...(raw.retained_tasks === undefined ? {} : {
      retained_tasks: positiveInteger(raw.retained_tasks, 'subagents.retained_tasks', 1, 10_000),
    }),
    ...(deniedTools ? { denied_tools: deniedTools } : {}),
  };
}

function worktreePath(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 必须是非空相对路径`);
  const normalized = value.trim();
  if (normalized.startsWith('/') || normalized.startsWith('\\') || /^[A-Za-z]:/u.test(normalized) || normalized.includes('\\')) {
    throw new Error(`${field} 必须使用项目内正斜杠相对路径`);
  }
  if (normalized.split('/').some(part => part === '..')) throw new Error(`${field} 不能包含 .. 路径段`);
  return normalized;
}

function parseWorktreeRules(value: unknown, field: string): WorktreeCopyRuleConfig[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${field} 必须是最多 100 条规则的数组`);
  return value.map((item, index) => {
    const raw = record(item, `${field}[${index}]`);
    for (const key of Object.keys(raw)) {
      if (!WORKTREE_RULE_FIELDS.has(key)) throw new Error(`${field}[${index}] 包含未知字段: ${key}`);
    }
    if (raw.required !== undefined && typeof raw.required !== 'boolean') {
      throw new Error(`${field}[${index}].required 必须是布尔值`);
    }
    return {
      source: worktreePath(raw.source, `${field}[${index}].source`),
      ...(raw.target === undefined ? {} : { target: worktreePath(raw.target, `${field}[${index}].target`) }),
      ...(raw.required === undefined ? {} : { required: raw.required }),
    };
  });
}

function parseWorktrees(value: unknown): WorktreeConfig | undefined {
  if (value === undefined) return undefined;
  const raw = record(value, 'worktrees');
  for (const key of Object.keys(raw)) {
    if (!WORKTREE_FIELDS.has(key)) throw new Error(`worktrees 包含未知字段: ${key}`);
  }
  const copyFiles = parseWorktreeRules(raw.copy_files, 'worktrees.copy_files');
  const ignoredFiles = parseWorktreeRules(raw.ignored_files, 'worktrees.ignored_files');
  const symlinks = parseWorktreeRules(raw.symlinks, 'worktrees.symlinks');
  return {
    ...(raw.retention_days === undefined ? {} : {
      retention_days: positiveInteger(raw.retention_days, 'worktrees.retention_days', 1, 3650),
    }),
    ...(raw.cleanup_interval_ms === undefined ? {} : {
      cleanup_interval_ms: positiveInteger(
        raw.cleanup_interval_ms,
        'worktrees.cleanup_interval_ms',
        60_000,
        86_400_000,
      ),
    }),
    ...(copyFiles ? { copy_files: copyFiles } : {}),
    ...(ignoredFiles ? { ignored_files: ignoredFiles } : {}),
    ...(symlinks ? { symlinks } : {}),
  };
}

/**
 * 读取并解析 YAML 配置文件。
 * @param path 配置文件路径，默认 ./config.yaml
 * @returns 校验并处理好环境变量后的 AppConfig
 */
export function loadConfig(path: string = './config.yaml'): AppConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    throw new Error(`无法读取配置文件: ${path}，请确认文件存在`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    throw new Error(`配置文件 YAML 格式错误: ${(e as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('配置文件内容为空或格式不正确');
  }

  const obj = parsed as Record<string, unknown>;
  const providers = obj.providers;

  if (!Array.isArray(providers)) {
    throw new Error('配置文件中缺少 providers 字段或格式不正确（应为数组）');
  }

  if (providers.length === 0) {
    throw new Error('providers 数组不能为空，请至少配置一个供应商');
  }

  // 校验 name 唯一性
  const names = new Set<string>();
  const config: AppConfig = { providers: [] };

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i] as ProviderConfig;
    validateProvider(p, i);

    if (names.has(p.name)) {
      throw new Error(`providers[${i}]: name "${p.name}" 重复，供应商名称必须唯一`);
    }
    names.add(p.name);

    // 替换 api_key 中的环境变量
    p.api_key = resolveEnvVars(p.api_key);

    // 设置默认值
    p.thinking = p.thinking ?? false;
    p.default = p.default ?? false;

    config.providers.push(p);
  }

  // 校验 default 唯一性（排除 default:false 的项）
  const defaults = config.providers.filter(p => p.default);
  if (defaults.length > 1) {
    throw new Error(`有 ${defaults.length} 个供应商标记为 default，只能有一个默认供应商`);
  }

  const providerNames = new Set(config.providers.map(provider => provider.name));
  const agentModels = parseAgentModels(obj.agent_models, providerNames);
  const subagents = parseSubAgents(obj.subagents);
  const worktrees = parseWorktrees(obj.worktrees);
  if (agentModels) config.agent_models = agentModels;
  if (subagents) config.subagents = subagents;
  if (worktrees) config.worktrees = worktrees;

  return config;
}
