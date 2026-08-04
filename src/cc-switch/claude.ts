import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProviderConfig } from '../config/types.js';
import type { CcSwitchDiagnostic } from './types.js';

export interface ClaudeReadOptions {
  name?: string;
  model?: string;
  thinking?: boolean;
  context_window?: number;
}

export interface ClaudeReadResult {
  provider?: ProviderConfig;
  diagnostics: CcSwitchDiagnostic[];
}

const DEFAULT_CLAUDE_NAME = 'cc-switch.claude';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expandEnv(value: string, environment: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([^}]+)\}/gu, (match, varName: string) => environment[varName] ?? match);
}

/**
 * 读取 cc-switch 桌面版维护的 ~/.claude/settings.json env 块，
 * 生成 Anthropic Provider。任何失败都只产生诊断，不抛异常。
 */
export function readClaudeProvider(
  userHome: string,
  environment: NodeJS.ProcessEnv,
  options: ClaudeReadOptions = {},
): ClaudeReadResult {
  const diagnostics: CcSwitchDiagnostic[] = [];
  const settingsPath = path.join(userHome, '.claude', 'settings.json');

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      diagnostics.push({
        line: 'claude',
        severity: 'info',
        message: '未找到 ~/.claude/settings.json，跳过 cc-switch 导入',
      });
    } else {
      diagnostics.push({
        line: 'claude',
        severity: 'warning',
        message: `读取 ~/.claude/settings.json 失败: ${err.message ?? '未知错误'}，已回退原配置`,
      });
    }
    return { diagnostics };
  }

  if (!isRecord(parsed) || !isRecord(parsed.env)) {
    diagnostics.push({
      line: 'claude',
      severity: 'warning',
      message: '~/.claude/settings.json 缺少 env 对象，跳过 cc-switch 导入',
    });
    return { diagnostics };
  }

  const rawEnv = parsed.env;
  const readString = (name: string): string | undefined => {
    const value = rawEnv[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value.trim()) {
      diagnostics.push({
        line: 'claude',
        severity: 'warning',
        message: `settings.json 的 ${name} 不是非空字符串，已忽略`,
      });
      return undefined;
    }
    return expandEnv(value.trim(), environment);
  };

  const baseUrl = readString('ANTHROPIC_BASE_URL') ?? DEFAULT_ANTHROPIC_BASE_URL;
  const apiKey = readString('ANTHROPIC_API_KEY');
  const authToken = readString('ANTHROPIC_AUTH_TOKEN');
  const settingsModel = readString('ANTHROPIC_MODEL');

  if (!apiKey && !authToken) {
    diagnostics.push({
      line: 'claude',
      severity: 'warning',
      message: '~/.claude/settings.json 未配置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN，跳过 cc-switch 导入',
    });
    return { diagnostics };
  }

  const model = settingsModel ?? options.model;
  if (!model) {
    diagnostics.push({
      line: 'claude',
      severity: 'warning',
      message: '未找到 ANTHROPIC_MODEL 且 config.yaml 未指定 cc_switch.claude.model，跳过 cc-switch 导入',
    });
    return { diagnostics };
  }

  const provider: ProviderConfig = {
    name: options.name?.trim() || DEFAULT_CLAUDE_NAME,
    protocol: 'anthropic',
    model,
    base_url: baseUrl,
    api_key: authToken ?? apiKey ?? '',
    authMode: authToken ? 'bearer' : 'api-key',
    thinking: options.thinking ?? false,
    ...(options.context_window === undefined ? {} : { context_window: options.context_window }),
  };
  return { provider, diagnostics };
}
