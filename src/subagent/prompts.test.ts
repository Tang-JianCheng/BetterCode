import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentDefinition } from './types.js';
import {
  buildDefinedAgentSystemPrompt,
  buildDefinedAgentTask,
  buildForkAgentTask,
} from './prompts.js';

const definition: AgentDefinition = {
  name: 'reviewer',
  description: '审查代码',
  tools: ['read_file'],
  disallowedTools: [],
  backgroundTools: ['read_file'],
  model: 'inherit',
  maxIterations: 5,
  permissionMode: 'default',
  isolation: 'none',
  scope: 'project',
  entryPath: '/project/.bettercode/agents/reviewer.md',
  body: '你负责审查代码并给出准确结论。',
};

test('定义式提示保留固定模块顺序并突出子 Agent 约束和角色', () => {
  const prompt = buildDefinedAgentSystemPrompt(definition);
  assert.match(prompt, /BetterCode/);
  assert.doesNotMatch(prompt, /MewCode/i);
  assert.ok(prompt.indexOf('## 系统约束') < prompt.indexOf('## 子 Agent 约束'));
  assert.ok(prompt.indexOf('## 子 Agent 约束') < prompt.indexOf('## 子 Agent 角色：reviewer'));
  assert.match(prompt, /不得继续委派其他 Agent/);
  assert.match(prompt, /你负责审查代码并给出准确结论/);
});

test('定义式和 Fork 任务都要求非交互并保留任务正文', () => {
  assert.match(buildDefinedAgentTask('  检查 src  '), /检查 src$/);
  const fork = buildForkAgentTask('  分析失败原因  ');
  assert.match(fork, /非交互子 Agent/);
  assert.match(fork, /不得继续委派其他 Agent/);
  assert.match(fork, /分析失败原因$/);
});
