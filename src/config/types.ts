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
  /** 是否启用 extended thinking，默认 false（仅 Anthropic 生效） */
  thinking?: boolean;
  /** 是否为默认供应商，默认 false */
  default?: boolean;
}

/** config.yaml 顶层结构 */
export interface AppConfig {
  providers: ProviderConfig[];
}
