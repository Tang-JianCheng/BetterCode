import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SkillLoader } from './loader.js';

function skill(name: string, body: string, extra = ''): string {
  return `---
name: ${name}
description: ${name} 说明
tools: []
mode: shared
${extra}---
${body}
`;
}

test('Skill loader 按项目、用户、内置优先级稳定覆盖', t => {
  const base = mkdtempSync(path.join(tmpdir(), 'bettercode-skill-loader-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  const builtin = path.join(base, 'builtin');
  mkdirSync(path.join(root, '.bettercode/skills'), { recursive: true });
  mkdirSync(path.join(home, '.bettercode/skills'), { recursive: true });
  mkdirSync(builtin, { recursive: true });
  writeFileSync(path.join(builtin, 'same.md'), skill('same', '内置'));
  writeFileSync(path.join(home, '.bettercode/skills/same.md'), skill('same', '用户'));
  writeFileSync(path.join(root, '.bettercode/skills/same.md'), skill('same', '项目'));
  writeFileSync(path.join(builtin, 'other.md'), skill('other', '其他'));

  const loaded = new SkillLoader(root, { userHome: home, builtinDirectory: builtin }).load();
  assert.equal(loaded.skills.get('same')?.body, '项目');
  assert.equal(loaded.skills.get('other')?.body, '其他');
  assert.deepEqual([...loaded.skills.keys()], ['other', 'same']);
});

test('损坏的高层 Skill 遮蔽低层同名且不影响其他名称', t => {
  const base = mkdtempSync(path.join(tmpdir(), 'bettercode-skill-invalid-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  const builtin = path.join(base, 'builtin');
  mkdirSync(path.join(root, '.bettercode/skills'), { recursive: true });
  mkdirSync(path.join(home, '.bettercode/skills'), { recursive: true });
  mkdirSync(builtin, { recursive: true });
  writeFileSync(path.join(builtin, 'same.md'), skill('same', '内置'));
  writeFileSync(path.join(root, '.bettercode/skills/same.md'), skill('same', '项目').replace('mode: shared', 'mode: broken'));
  writeFileSync(path.join(builtin, 'other.md'), skill('other', '其他'));

  const loaded = new SkillLoader(root, { userHome: home, builtinDirectory: builtin }).load();
  assert.equal(loaded.skills.has('same'), false);
  assert.equal(loaded.disabledNames.has('same'), true);
  assert.equal(loaded.skills.has('other'), true);
  assert.match(loaded.diagnostics[0].message, /mode/u);
});

test('目录型工具拒绝指向 Skill 外的符号链接脚本', t => {
  const base = mkdtempSync(path.join(tmpdir(), 'bettercode-skill-escape-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  const builtin = path.join(base, 'builtin');
  const directory = path.join(builtin, 'pack');
  const tools = path.join(directory, 'tools');
  mkdirSync(tools, { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(directory, 'SKILL.md'), skill('pack', '能力'));
  writeFileSync(path.join(tools, 'tool.schema.json'), '{"type":"object"}');
  const outside = path.join(base, 'outside.mjs');
  writeFileSync(outside, 'process.stdout.write("{}")');
  symlinkSync(outside, path.join(tools, 'tool.mjs'));
  writeFileSync(path.join(tools, 'tool.tool.yaml'), `
name: packed_tool
description: 工具
schema: ./tool.schema.json
script: ./tool.mjs
effect: read_only
permission:
  targetKind: arguments
  risk: read
`);

  const loaded = new SkillLoader(root, { userHome: path.join(base, 'home'), builtinDirectory: builtin }).load();
  assert.equal(loaded.skills.has('pack'), false);
  assert.match(loaded.diagnostics[0].message, /目录外/u);
});
