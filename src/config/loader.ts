import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { CcSwitchClaudeConfig, CcSwitchConfig } from '../cc-switch/types.js';
import type {
  AgentModelAliases,
  AppConfig,
  ProviderConfig,
  SubAgentConfig,
  TeamConfig,
  TeamCustomTerminalConfig,
  TeamProcessTemplateConfig,
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
const TEAM_FIELDS = new Set(['coordinator', 'mailbox', 'runtime', 'integration', 'custom_terminals']);
const TEAM_COORDINATOR_FIELDS = new Set(['enabled']);
const TEAM_MAILBOX_FIELDS = new Set(['lock_timeout_ms', 'retry_interval_ms', 'stale_lock_ms']);
const TEAM_RUNTIME_FIELDS = new Set([
  'heartbeat_interval_ms',
  'heartbeat_timeout_ms',
  'stop_timeout_ms',
  'inbox_poll_interval_ms',
]);
const TEAM_INTEGRATION_FIELDS = new Set(['timeout_ms', 'validation_commands']);
const TEAM_TERMINAL_FIELDS = new Set(['name', 'detect', 'spawn', 'wake', 'terminate']);
const TEAM_PROCESS_FIELDS = new Set(['command', 'args']);
const TEAM_TEMPLATE_PLACEHOLDERS = new Set(['worker_descriptor', 'cwd', 'pane_id']);
const CC_SWITCH_FIELDS = new Set(['enabled', 'claude']);
const CC_SWITCH_CLAUDE_FIELDS = new Set(['name', 'model', 'thinking', 'context_window']);

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

function assertKnownFields(raw: Record<string, unknown>, fields: ReadonlySet<string>, name: string): void {
  for (const key of Object.keys(raw)) {
    if (!fields.has(key)) throw new Error(`${name} 包含未知字段: ${key}`);
  }
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${field} 必须是布尔值`);
  return value;
}

function processTemplate(value: unknown, field: string): TeamProcessTemplateConfig {
  const raw = record(value, field);
  assertKnownFields(raw, TEAM_PROCESS_FIELDS, field);
  if (typeof raw.command !== 'string' || !raw.command.trim()) {
    throw new Error(`${field}.command 必须是非空字符串`);
  }
  if (raw.args !== undefined && (!Array.isArray(raw.args) || raw.args.some(item => typeof item !== 'string'))) {
    throw new Error(`${field}.args 必须是字符串数组`);
  }
  const args = (raw.args as string[] | undefined) ?? [];
  for (const [index, argument] of args.entries()) {
    for (const match of argument.matchAll(/\{([^{}]+)\}/gu)) {
      if (!TEAM_TEMPLATE_PLACEHOLDERS.has(match[1])) {
        throw new Error(`${field}.args[${index}] 包含未知占位符: ${match[1]}`);
      }
    }
  }
  return { command: raw.command.trim(), ...(args.length > 0 ? { args: [...args] } : {}) };
}

function parseTeamTerminals(value: unknown): TeamCustomTerminalConfig[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error('teams.custom_terminals 必须是最多 20 项的数组');
  }
  const names = new Set<string>();
  return value.map((item, index) => {
    const field = `teams.custom_terminals[${index}]`;
    const raw = record(item, field);
    assertKnownFields(raw, TEAM_TERMINAL_FIELDS, field);
    if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error(`${field}.name 必须是非空字符串`);
    const name = raw.name.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(name)) throw new Error(`${field}.name 格式无效`);
    if (names.has(name)) throw new Error(`teams.custom_terminals 名称重复: ${name}`);
    names.add(name);
    return {
      name,
      detect: processTemplate(raw.detect, `${field}.detect`),
      spawn: processTemplate(raw.spawn, `${field}.spawn`),
      wake: processTemplate(raw.wake, `${field}.wake`),
      ...(raw.terminate === undefined ? {} : {
        terminate: processTemplate(raw.terminate, `${field}.terminate`),
      }),
    };
  });
}

function parseTeams(value: unknown): TeamConfig | undefined {
  if (value === undefined) return undefined;
  const raw = record(value, 'teams');
  assertKnownFields(raw, TEAM_FIELDS, 'teams');

  let coordinator: TeamConfig['coordinator'];
  if (raw.coordinator !== undefined) {
    const item = record(raw.coordinator, 'teams.coordinator');
    assertKnownFields(item, TEAM_COORDINATOR_FIELDS, 'teams.coordinator');
    const enabled = optionalBoolean(item.enabled, 'teams.coordinator.enabled');
    coordinator = enabled === undefined ? {} : { enabled };
  }

  let mailbox: TeamConfig['mailbox'];
  if (raw.mailbox !== undefined) {
    const item = record(raw.mailbox, 'teams.mailbox');
    assertKnownFields(item, TEAM_MAILBOX_FIELDS, 'teams.mailbox');
    mailbox = {
      ...(item.lock_timeout_ms === undefined ? {} : {
        lock_timeout_ms: positiveInteger(item.lock_timeout_ms, 'teams.mailbox.lock_timeout_ms', 100, 60_000),
      }),
      ...(item.retry_interval_ms === undefined ? {} : {
        retry_interval_ms: positiveInteger(item.retry_interval_ms, 'teams.mailbox.retry_interval_ms', 10, 5_000),
      }),
      ...(item.stale_lock_ms === undefined ? {} : {
        stale_lock_ms: positiveInteger(item.stale_lock_ms, 'teams.mailbox.stale_lock_ms', 100, 600_000),
      }),
    };
    const retry = mailbox.retry_interval_ms ?? 50;
    const stale = mailbox.stale_lock_ms ?? 30_000;
    if (stale <= retry) throw new Error('teams.mailbox.stale_lock_ms 必须大于 retry_interval_ms');
  }

  let runtime: TeamConfig['runtime'];
  if (raw.runtime !== undefined) {
    const item = record(raw.runtime, 'teams.runtime');
    assertKnownFields(item, TEAM_RUNTIME_FIELDS, 'teams.runtime');
    runtime = {
      ...(item.heartbeat_interval_ms === undefined ? {} : {
        heartbeat_interval_ms: positiveInteger(item.heartbeat_interval_ms, 'teams.runtime.heartbeat_interval_ms', 250, 60_000),
      }),
      ...(item.heartbeat_timeout_ms === undefined ? {} : {
        heartbeat_timeout_ms: positiveInteger(item.heartbeat_timeout_ms, 'teams.runtime.heartbeat_timeout_ms', 500, 300_000),
      }),
      ...(item.stop_timeout_ms === undefined ? {} : {
        stop_timeout_ms: positiveInteger(item.stop_timeout_ms, 'teams.runtime.stop_timeout_ms', 1_000, 120_000),
      }),
      ...(item.inbox_poll_interval_ms === undefined ? {} : {
        inbox_poll_interval_ms: positiveInteger(item.inbox_poll_interval_ms, 'teams.runtime.inbox_poll_interval_ms', 250, 60_000),
      }),
    };
    const heartbeat = runtime.heartbeat_interval_ms ?? 2_000;
    const timeout = runtime.heartbeat_timeout_ms ?? 10_000;
    if (timeout <= heartbeat) throw new Error('teams.runtime.heartbeat_timeout_ms 必须大于 heartbeat_interval_ms');
  }

  let integration: TeamConfig['integration'];
  if (raw.integration !== undefined) {
    const item = record(raw.integration, 'teams.integration');
    assertKnownFields(item, TEAM_INTEGRATION_FIELDS, 'teams.integration');
    if (item.validation_commands !== undefined &&
        (!Array.isArray(item.validation_commands) ||
          item.validation_commands.some(command => typeof command !== 'string' || !command.trim()) ||
          item.validation_commands.length > 20)) {
      throw new Error('teams.integration.validation_commands 必须是最多 20 条非空命令的数组');
    }
    integration = {
      ...(item.timeout_ms === undefined ? {} : {
        timeout_ms: positiveInteger(item.timeout_ms, 'teams.integration.timeout_ms', 1_000, 3_600_000),
      }),
      ...(item.validation_commands === undefined ? {} : {
        validation_commands: (item.validation_commands as string[]).map(command => command.trim()),
      }),
    };
  }

  const customTerminals = parseTeamTerminals(raw.custom_terminals);
  return {
    ...(coordinator ? { coordinator } : {}),
    ...(mailbox ? { mailbox } : {}),
    ...(runtime ? { runtime } : {}),
    ...(integration ? { integration } : {}),
    ...(customTerminals ? { custom_terminals: customTerminals } : {}),
  };
}

function parseCcSwitchClaude(value: unknown): CcSwitchClaudeConfig | undefined {
  if (value === undefined) return undefined;
  const raw = record(value, 'cc_switch.claude');
  assertKnownFields(raw, CC_SWITCH_CLAUDE_FIELDS, 'cc_switch.claude');
  const result: CcSwitchClaudeConfig = {};
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || !raw.name.trim()) {
      throw new Error('cc_switch.claude.name 必须是非空字符串');
    }
    result.name = raw.name.trim();
  }
  if (raw.model !== undefined) {
    if (typeof raw.model !== 'string' || !raw.model.trim()) {
      throw new Error('cc_switch.claude.model 必须是非空字符串');
    }
    result.model = raw.model.trim();
  }
  const thinking = optionalBoolean(raw.thinking, 'cc_switch.claude.thinking');
  if (thinking !== undefined) result.thinking = thinking;
  if (raw.context_window !== undefined) {
    result.context_window = positiveInteger(
      raw.context_window,
      'cc_switch.claude.context_window',
      1,
      10_000_000,
    );
  }
  return result;
}

function parseCcSwitch(value: unknown): CcSwitchConfig | undefined {
  if (value === undefined) return undefined;
  const raw = record(value, 'cc_switch');
  assertKnownFields(raw, CC_SWITCH_FIELDS, 'cc_switch');
  const claude = parseCcSwitchClaude(raw.claude);
  return {
    enabled: optionalBoolean(raw.enabled, 'cc_switch.enabled') ?? true,
    ...(claude ? { claude } : {}),
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
  const teams = parseTeams(obj.teams);
  const ccSwitch = parseCcSwitch(obj.cc_switch);
  if (agentModels) config.agent_models = agentModels;
  if (subagents) config.subagents = subagents;
  if (worktrees) config.worktrees = worktrees;
  if (teams) config.teams = teams;
  if (ccSwitch) config.cc_switch = ccSwitch;

  return config;
}
