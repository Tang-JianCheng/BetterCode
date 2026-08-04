import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AppConfig } from '../config/types.js';
import { loadCcSwitchProviders } from './loader.js';

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
