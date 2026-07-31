import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentDefinitionLoader } from './loader.js';

function document(name: string, description: string): string {
  return `---
name: ${name}
description: ${description}
disallowed_tools: []
background_tools: []
model: inherit
max_iterations: 5
permission_mode: default
---
完成任务。
`;
}

test('Agent loader 按项目、用户、内置、插件优先级覆盖', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-agent-loader-'));
  const home = path.join(root, 'home');
  const builtin = path.join(root, 'builtin');
  const plugin = path.join(root, 'plugin');
  for (const directory of [home, builtin, plugin, path.join(root, '.bettercode', 'agents'), path.join(home, '.bettercode', 'agents')]) {
    mkdirSync(directory, { recursive: true });
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(plugin, 'same.md'), document('same', '插件'));
  writeFileSync(path.join(builtin, 'same.md'), document('same', '内置'));
  writeFileSync(path.join(home, '.bettercode', 'agents', 'same.md'), document('same', '用户'));
  writeFileSync(path.join(root, '.bettercode', 'agents', 'same.md'), document('same', '项目'));
  const loaded = new AgentDefinitionLoader(root, {
    userHome: home,
    builtinDirectory: builtin,
    pluginDirectories: [plugin],
  }).load();
  assert.equal(loaded.definitions.get('same')?.description, '项目');
  assert.equal(loaded.definitions.get('same')?.scope, 'project');
});

test('损坏高层 Agent 禁用同名且不影响其他角色', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-agent-loader-'));
  const builtin = path.join(root, 'builtin');
  const project = path.join(root, '.bettercode', 'agents');
  mkdirSync(builtin, { recursive: true });
  mkdirSync(project, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(builtin, 'same.md'), document('same', '合法低层'));
  writeFileSync(path.join(builtin, 'other.md'), document('other', '其他'));
  writeFileSync(path.join(project, 'same.md'), `---\nname: same\n---\n损坏`);
  const loaded = new AgentDefinitionLoader(root, { builtinDirectory: builtin }).load();
  assert.equal(loaded.definitions.has('same'), false);
  assert.equal(loaded.disabledNames.has('same'), true);
  assert.equal(loaded.definitions.has('other'), true);
  assert.equal(loaded.diagnostics[0].code, 'INVALID_DEFINITION');
});

test('同一来源重复 Agent 会被禁用', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-agent-loader-'));
  const builtin = path.join(root, 'builtin');
  mkdirSync(path.join(builtin, 'nested'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(builtin, 'same.md'), document('same', '一'));
  writeFileSync(path.join(builtin, 'nested', 'AGENT.md'), document('same', '二'));
  const loaded = new AgentDefinitionLoader(root, { builtinDirectory: builtin }).load();
  assert.equal(loaded.definitions.has('same'), false);
  assert.equal(loaded.diagnostics[0].code, 'DUPLICATE_DEFINITION');
});
