import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  readClaudeProviderRows,
  readCurrentClaudeProviderId,
} from './database.js';

let DatabaseSync: typeof import('node:sqlite').DatabaseSync | undefined;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = undefined;
}

function createHome(t: test.TestContext): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-ccswitch-db-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function createDatabase(
  home: string,
  rows: Array<{
    id: string;
    name: string;
    settings: Record<string, unknown>;
    isCurrent?: boolean;
  }>,
): void {
  if (!DatabaseSync) throw new Error('node:sqlite 不可用');
  mkdirSync(path.join(home, '.cc-switch'), { recursive: true });
  const db = new DatabaseSync(path.join(home, '.cc-switch', 'cc-switch.db'));
  db.exec(`CREATE TABLE providers (
    id TEXT NOT NULL,
    app_type TEXT NOT NULL,
    name TEXT NOT NULL,
    settings_config TEXT NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT 0,
    sort_index INTEGER,
    created_at INTEGER
  )`);
  const insert = db.prepare(
    `INSERT INTO providers (id, app_type, name, settings_config, is_current, sort_index, created_at)
     VALUES (?, 'claude', ?, ?, ?, ?, ?)`,
  );
  rows.forEach((row, index) => {
    insert.run(
      row.id,
      row.name,
      JSON.stringify(row.settings),
      row.isCurrent ? 1 : 0,
      index,
      Date.now(),
    );
  });
  db.close();
}

test('读取 cc-switch 数据库的 Claude 供应商并展开 env 变量', t => {
  if (!DatabaseSync) return t.skip('node:sqlite 不可用');
  const home = createHome(t);
  createDatabase(home, [
    {
      id: 'p1',
      name: 'PackyCode-Deepseek',
      settings: {
        env: {
          ANTHROPIC_AUTH_TOKEN: '${TOKEN_VAR}',
          ANTHROPIC_BASE_URL: 'https://gateway.example',
          ANTHROPIC_MODEL: 'claude-sonnet',
        },
      },
      isCurrent: true,
    },
    {
      id: 'p2',
      name: 'DeepSeek',
      settings: {
        env: {
          ANTHROPIC_API_KEY: 'sk-secret',
          ANTHROPIC_MODEL: 'deepseek-chat',
        },
      },
    },
    {
      id: 'p3',
      name: 'Claude Official',
      settings: { env: {} },
    },
  ]);

  const result = readClaudeProviderRows(home, { TOKEN_VAR: 'expanded-token' });
  assert.equal(result.providers.length, 2);
  assert.equal(result.providers[0].name, 'PackyCode-Deepseek');
  assert.equal(result.providers[0].env.ANTHROPIC_AUTH_TOKEN, 'expanded-token');
  assert.equal(result.providers[0].isCurrent, true);
  assert.equal(result.providers[1].name, 'DeepSeek');
  assert.equal(result.providers[1].env.ANTHROPIC_API_KEY, 'sk-secret');
  assert.equal(result.diagnostics.length, 0);
});

test('数据库缺失时返回空列表并给出回退诊断', t => {
  if (!DatabaseSync) return t.skip('node:sqlite 不可用');
  const home = createHome(t);
  const result = readClaudeProviderRows(home, {});
  assert.deepEqual(result.providers, []);
  assert.match(result.diagnostics[0].message, /cc-switch\.db/);
});

test('读取当前激活的 Claude 供应商 ID', t => {
  const home = createHome(t);
  mkdirSync(path.join(home, '.cc-switch'), { recursive: true });
  writeFileSync(path.join(home, '.cc-switch', 'settings.json'), JSON.stringify({
    currentProviderClaude: 'active-id-123',
  }));
  assert.equal(readCurrentClaudeProviderId(home), 'active-id-123');
  assert.equal(readCurrentClaudeProviderId(path.join(home, 'missing')), undefined);
});
