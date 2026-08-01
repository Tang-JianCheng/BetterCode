import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentDefinitionManager } from '../subagent/definition-manager.js';
import { ToolRegistry } from '../tool/registry.js';
import { createToolSuccess } from '../tool/types.js';
import {
  ApplicationLifecycle,
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
