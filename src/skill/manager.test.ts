import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createCoreToolRegistry } from '../tool/factory.js';
import { SkillManager } from './manager.js';
import { LOAD_SKILL_TOOL_NAME } from './load-tool.js';
import { AgentTool } from '../subagent/agent-tool.js';

function document(name: string, tools: string[], mode = 'shared', extra = '', body = '执行 {{args}}'): string {
  return `---
name: ${name}
description: ${name} 说明
tools: [${tools.join(', ')}]
mode: ${mode}
${extra}---
${body}
`;
}

function fixture(t: TestContext) {
  const base = mkdtempSync(path.join(tmpdir(), 'bettercode-skill-manager-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  const builtin = path.join(base, 'builtin');
  mkdirSync(root, { recursive: true });
  mkdirSync(builtin, { recursive: true });
  return { base, root, home, builtin };
}

test('SkillManager 激活共享 Skill 并按并集收窄工具', t => {
  const { root, home, builtin } = fixture(t);
  writeFileSync(path.join(builtin, 'first.md'), document('first', ['read_file']));
  writeFileSync(path.join(builtin, 'second.md'), document('second', ['search_code']));
  const registry = createCoreToolRegistry(root);
  const manager = new SkillManager(registry, root, {
    userHome: home,
    builtinDirectory: builtin,
    reservedCommandNames: ['help'],
  });
  manager.initialize();

  assert.equal(registry.isSystem(LOAD_SKILL_TOOL_NAME), true);
  assert.deepEqual(
    [...manager.visibleTools().names],
    [...registry.names().filter(name => name !== LOAD_SKILL_TOOL_NAME), LOAD_SKILL_TOOL_NAME],
  );
  manager.activateShared('first', 'A');
  manager.activateShared('second', 'B');
  assert.deepEqual([...manager.visibleTools().names], ['read_file', 'search_code', LOAD_SKILL_TOOL_NAME]);
  assert.deepEqual(manager.getActiveNames(), ['first', 'second']);
  assert.match(manager.promptContent().activeSkills?.[0].content ?? '', /A/u);
  manager.activateShared('first', 'C');
  assert.deepEqual(manager.getActiveNames(), ['first', 'second']);
  assert.match(manager.promptContent().activeSkills?.[0].content ?? '', /C/u);
  manager.clearActive();
  assert.deepEqual(manager.getActiveNames(), []);
});

test('SkillManager 冷启动拒绝未知白名单和命令冲突', t => {
  const first = fixture(t);
  writeFileSync(path.join(first.builtin, 'broken.md'), document('broken', ['missing_tool']));
  assert.throws(() => new SkillManager(createCoreToolRegistry(first.root), first.root, {
    userHome: first.home,
    builtinDirectory: first.builtin,
  }).initialize(), /missing_tool/u);

  const second = fixture(t);
  writeFileSync(path.join(second.builtin, 'help.md'), document('help', []));
  assert.throws(() => new SkillManager(createCoreToolRegistry(second.root), second.root, {
    userHome: second.home,
    builtinDirectory: second.builtin,
    reservedCommandNames: ['help'],
  }).initialize(), /冲突/u);
});

test('SkillManager 无效热更新保留旧快照，修复后原子发布', t => {
  const { root, home, builtin } = fixture(t);
  const file = path.join(builtin, 'sample.md');
  writeFileSync(file, document('sample', ['read_file'], 'shared', '', '旧 {{args}}'));
  const manager = new SkillManager(createCoreToolRegistry(root), root, {
    userHome: home,
    builtinDirectory: builtin,
  });
  manager.initialize();
  manager.activateShared('sample', '参数');
  const revision = manager.getSnapshot().revision;

  writeFileSync(file, document('sample', ['missing_tool']));
  const invalid = manager.reload();
  assert.equal(invalid.updated, false);
  assert.equal(manager.getSnapshot().revision, revision);
  assert.match(manager.promptContent().activeSkills?.[0].content ?? '', /旧 参数/u);

  writeFileSync(file, document('sample', ['search_code'], 'shared', '', '新 {{args}}'));
  const valid = manager.reload();
  assert.equal(valid.updated, true);
  assert.equal(manager.getSnapshot().revision, revision + 1);
  assert.deepEqual([...manager.visibleTools().names], ['search_code', LOAD_SKILL_TOOL_NAME]);
  assert.match(manager.promptContent().activeSkills?.[0].content ?? '', /新 参数/u);
});

test('不存在 Provider 只禁用对应独立 Skill', t => {
  const { root, home, builtin } = fixture(t);
  writeFileSync(path.join(builtin, 'remote.md'), document(
    'remote',
    [],
    'isolated',
    'history: 0\nmodel: missing\n',
  ));
  writeFileSync(path.join(builtin, 'local.md'), document('local', []));
  const manager = new SkillManager(createCoreToolRegistry(root), root, {
    userHome: home,
    builtinDirectory: builtin,
    providerNames: ['known'],
  });
  const snapshot = manager.initialize();
  assert.equal(snapshot.skills.has('remote'), false);
  assert.equal(snapshot.skills.has('local'), true);
  assert.match(snapshot.diagnostics.at(-1)?.message ?? '', /missing/u);
});

test('真实内置目录提供 commit、review、test 样板', t => {
  const { root, home } = fixture(t);
  const manager = new SkillManager(createCoreToolRegistry(root), root, { userHome: home });
  const snapshot = manager.initialize();
  assert.equal(snapshot.skills.has('commit'), true);
  assert.equal(snapshot.skills.has('review'), true);
  assert.equal(snapshot.skills.has('test'), true);
  assert.equal(snapshot.skills.get('commit')?.mode, 'shared');
  assert.equal(snapshot.skills.get('review')?.history, 10);
  assert.equal(snapshot.skills.get('test')?.history, 0);
});

test('目录指纹变化后热更新发布新 revision', async t => {
  const { root, home, builtin } = fixture(t);
  writeFileSync(path.join(builtin, 'first.md'), document('first', []));
  const manager = new SkillManager(createCoreToolRegistry(root), root, {
    userHome: home,
    builtinDirectory: builtin,
    watchIntervalMs: 100,
  });
  t.after(() => manager.close());
  manager.initialize();
  const initialRevision = manager.getSnapshot().revision;
  const updated = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('等待 Skill 热更新超时')), 2000);
    const unsubscribe = manager.subscribe(snapshot => {
      if (!snapshot.skills.has('second')) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
  manager.startWatching();
  writeFileSync(path.join(builtin, 'second.md'), document('second', []));
  await updated;
  assert.equal(manager.getSnapshot().revision, initialRevision + 1);
});

test('Agent 运行期间延后热更新且独立作用域不泄漏共享激活', async t => {
  const { root, home, builtin } = fixture(t);
  const file = path.join(builtin, 'sample.md');
  writeFileSync(file, document('sample', ['read_file']));
  const registry = createCoreToolRegistry(root);
  const manager = new SkillManager(registry, root, {
    userHome: home,
    builtinDirectory: builtin,
  });
  manager.initialize();
  const revision = manager.getSnapshot().revision;
  manager.beginExecution();
  writeFileSync(file, document('sample', ['search_code']));
  assert.equal(manager.reload().updated, false);
  assert.equal(manager.getSnapshot().revision, revision);
  manager.endExecution();
  assert.equal(manager.reload().updated, true);

  const result = await manager.withIsolation(() => registry.execute({
    id: 'load',
    name: LOAD_SKILL_TOOL_NAME,
    arguments: { name: 'sample' },
  }));
  assert.equal(result.error?.code, 'TOOL_UNAVAILABLE');
  assert.deepEqual(manager.getActiveNames(), []);
});

test('目录型专属工具默认隐藏并在 Skill 激活后执行', async t => {
  const { root, home, builtin } = fixture(t);
  const directory = path.join(builtin, 'package');
  const toolsDirectory = path.join(directory, 'tools');
  mkdirSync(toolsDirectory, { recursive: true });
  writeFileSync(path.join(directory, 'SKILL.md'), document('package', ['package_info']));
  writeFileSync(path.join(toolsDirectory, 'info.schema.json'), JSON.stringify({
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
    additionalProperties: false,
  }));
  writeFileSync(path.join(toolsDirectory, 'info.mjs'), `
let data = '';
for await (const chunk of process.stdin) data += chunk;
const input = JSON.parse(data);
process.stdout.write(JSON.stringify({ok: true, output: input.value, metadata: {}}));
`);
  writeFileSync(path.join(toolsDirectory, 'info.tool.yaml'), `
name: package_info
description: 包信息
schema: ./info.schema.json
script: ./info.mjs
effect: read_only
permission:
  targetKind: arguments
  risk: read
`);
  const registry = createCoreToolRegistry(root);
  const manager = new SkillManager(registry, root, {
    userHome: home,
    builtinDirectory: builtin,
  });
  manager.initialize();
  assert.equal(registry.get('package_info')?.name, 'package_info');
  assert.equal(manager.visibleTools().names.has('package_info'), false);
  manager.activateShared('package', '参数');
  assert.equal(manager.visibleTools().names.has('package_info'), true);
  const result = await registry.execute({
    id: 'package',
    name: 'package_info',
    arguments: { value: '成功' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.output, '成功');
});

test('共享 Skill 保留 agent，独立 Skill 强制移除 agent', t => {
  const { root, home, builtin } = fixture(t);
  writeFileSync(path.join(builtin, 'shared.md'), document('shared', ['read_file']));
  writeFileSync(path.join(builtin, 'isolated.md'), document('isolated', ['read_file', 'agent'], 'isolated', 'history: 0\n'));
  const registry = createCoreToolRegistry(root);
  registry.register(new AgentTool(), { system: true });
  const manager = new SkillManager(registry, root, {
    userHome: home,
    builtinDirectory: builtin,
  });
  manager.initialize();
  manager.activateShared('shared', '');

  assert.equal(manager.visibleTools().names.has('agent'), true);
  assert.equal(manager.visibleTools({ name: 'isolated', args: '' }).names.has('agent'), false);
  assert.equal(manager.visibleTools({ name: 'isolated', args: '' }).names.has('load_skill'), true);
});
