import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AppConfig } from '../config/types.js';
import { loadCcSwitchProviders } from './loader.js';

let DatabaseSync: typeof import('node:sqlite').DatabaseSync | undefined;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = undefined;
}

function baseConfig(): AppConfig {
  return {
    providers: [{
      name: 'deepseek-v4',
      protocol: 'openai',
      model: 'deepseek-v4-flash',
      base_url: 'https://api.deepseek.com',
      api_key: 'sk-test',
      default: true,
    }],
  };
}

function withHome(t: test.TestContext, settings?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-ccswitch-loader-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (settings !== undefined) {
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    writeFileSync(path.join(root, '.claude', 'settings.json'), settings);
  }
  return root;
}

function createCcSwitchDatabase(
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

test('cc_switch 未配置或关闭时返回空结果', () => {
  const without = baseConfig();
  assert.deepEqual(loadCcSwitchProviders(without), { diagnostics: [] });
  const disabled = baseConfig();
  disabled.cc_switch = { enabled: false };
  assert.deepEqual(loadCcSwitchProviders(disabled), { diagnostics: [] });
});

test('导入成功时接管默认供应商', t => {
  const config = baseConfig();
  config.cc_switch = { enabled: true };
  const home = withHome(t, JSON.stringify({
    env: { ANTHROPIC_API_KEY: 'sk-cc', ANTHROPIC_MODEL: 'claude-sonnet' },
  }));
  const result = loadCcSwitchProviders(config, { userHome: home });
  assert.equal(result.provider?.name, 'cc-switch.claude');
  assert.equal(result.diagnostics.length, 0);
  assert.equal(config.providers.length, 2);
  assert.equal(config.providers[0].default, false);
  assert.equal(config.providers[1].default, true);
});

test('数据库存在时导入全部 Claude 供应商并标记当前激活项', t => {
  if (!DatabaseSync) return t.skip('node:sqlite 不可用');
  const config = baseConfig();
  config.cc_switch = { enabled: true };
  const home = withHome(t);
  createCcSwitchDatabase(home, [
    {
      id: 'p1-11111111',
      name: 'DeepSeek',
      settings: {
        env: { ANTHROPIC_API_KEY: 'sk-a', ANTHROPIC_MODEL: 'deepseek-chat' },
      },
    },
    {
      id: 'p2-22222222',
      name: 'PackyCode-Deepseek',
      settings: {
        env: {
          ANTHROPIC_AUTH_TOKEN: 'tok-b',
          ANTHROPIC_BASE_URL: 'https://gateway.example',
          ANTHROPIC_MODEL: 'claude-sonnet',
        },
      },
      isCurrent: true,
    },
  ]);

  const result = loadCcSwitchProviders(config, { userHome: home });
  assert.equal(config.providers.length, 3);
  assert.equal(config.providers[0].default, false);
  assert.equal(config.providers[1].name, 'DeepSeek');
  assert.equal(config.providers[1].default, false);
  assert.equal(config.providers[2].name, 'PackyCode-Deepseek');
  assert.equal(config.providers[2].default, true);
  assert.equal(result.provider?.name, 'PackyCode-Deepseek');
  assert.equal(result.diagnostics.length, 0);
});

test('数据库导入同名供应商自动去重并保持唯一名称', t => {
  if (!DatabaseSync) return t.skip('node:sqlite 不可用');
  const config = baseConfig();
  config.cc_switch = { enabled: true };
  const home = withHome(t);
  createCcSwitchDatabase(home, [
    {
      id: 'aaaaaaaa-1111-4b8f-8f43-8e6f98cffaf3',
      name: 'DeepSeek',
      settings: {
        env: { ANTHROPIC_API_KEY: 'sk-a', ANTHROPIC_MODEL: 'deepseek-chat' },
      },
      isCurrent: true,
    },
    {
      id: 'bbbbbbbb-2222-4b8f-8f43-8e6f98cffaf3',
      name: 'DeepSeek',
      settings: {
        env: { ANTHROPIC_API_KEY: 'sk-b', ANTHROPIC_MODEL: 'deepseek-v3' },
      },
    },
  ]);

  const result = loadCcSwitchProviders(config, { userHome: home });
  const names = config.providers.slice(1).map(item => item.name);
  assert.deepEqual(names, ['DeepSeek', 'DeepSeek (bbbbbbbb)']);
  assert.equal(result.provider?.name, 'DeepSeek');
  assert.equal(config.providers[2].default, false);
});

test('命名冲突时诊断并跳过导入', t => {
  const config = baseConfig();
  config.providers.push({
    name: 'cc-switch.claude',
    protocol: 'anthropic',
    model: 'existing',
    base_url: 'https://example.test',
    api_key: 'sk-existing',
  });
  config.cc_switch = { enabled: true };
  const home = withHome(t, JSON.stringify({
    env: { ANTHROPIC_API_KEY: 'sk-cc', ANTHROPIC_MODEL: 'claude-sonnet' },
  }));
  const result = loadCcSwitchProviders(config, { userHome: home });
  assert.equal(result.provider, undefined);
  assert.match(result.diagnostics[0].message, /冲突/);
  assert.equal(config.providers.length, 2);
});

test('settings.json 缺失时诊断并保留原默认', t => {
  const config = baseConfig();
  config.cc_switch = { enabled: true };
  const home = withHome(t);
  const result = loadCcSwitchProviders(config, { userHome: home });
  assert.equal(result.provider, undefined);
  assert.equal(result.diagnostics[0].severity, 'info');
  assert.equal(config.providers[0].default, true);
});

test('key 或 model 缺失时诊断并跳过', t => {
  const missingKey = baseConfig();
  missingKey.cc_switch = { enabled: true };
  const home = withHome(t, JSON.stringify({ env: { ANTHROPIC_MODEL: 'm' } }));
  const keyResult = loadCcSwitchProviders(missingKey, { userHome: home });
  assert.equal(keyResult.provider, undefined);
  assert.equal(keyResult.diagnostics[0].severity, 'warning');

  const missingModel = baseConfig();
  missingModel.cc_switch = { enabled: true };
  const home2 = withHome(t, JSON.stringify({ env: { ANTHROPIC_API_KEY: 'k' } }));
  const modelResult = loadCcSwitchProviders(missingModel, { userHome: home2 });
  assert.equal(modelResult.provider, undefined);
  assert.equal(modelResult.diagnostics[0].severity, 'warning');
});

test('未提供用户目录时诊断并跳过', () => {
  const config = baseConfig();
  config.cc_switch = { enabled: true };
  const result = loadCcSwitchProviders(config, {});
  assert.equal(result.provider, undefined);
  assert.match(result.diagnostics[0].message, /用户目录/);
});
