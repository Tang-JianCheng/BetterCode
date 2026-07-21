import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { AppConfig, ProviderConfig } from './types.js';

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

  return config;
}
