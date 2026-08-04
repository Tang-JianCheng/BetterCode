import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ClaudeModelTier, ModelTierConfig } from '../config/types.js';
import type { CcSwitchDiagnostic } from './types.js';

const require = createRequire(import.meta.url);

export interface CcSwitchClaudeRow {
  id: string;
  name: string;
  env: Record<string, string>;
  isCurrent: boolean;
  tiers: Partial<Record<ClaudeModelTier, ModelTierConfig>>;
  activeTier?: ClaudeModelTier;
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

const TIER_ENV_KEYS: Record<ClaudeModelTier, { model: string; name: string }> = {
  sonnet: { model: 'ANTHROPIC_DEFAULT_SONNET_MODEL', name: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME' },
  opus: { model: 'ANTHROPIC_DEFAULT_OPUS_MODEL', name: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME' },
  haiku: { model: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME' },
  fable: { model: 'ANTHROPIC_DEFAULT_FABLE_MODEL', name: 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME' },
};

const CLAUDE_TIERS = new Set<ClaudeModelTier>(['sonnet', 'opus', 'haiku', 'fable']);

function parseContextWindow(modelValue: string): number | undefined {
  const match = modelValue.match(/\[(\d+)([KM])\]/iu);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2].toUpperCase();
  return unit === 'M' ? value * 1_000_000 : value * 1_000;
}

function cleanModelName(modelValue: string, nameValue: string | undefined): string {
  if (nameValue && nameValue.trim()) return nameValue.trim();
  return modelValue.replace(/\[[^\]]+\]$/u, '');
}

function parseTiers(parsedEnv: Record<string, unknown>): Partial<Record<ClaudeModelTier, ModelTierConfig>> {
  const tiers: Partial<Record<ClaudeModelTier, ModelTierConfig>> = {};
  for (const tier of CLAUDE_TIERS) {
    const keys = TIER_ENV_KEYS[tier];
    const rawModel = parsedEnv[keys.model];
    if (typeof rawModel !== 'string' || !rawModel.trim()) continue;
    const rawName = parsedEnv[keys.name];
    const name = typeof rawName === 'string' ? rawName : undefined;
    const model = cleanModelName(rawModel.trim(), name);
    if (!model) continue;
    const contextWindow = parseContextWindow(rawModel);
    tiers[tier] = contextWindow === undefined
      ? { model }
      : { model, context_window: contextWindow };
  }
  return tiers;
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

  let activeTier: ClaudeModelTier | undefined;
  if (typeof parsed.model === 'string' && CLAUDE_TIERS.has(parsed.model as ClaudeModelTier)) {
    activeTier = parsed.model as ClaudeModelTier;
  }

  return {
    id: row.id,
    name: row.name,
    env,
    isCurrent: row.is_current === 1,
    tiers: parseTiers(parsed.env),
    ...(activeTier ? { activeTier } : {}),
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
