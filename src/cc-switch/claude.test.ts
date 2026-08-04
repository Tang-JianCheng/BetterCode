import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readClaudeProvider } from './claude.js';

function withHome(t: test.TestContext, settings?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-ccswitch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (settings !== undefined) {
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    writeFileSync(path.join(root, '.claude', 'settings.json'), settings);
  }
  return root;
}

const EMPTY_ENV: NodeJS.ProcessEnv = {};

test('读取 API key 认证并应用配置覆盖', t => {
  const home = withHome(t, JSON.stringify({
    env: {
      ANTHROPIC_API_KEY: 'sk-secret',
      ANTHROPIC_BASE_URL: 'https://gateway.example/v1/',
      ANTHROPIC_MODEL: 'claude-sonnet-5-20251001',
    },
  }));
  const result = readClaudeProvider(home, EMPTY_ENV, {
    name: 'custom.claude',
    thinking: true,
    context_window: 200000,
  });
  assert.equal(result.provider?.name, 'custom.claude');
  assert.equal(result.provider?.protocol, 'anthropic');
  assert.equal(result.provider?.model, 'claude-sonnet-5-20251001');
  assert.equal(result.provider?.base_url, 'https://gateway.example/v1/');
  assert.equal(result.provider?.api_key, 'sk-secret');
  assert.equal(result.provider?.authMode, 'api-key');
  assert.equal(result.provider?.thinking, true);
  assert.equal(result.provider?.context_window, 200000);
  assert.equal(result.diagnostics.length, 0);
});

test('AUTH_TOKEN 存在时优先走 Bearer 认证', t => {
  const home = withHome(t, JSON.stringify({
    env: {
      ANTHROPIC_API_KEY: 'sk-old',
      ANTHROPIC_AUTH_TOKEN: 'tok-new',
      ANTHROPIC_MODEL: 'claude-opus',
    },
  }));
  const result = readClaudeProvider(home, EMPTY_ENV);
  assert.equal(result.provider?.authMode, 'bearer');
  assert.equal(result.provider?.api_key, 'tok-new');
});

test('ANTHROPIC_MODEL 优先于配置覆盖模型', t => {
  const home = withHome(t, JSON.stringify({
    env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-sonnet' },
  }));
  const result = readClaudeProvider(home, EMPTY_ENV, { model: 'fallback-model' });
  assert.equal(result.provider?.model, 'claude-sonnet');
});

test('缺少 ANTHROPIC_MODEL 时使用配置覆盖模型', t => {
  const home = withHome(t, JSON.stringify({ env: { ANTHROPIC_API_KEY: 'k' } }));
  const result = readClaudeProvider(home, EMPTY_ENV, { model: 'config-model' });
  assert.equal(result.provider?.model, 'config-model');
});

test('缺省 base_url 使用 Anthropic 官方端点', t => {
  const home = withHome(t, JSON.stringify({
    env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm' },
  }));
  const result = readClaudeProvider(home, EMPTY_ENV);
  assert.equal(result.provider?.base_url, 'https://api.anthropic.com');
});

test('settings.json 缺失时诊断并跳过', t => {
  const home = withHome(t);
  const result = readClaudeProvider(home, EMPTY_ENV);
  assert.equal(result.provider, undefined);
  assert.equal(result.diagnostics[0].severity, 'info');
  assert.match(result.diagnostics[0].message, /settings\.json/);
});

test('settings.json 解析失败时诊断降级', t => {
  const home = withHome(t, '{ broken json');
  const result = readClaudeProvider(home, EMPTY_ENV);
  assert.equal(result.provider, undefined);
  assert.equal(result.diagnostics[0].severity, 'warning');
});

test('缺少 env 对象时诊断跳过', t => {
  const home = withHome(t, JSON.stringify({ apiKeyHelper: 'x' }));
  const result = readClaudeProvider(home, EMPTY_ENV);
  assert.equal(result.provider, undefined);
  assert.match(result.diagnostics[0].message, /env/);
});

test('缺少 key 时诊断并跳过', t => {
  const home = withHome(t, JSON.stringify({ env: { ANTHROPIC_MODEL: 'm' } }));
  const result = readClaudeProvider(home, EMPTY_ENV);
  assert.equal(result.provider, undefined);
  assert.match(result.diagnostics[0].message, /ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/);
});

test('缺少模型时诊断并跳过', t => {
  const home = withHome(t, JSON.stringify({ env: { ANTHROPIC_API_KEY: 'k' } }));
  const result = readClaudeProvider(home, EMPTY_ENV);
  assert.equal(result.provider, undefined);
  assert.match(result.diagnostics[0].message, /model/);
});

test('settings env 支持 ${VAR} 展开', t => {
  const home = withHome(t, JSON.stringify({
    env: { ANTHROPIC_API_KEY: '${TEST_CC_SWITCH_KEY}', ANTHROPIC_MODEL: 'm' },
  }));
  const result = readClaudeProvider(home, { TEST_CC_SWITCH_KEY: 'expanded-key' });
  assert.equal(result.provider?.api_key, 'expanded-key');
});

test('诊断文本不泄露 API key 明文', t => {
  const home = withHome(t, JSON.stringify({
    env: { ANTHROPIC_API_KEY: 'sk-ultra-secret', ANTHROPIC_MODEL: '   ' },
  }));
  const result = readClaudeProvider(home, EMPTY_ENV);
  assert.equal(result.provider, undefined);
  for (const diagnostic of result.diagnostics) {
    assert.doesNotMatch(diagnostic.message, /sk-ultra-secret/);
  }
});
