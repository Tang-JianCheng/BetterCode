import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentDefinitionManager } from '../subagent/definition-manager.js';
import { ToolRegistry } from '../tool/registry.js';
import { createToolSuccess } from '../tool/types.js';
import {
  ApplicationLifecycle,
  createApplication,
  parseApplicationArguments,
  registerTeamDispatchTools,
  resolveWorkerProvider,
} from './application.js';

test('启动参数区分普通模式与隐藏 Worker 模式', () => {
  assert.deepEqual(parseApplicationArguments([]), {
    configPath: './config.yaml',
    permissionMode: 'default',
  });
  assert.deepEqual(parseApplicationArguments([
    '--team-worker', '/tmp/member.worker.json',
    '--config', 'worker.yaml',
    '--permission-mode', 'strict',
  ]), {
    configPath: 'worker.yaml',
    permissionMode: 'strict',
    workerDescriptorPath: '/tmp/member.worker.json',
  });
  assert.throws(() => parseApplicationArguments(['--unknown']), /未知参数/);
  assert.throws(() => parseApplicationArguments(['--permission-mode', 'unsafe']), /strict、default 或 allow/);
});

test('Worker Provider 解析从不进入交互选择', () => {
  const provider = (name: string, isDefault = false) => ({
    name,
    protocol: 'openai' as const,
    model: name,
    base_url: 'https://example.test',
    api_key: 'test',
    ...(isDefault ? { default: true } : {}),
  });
  assert.equal(resolveWorkerProvider({ providers: [provider('a'), provider('b', true)] }).name, 'b');
  assert.equal(resolveWorkerProvider({ providers: [provider('a'), provider('b')] }, 'a').name, 'a');
  assert.throws(
    () => resolveWorkerProvider({ providers: [provider('a'), provider('b')] }),
    /不能交互选择 Provider/,
  );
});

test('应用初始化失败时按服务创建逆序关闭', async () => {
  const lifecycle = new ApplicationLifecycle();
  const events: string[] = [];
  lifecycle.add(() => { events.push('first'); });
  lifecycle.add(async () => { events.push('second'); throw new Error('清理失败'); });
  lifecycle.add(() => { events.push('third'); });
  const errors: string[] = [];
  await lifecycle.close(error => errors.push((error as Error).message));
  await lifecycle.close();
  assert.deepEqual(events, ['third', 'second', 'first']);
  assert.deepEqual(errors, ['清理失败']);
});

test('团队工具在 Agent 角色定义校验前已经可见', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-bootstrap-'));
  const agents = path.join(root, '.bettercode', 'agents');
  mkdirSync(agents, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(agents, 'team-reader.md'), `---
name: team-reader
description: 查询团队状态
tools: [team_status]
disallowed_tools: []
background_tools: []
model: inherit
max_iterations: 3
permission_mode: strict
---
查询团队状态并汇报。
`);
  const registry = new ToolRegistry(root);
  registerTeamDispatchTools(registry, {
    execute: async () => createToolSuccess('{}'),
  });
  const manager = new AgentDefinitionManager(registry, root, { builtinDirectory: path.join(root, 'builtin') });
  const snapshot = manager.initialize();
  assert.equal(snapshot.definitions.has('team-reader'), true);
  assert.equal(snapshot.diagnostics.some(item => item.code === 'UNKNOWN_TOOL'), false);
});

test('createApplication 集成 cc-switch 导入并接管默认供应商', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-app-root-'));
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-app-home-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    env: { ANTHROPIC_API_KEY: 'sk-cc', ANTHROPIC_MODEL: 'claude-sonnet-5-20251001' },
  }));
  writeFileSync(path.join(root, 'config.yaml'), `providers:
  - name: deepseek-v4
    protocol: openai
    model: deepseek-v4-flash
    base_url: https://api.deepseek.com
    api_key: sk-local
    default: true
cc_switch:
  enabled: true
`);
  const application = await createApplication({
    configPath: 'config.yaml',
    permissionMode: 'default',
    rootDir: root,
    userHome: home,
  });
  assert.equal(application.provider.name, 'cc-switch.claude');
  assert.equal(application.provider.model, 'claude-sonnet-5-20251001');
  assert.equal(application.ccSwitchStatus.length, 0);
  await application.close();
});

