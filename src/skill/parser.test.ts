import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSkillDocument, renderSkillBody } from './parser.js';

const valid = `---
name: review
description: 审查代码
tools: [read_file, search_code]
mode: isolated
history: 10
model: deepseek
---
请审查 {{args}}，然后再次检查 {{args}}。
`;

test('Skill parser 解析严格元信息并替换全部参数', () => {
  const parsed = parseSkillDocument(valid);
  assert.deepEqual(parsed.metadata, {
    name: 'review',
    description: '审查代码',
    tools: ['read_file', 'search_code'],
    mode: 'isolated',
    history: 10,
    model: 'deepseek',
  });
  assert.equal(renderSkillBody(parsed.body, 'src/chat'), '请审查 src/chat，然后再次检查 src/chat。');
});

test('Skill parser 拒绝未知字段、重复工具和非法模式字段', () => {
  assert.throws(() => parseSkillDocument(valid.replace('model: deepseek', 'extra: true')), /未知字段/u);
  assert.throws(() => parseSkillDocument(valid.replace('[read_file, search_code]', '[read_file, read_file]')), /重复/u);
  assert.throws(() => parseSkillDocument(valid.replace('mode: isolated', 'mode: shared')), /不能配置 history/u);
  assert.throws(() => parseSkillDocument(valid.replace('请审查 {{args}}，然后再次检查 {{args}}。', ' ')), /正文不能为空/u);
  assert.throws(() => parseSkillDocument('name: broken'), /frontmatter/u);
});

test('共享 Skill 使用默认历史且不接受指定模型', () => {
  const parsed = parseSkillDocument(`---
name: commit
description: 提交代码
tools: [run_command]
mode: shared
---
提交 {{args}}
`);
  assert.equal(parsed.metadata.history, 0);
  assert.equal(parsed.metadata.model, undefined);
});
