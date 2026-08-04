import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { CcSwitchDiagnostic } from './types.js';

const require = createRequire(import.meta.url);

export interface CcSwitchClaudeRow {
  id: string;
  name: string;
  env: Record<string, string>;
  isCurrent: boolean;
}

export interface CcSwitchDatabaseResult {
  providers: CcSwitchClaudeRow[];
  diagnostics: CcSwitchDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expandEnv(value: string, environment: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([^}]+)\}/gu, (match, varName: string) => environment[varName] ?? match);
}

interface ClaudeProviderRow {
  id: string;
  name: string;
  settings_config: string;
  is_current: number;
}

function parseProviderRow(
  row: ClaudeProviderRow,
  environment: NodeJS.ProcessEnv,
): CcSwitchClaudeRow | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.settings_config);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.env)) return undefined;

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.env)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    env[key] = expandEnv(value.trim(), environment);
  }
  if (Object.keys(env).length === 0) return undefined;

  return {
    id: row.id,
    name: row.name,
    env,
    isCurrent: row.is_current === 1,
  };
}

/**
 * 读取 cc-switch 桌面版 SQLite 数据库中的 Claude 供应商列表。
 * 数据库缺失、Node 不支持 SQLite 或表结构异常时返回空列表，由调用方回退旧路径。
 */
export function readClaudeProviderRows(
  userHome: string,
  environment: NodeJS.ProcessEnv,
): CcSwitchDatabaseResult {
  const diagnostics: CcSwitchDiagnostic[] = [];
  const dbPath = path.join(userHome, '.cc-switch', 'cc-switch.db');

  let DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
    prepare(sql: string): { all(...params: unknown[]): unknown[] };
    close(): void;
  };
  try {
    const sqlite = require('node:sqlite') as { DatabaseSync: typeof DatabaseSync };
    DatabaseSync = sqlite.DatabaseSync;
  } catch {
    diagnostics.push({
      line: 'config',
      severity: 'info',
      message: '当前 Node 版本不支持 SQLite，回退读取 ~/.claude/settings.json',
    });
    return { providers: [], diagnostics };
  }

  let db: InstanceType<typeof DatabaseSync> | undefined;
  if (!existsSync(dbPath)) {
    diagnostics.push({
      line: 'config',
      severity: 'info',
      message: '未找到 ~/.cc-switch/cc-switch.db，回退读取 ~/.claude/settings.json',
    });
    return { providers: [], diagnostics };
  }
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    diagnostics.push({
      line: 'config',
      severity: 'warning',
      message: `读取 cc-switch 数据库失败，回退读取 ~/.claude/settings.json: ${(error as Error).message}`,
    });
    return { providers: [], diagnostics };
  }

  try {
    const rows = db.prepare(
      `SELECT id, name, settings_config, is_current
       FROM providers
       WHERE app_type = 'claude'
       ORDER BY sort_index IS NULL, sort_index, created_at, name`,
    ).all() as unknown as ClaudeProviderRow[];
    const providers: CcSwitchClaudeRow[] = [];
    for (const row of rows) {
      const parsed = parseProviderRow(row, environment);
      if (parsed) providers.push(parsed);
    }
    return { providers, diagnostics };
  } catch (error) {
    diagnostics.push({
      line: 'config',
      severity: 'warning',
      message: `读取 cc-switch providers 表失败，回退读取 ~/.claude/settings.json: ${(error as Error).message}`,
    });
    return { providers: [], diagnostics };
  } finally {
    try {
      db.close();
    } catch {
      // 关闭失败不影响回退逻辑。
    }
  }
}

/** 读取 cc-switch 桌面版当前激活的 Claude 供应商 ID。 */
export function readCurrentClaudeProviderId(userHome: string): string | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(userHome, '.cc-switch', 'settings.json'), 'utf8'),
    ) as unknown;
    if (!isRecord(parsed)) return undefined;
    const current = parsed.currentProviderClaude;
    return typeof current === 'string' && current.trim() ? current.trim() : undefined;
  } catch {
    return undefined;
  }
}