test('createApplication 在 cc-switch 不可用时回退原默认供应商', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-app-root-'));
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-app-home-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  writeFileSync(path.join(root, 'config.yaml'), `providers:
  - name: deepseek-v4
    protocol: openai
    model: deepseek-v4-flash
    base_url: https://api.deepseek.com
    api_key: sk-local
    default: true
cc_switch:
  enabled: true
`);
  const application = await createApplication({
    configPath: 'config.yaml',
    permissionMode: 'default',
    rootDir: root,
    userHome: home,
  });
  assert.equal(application.provider.name, 'deepseek-v4');
  assert.ok(application.ccSwitchStatus.length > 0);
  await application.close();
});

test('createApplication 暴露 Provider 摘要并支持运行时切换', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-app-root-'));
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-app-home-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  writeFileSync(path.join(root, 'config.yaml'), `providers:
  - name: flash
    protocol: openai
    model: deepseek-v4-flash
    base_url: https://api.deepseek.com
    api_key: sk-local
    default: true
  - name: pro
    protocol: openai
    model: deepseek-v4-pro
    base_url: https://api.deepseek.com
    api_key: sk-local
`);
  const application = await createApplication({
    configPath: 'config.yaml',
    permissionMode: 'default',
    rootDir: root,
    userHome: home,
  });
  assert.deepEqual(application.providers.map(item => item.name), ['flash', 'pro']);
  assert.equal(application.providers[0].model, 'deepseek-v4-flash');
  assert.equal(application.providers[0].base_url, 'https://api.deepseek.com');
  assert.equal(Object.hasOwn(application.providers[0], 'api_key'), false);
  const switched = application.switchProvider('pro');
  assert.equal(switched.name, 'pro');
  assert.equal(switched.model, 'deepseek-v4-pro');
  assert.throws(() => application.switchProvider('missing'), /未找到 Provider 配置/);
  await application.close();
});

test('createApplication 显式 --provider 优先于 cc-switch 导入', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-app-root-'));
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-app-home-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    env: { ANTHROPIC_API_KEY: 'sk-cc', ANTHROPIC_MODEL: 'claude-sonnet-5-20251001' },
  }));
  writeFileSync(path.join(root, 'config.yaml'), `providers:
  - name: deepseek-v4
    protocol: openai
    model: deepseek-v4-flash
    base_url: https://api.deepseek.com
    api_key: sk-local
    default: true
cc_switch:
  enabled: true
`);
  const application = await createApplication({
    configPath: 'config.yaml',
    permissionMode: 'default',
    rootDir: root,
    userHome: home,
    providerName: 'deepseek-v4',
  });
  assert.equal(application.provider.name, 'deepseek-v4');
  assert.equal(application.ccSwitchStatus.length, 0);
  await application.close();
});

test('createApplication 未传 userHome 时兜底用户目录并导入 cc-switch', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-app-root-'));
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-app-home-'));
  const originalHome = os.homedir;
  t.after(() => {
    os.homedir = originalHome;
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  os.homedir = () => home;
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    env: { ANTHROPIC_API_KEY: 'sk-cc', ANTHROPIC_MODEL: 'claude-sonnet' },
  }));
  writeFileSync(path.join(root, 'config.yaml'), `providers:
  - name: deepseek-v4
    protocol: openai
    model: deepseek-v4-flash
    base_url: https://api.deepseek.com
    api_key: sk-local
    default: true
cc_switch:
  enabled: true
`);
  const application = await createApplication({
    configPath: 'config.yaml',
    permissionMode: 'default',
    rootDir: root,
  });
  assert.equal(application.provider.name, 'cc-switch.claude');
  assert.equal(application.provider.model, 'claude-sonnet');
  assert.equal(application.ccSwitchStatus.length, 0);
  await application.close();
});
