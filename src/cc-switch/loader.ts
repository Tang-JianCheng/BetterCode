import type { AppConfig } from '../config/types.js';
import { readClaudeProvider, type ClaudeReadOptions } from './claude.js';
import type { CcSwitchDiagnostic, CcSwitchImportResult } from './types.js';

export interface LoadCcSwitchOptions {
  userHome?: string;
  environment?: NodeJS.ProcessEnv;
}

/**
 * cc-switch 统一入口：配置关闭或不可用时返回空结果，
 * 导入成功后合并进 appConfig.providers 并接管默认供应商。
 */
export function loadCcSwitchProviders(
  appConfig: AppConfig,
  options: LoadCcSwitchOptions = {},
): CcSwitchImportResult {
  if (!appConfig.cc_switch?.enabled) return { diagnostics: [] };

  const diagnostics: CcSwitchDiagnostic[] = [];
  if (!options.userHome) {
    diagnostics.push({
      line: 'config',
      severity: 'warning',
      message: '未提供用户目录，跳过 cc-switch 导入',
    });
    return { diagnostics };
  }

  const claude = appConfig.cc_switch.claude;
  const claudeOptions: ClaudeReadOptions = {
    ...(claude?.name ? { name: claude.name } : {}),
    ...(claude?.model ? { model: claude.model } : {}),
    ...(claude?.thinking !== undefined ? { thinking: claude.thinking } : {}),
    ...(claude?.context_window !== undefined ? { context_window: claude.context_window } : {}),
  };
  const result = readClaudeProvider(options.userHome, options.environment ?? process.env, claudeOptions);
  diagnostics.push(...result.diagnostics);
  if (!result.provider) return { diagnostics };

  if (appConfig.providers.some(item => item.name === result.provider?.name)) {
    diagnostics.push({
      line: 'config',
      severity: 'warning',
      message: `cc-switch 导入的供应商名称 "${result.provider.name}" 与 config.yaml 冲突，已跳过导入`,
    });
    return { diagnostics };
  }

  for (const existing of appConfig.providers) existing.default = false;
  result.provider.default = true;
  appConfig.providers.push(result.provider);
  return { provider: result.provider, diagnostics };
}
