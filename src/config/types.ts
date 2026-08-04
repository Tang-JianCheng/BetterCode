import type { CcSwitchConfig } from '../cc-switch/types.js';

/** 单个供应商配置，与 config.yaml 中每个 provider 条目一一对应 */
export interface ProviderConfig {
  /** 供应商标识名，方便区分多个配置 */
  name: string;
  /** 协议类型：anthropic 或 openai */
  protocol: 'anthropic' | 'openai';
  /** 指定模型，如 claude-sonnet-5-20251001 / gpt-4o */
  model: string;
  /** 模型上下文窗口 Token 数，缺失时使用 128K */
  context_window?: number;
  /** API 请求地址 */
  base_url: string;
  /** 认证密钥，支持 ${ENV_VAR} 环境变量占位 */
  api_key: string;
  /** Anthropic 认证方式：x-api-key 或 Bearer token，默认 api-key */
  authMode?: 'api-key' | 'bearer';
  /** 是否启用 extended thinking，默认 false（仅 Anthropic 生效） */
  thinking?: boolean;
  /** 是否为默认供应商，默认 false */
  default?: boolean;
  /** cc-switch Claude 线的档位模型映射（Sonnet/Opus/Haiku/Fable）。 */
  model_tiers?: Partial<Record<ClaudeModelTier, ModelTierConfig>>;
  /** cc-switch 供应商当前激活的档位，缺省按 sonnet 处理。 */
  active_tier?: ClaudeModelTier;
}

export type AgentModelTier = 'haiku' | 'sonnet' | 'opus';

/** cc-switch Claude 线支持的档位模型名。 */
export type ClaudeModelTier = 'sonnet' | 'opus' | 'haiku' | 'fable';

/** 单个 Claude 档位对应的模型与上下文窗口。 */
export interface ModelTierConfig {
  model: string;
  context_window?: number;
}

export interface AgentModelAliases {
  haiku?: string;
  sonnet?: string;
  opus?: string;
}

export interface SubAgentConfig {
  foreground_timeout_ms?: number;
  fork_max_iterations?: number;
  retained_tasks?: number;
  denied_tools?: string[];
}

export interface WorktreeCopyRuleConfig {
  source: string;
  target?: string;
  required?: boolean;
}

export interface WorktreeSymlinkRuleConfig {
  source: string;
  target?: string;
  required?: boolean;
}

export interface WorktreeConfig {
  retention_days?: number;
  cleanup_interval_ms?: number;
  copy_files?: WorktreeCopyRuleConfig[];
  ignored_files?: WorktreeCopyRuleConfig[];
  symlinks?: WorktreeSymlinkRuleConfig[];
}

export interface TeamProcessTemplateConfig {
  command: string;
  args?: string[];
}

export interface TeamCustomTerminalConfig {
  name: string;
  detect: TeamProcessTemplateConfig;
  spawn: TeamProcessTemplateConfig;
  wake: TeamProcessTemplateConfig;
  terminate?: TeamProcessTemplateConfig;
}

export interface TeamConfig {
  coordinator?: {
    enabled?: boolean;
  };
  mailbox?: {
    lock_timeout_ms?: number;
    retry_interval_ms?: number;
    stale_lock_ms?: number;
  };
  runtime?: {
    heartbeat_interval_ms?: number;
    heartbeat_timeout_ms?: number;
    stop_timeout_ms?: number;
    inbox_poll_interval_ms?: number;
  };
  integration?: {
    timeout_ms?: number;
    validation_commands?: string[];
  };
  custom_terminals?: TeamCustomTerminalConfig[];
}

/** config.yaml 顶层结构 */
export interface AppConfig {
  providers: ProviderConfig[];
  cc_switch?: CcSwitchConfig;
  agent_models?: AgentModelAliases;
  subagents?: SubAgentConfig;
  worktrees?: WorktreeConfig;
  teams?: TeamConfig;
}
