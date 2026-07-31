import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractAgentDefinitionName, parseAgentDefinitionDocument } from './parser.js';

const VALID = `---
name: explorer
description: 调研代码
tools: [read_file]
disallowed_tools: [run_command]
background_tools: [read_file]
model: haiku
max_iterations: 8
permission_mode: strict
---
只读取必要事实并返回证据。
`;

test('Agent parser 解析完整元信息并保留 tools 缺省差异', () => {
  const parsed = parseAgentDefinitionDocument(VALID);
  assert.equal(parsed.metadata.name, 'explorer');
  assert.deepEqual(parsed.metadata.tools, ['read_file']);
  assert.deepEqual(parsed.metadata.disallowedTools, ['run_command']);
  assert.deepEqual(parsed.metadata.backgroundTools, ['read_file']);
  assert.equal(parsed.metadata.model, 'haiku');
  assert.equal(parsed.metadata.maxIterations, 8);
  assert.equal(parsed.metadata.permissionMode, 'strict');
  assert.equal(parsed.body, '只读取必要事实并返回证据。');

  const withoutTools = parseAgentDefinitionDocument(VALID.replace('tools: [read_file]\n', ''));
  assert.equal(withoutTools.metadata.tools, undefined);
  const emptyTools = parseAgentDefinitionDocument(VALID.replace('tools: [read_file]', 'tools: []'));
  assert.deepEqual(emptyTools.metadata.tools, []);
});

test('Agent parser 拒绝缺失、未知、重复和非法字段', () => {
  const cases = [
    [VALID.replace('background_tools: [read_file]\n', ''), /background_tools/],
    [VALID.replace('permission_mode: strict', 'permission_mode: prompt'), /permission_mode/],
    [VALID.replace('max_iterations: 8', 'max_iterations: 0'), /max_iterations/],
    [VALID.replace('tools: [read_file]', 'tools: [read_file, read_file]'), /重复/],
    [VALID.replace('description: 调研代码', 'description: 调研代码\nunknown: true'), /未知字段/],
    [VALID.replace('只读取必要事实并返回证据。', ''), /正文不能为空/],
  ] as const;
  for (const [content, expected] of cases) {
    assert.throws(() => parseAgentDefinitionDocument(content), expected);
  }
});

test('名称预提取在损坏文档中仍支持覆盖分组', () => {
  assert.equal(extractAgentDefinitionName(VALID, 'fallback'), 'explorer');
  assert.equal(extractAgentDefinitionName('broken', 'Fallback'), 'fallback');
});

test('真实内置 general Agent 定义合法', () => {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const content = readFileSync(path.resolve(directory, '../../agents/general.md'), 'utf8');
  const parsed = parseAgentDefinitionDocument(content);
  assert.equal(parsed.metadata.name, 'general');
  assert.equal(parsed.metadata.model, 'inherit');
  assert.equal(parsed.metadata.permissionMode, 'default');
  assert.equal(parsed.metadata.maxIterations, 10);
  assert.deepEqual(parsed.metadata.backgroundTools, ['read_file', 'find_files', 'search_code']);
});
