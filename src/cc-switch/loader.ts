import type { AppConfig, ProviderConfig } from '../config/types.js';
import {
  buildClaudeProviderFromEnv,
  readClaudeProvider,
  type ClaudeReadOptions,
} from './claude.js';
import {
  readClaudeProviderRows,
  readCurrentClaudeProviderId,
  type CcSwitchDatabaseResult,
} from './database.js';
import type { CcSwitchDiagnostic, CcSwitchImportResult } from './types.js';

export interface LoadCcSwitchOptions {
  userHome?: string;
  environment?: NodeJS.ProcessEnv;
}

function uniqueName(baseName: string, id: string, used: Set<string>): string {
  if (!used.has(baseName)) return baseName;
  for (let length = 8; length <= id.length; length += 4) {
    const candidate = `${baseName} (${id.slice(0, length)})`;
    if (!used.has(candidate)) return candidate;
  }
  let suffix = 2;
  while (used.has(`${baseName} ${suffix}`)) suffix += 1;
  return `${baseName} ${suffix}`;
}

function importFromDatabase(
  appConfig: AppConfig,
  db: CcSwitchDatabaseResult,
  claudeOptions: ClaudeReadOptions,
  environment: NodeJS.ProcessEnv,
  userHome: string,
): CcSwitchImportResult & { importedCount: number } {
  const diagnostics = [...db.diagnostics];
  const usedNames = new Set(appConfig.providers.map(item => item.name));
  const activeId = readCurrentClaudeProviderId(userHome);
  const candidates: Array<{ provider: ProviderConfig; isActive: boolean }> = [];

  for (const row of db.providers) {
    const name = uniqueName(row.name, row.id, usedNames);
    const built = buildClaudeProviderFromEnv(
      row.env,
      environment,
      { ...claudeOptions, name: undefined },
      name,
    );
    if (!built.provider) {
      for (const diagnostic of built.diagnostics) {
        diagnostics.push({ ...diagnostic, message: `${row.name}: ${diagnostic.message}` });
      }
      continue;
    }
    usedNames.add(built.provider.name);
    candidates.push({
      provider: built.provider,
      isActive: row.id === activeId || row.isCurrent,
    });
  }

  if (!candidates.some(candidate => candidate.isActive) && activeId !== undefined) {
    const fallback = readClaudeProvider(userHome, environment, claudeOptions);
    diagnostics.push(...fallback.diagnostics);
    if (fallback.provider) {
      const name = uniqueName(fallback.provider.name, activeId, usedNames);
      const provider = { ...fallback.provider, name };
      usedNames.add(name);
      candidates.push({ provider, isActive: true });
    }
  }

  if (candidates.length === 0) return { diagnostics, importedCount: 0 };
  if (!candidates.some(candidate => candidate.isActive)) {
    diagnostics.push({
      line: 'config',
      severity: 'warning',
      message: '未找到 cc-switch 当前激活的 Claude 供应商，默认使用第一个导入项',
    });
  }

  const chosen = candidates.find(candidate => candidate.isActive) ?? candidates[0];
  for (const existing of appConfig.providers) existing.default = false;
  for (const candidate of candidates) {
    appConfig.providers.push({
      ...candidate.provider,
      default: candidate === chosen,
    });
  }
  return { provider: chosen.provider, diagnostics, importedCount: candidates.length };
}

/**
 * cc-switch 统一入口：配置关闭或不可用时返回空结果，
 * 优先读取 cc-switch SQLite 数据库的全部 Claude 供应商并合并，
 * 数据库不可用时回退读取 ~/.claude/settings.json 的单供应商路径。
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

  const environment = options.environment ?? process.env;
  const db = readClaudeProviderRows(options.userHome, environment);
  if (db.providers.length > 0) {
    const imported = importFromDatabase(
      appConfig,
      db,
      buildClaudeOptions(appConfig),
      environment,
      options.userHome,
    );
    if (imported.importedCount > 0) {
      return { provider: imported.provider, diagnostics: imported.diagnostics };
    }
  }

  // 数据库不可用或没有可用供应商时，沿用 settings.json 单供应商回退。
  const claudeOptions = buildClaudeOptions(appConfig);
  const result = readClaudeProvider(options.userHome, environment, claudeOptions);
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

function buildClaudeOptions(appConfig: AppConfig): ClaudeReadOptions {
  const claude = appConfig.cc_switch?.claude;
  return {
    ...(claude?.name ? { name: claude.name } : {}),
    ...(claude?.model ? { model: claude.model } : {}),
    ...(claude?.thinking !== undefined ? { thinking: claude.thinking } : {}),
    ...(claude?.context_window !== undefined ? { context_window: claude.context_window } : {}),
  };
}
