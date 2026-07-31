import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCoreToolRegistry } from '../tool/factory.js';
import { AgentDefinitionManager } from './definition-manager.js';
import { AgentTool } from './agent-tool.js';
import { resolveSubAgentOptions } from './types.js';

function document(name: string, tools: string, model = 'inherit'): string {
  return `---
name: ${name}
description: 测试角色
tools: [${tools}]
disallowed_tools: []
background_tools: []
model: ${model}
max_iterations: 5
permission_mode: default
---
完成任务。
`;
}

test('AgentDefinitionManager 只禁用未知、禁止工具和缺失模型角色', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-agent-manager-'));
  const builtin = path.join(root, 'agents');
  mkdirSync(builtin, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(builtin, 'good.md'), document('good', 'read_file'));
  writeFileSync(path.join(builtin, 'unknown.md'), document('unknown', 'missing_tool'));
  writeFileSync(path.join(builtin, 'nested.md'), document('nested', 'agent'));
  writeFileSync(path.join(builtin, 'fast.md'), document('fast', 'read_file', 'haiku'));
  const registry = createCoreToolRegistry(root);
  registry.register(new AgentTool(), { system: true });
  const manager = new AgentDefinitionManager(registry, root, {
    builtinDirectory: builtin,
    providerNames: ['main'],
    deniedTools: resolveSubAgentOptions().deniedTools,
  });
  const snapshot = manager.initialize();
  assert.deepEqual([...snapshot.definitions.keys()], ['good']);
  assert.deepEqual([...snapshot.disabledNames].sort(), ['fast', 'nested', 'unknown']);
  assert.deepEqual(snapshot.diagnostics.map(item => item.code).sort(), [
    'FORBIDDEN_TOOL', 'UNKNOWN_MODEL_ALIAS', 'UNKNOWN_TOOL',
  ]);
});

test('AgentDefinitionManager 解析模型别名并保持旧快照对象稳定', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-agent-manager-'));
  const builtin = path.join(root, 'agents');
  mkdirSync(builtin, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(builtin, 'fast.md');
  writeFileSync(file, document('fast', 'read_file', 'haiku'));
  const registry = createCoreToolRegistry(root);
  registry.register(new AgentTool(), { system: true });
  const manager = new AgentDefinitionManager(registry, root, {
    builtinDirectory: builtin,
    providerNames: ['fast-provider'],
    modelAliases: { haiku: 'fast-provider' },
    deniedTools: resolveSubAgentOptions().deniedTools,
  });
  const first = manager.initialize();
  const definition = first.definitions.get('fast')!;
  assert.equal(manager.resolveProviderName(definition), 'fast-provider');
  writeFileSync(file, document('fast', 'search_code', 'haiku'));
  const second = manager.reload();
  assert.deepEqual(definition.tools, ['read_file']);
  assert.deepEqual(second.definitions.get('fast')?.tools, ['search_code']);
  assert.equal(second.revision, first.revision + 1);
});
