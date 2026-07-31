import assert from 'node:assert/strict';
import test from 'node:test';
import { compileHooks, HookCompileError } from './compiler.js';
import type { HookEventContext, LoadedHookConfig } from './types.js';

function config(value: Record<string, unknown>): LoadedHookConfig {
  return {
    secretValues: [],
    rules: [{
      source: { layer: 'project', file: '/project/.bettercode/hooks.yaml', index: 0, id: 'project:0' },
      value,
    }],
  };
}

function preContext(command: string): HookEventContext {
  return {
    event: 'pre_tool_use',
    projectRoot: '/project',
    session: { id: 'session' },
    timestamp: '2026-07-31T00:00:00.000Z',
    turn: { id: 'turn', mode: 'act', task: 'test' },
    tool: { id: 'call', name: 'run_command', arguments: { command } },
  };
}

test('Hook compiler 编译 all、正则和反向条件', () => {
  const [rule] = compileHooks(config({
    event: 'pre_tool_use',
    if: {
      all: [
        { field: 'tool.name', match: 'exact', value: 'run_command' },
        { field: 'tool.arguments.command', match: 'regex', value: '(^|\\s)git\\s+push', negate: true },
      ],
    },
    action: { type: 'command', command: 'echo ok' },
  }));

  assert.equal(rule.condition?.matches(preContext('git status')), true);
  assert.equal(rule.condition?.matches(preContext('git push origin main')), false);
});

test('Hook compiler 严格拒绝前置 once、后台 prompt 和未知字段', () => {
  assert.throws(() => compileHooks(config({
    event: 'pre_tool_use',
    once: true,
    action: { type: 'command', command: 'echo ok' },
  })), HookCompileError);
  assert.throws(() => compileHooks(config({
    event: 'turn_start',
    background: true,
    action: { type: 'prompt', prompt: 'hello' },
  })), HookCompileError);
  assert.throws(() => compileHooks(config({
    event: 'turn_start',
    action: { type: 'prompt', prompt: 'hello' },
    priority: 1,
  })), HookCompileError);
  assert.throws(() => compileHooks(config({
    event: 'post_tool_use',
    action: { type: 'http', url: 'https://example.test', headers: { 'bad header': 'x' } },
  })), HookCompileError);
  assert.throws(() => compileHooks(config({
    event: 'turn_start',
    action: { type: 'prompt', prompt: 'broken {{turn.task' },
  })), HookCompileError);
});

test('Prompt 和 HTTP JSON 模板保留结构化字段', () => {
  const [prompt] = compileHooks(config({
    event: 'pre_tool_use',
    action: { type: 'prompt', prompt: '检查 {{tool.name}}: {{tool.arguments}}' },
  }));
  assert.match(
    prompt.action.type === 'prompt' ? prompt.action.prompt.render(preContext('git status')) : '',
    /run_command.*git status/,
  );
});

test('Hook compiler 支持 Agent 字段匹配和可选角色', () => {
  const [rule] = compileHooks(config({
    event: 'post_tool_use',
    if: { all: [
      { field: 'agent.kind', match: 'exact', value: 'defined' },
      { field: 'agent.role', match: 'glob', value: 'review*' },
    ] },
    action: { type: 'agent', role: 'Reviewer', prompt: '复核 {{agent.id}}' },
  }));
  const scoped: HookEventContext = {
    event: 'post_tool_use', projectRoot: '/project', session: { id: 's1' }, timestamp: '',
    turn: { id: 'turn', mode: 'act', task: '检查' },
    agent: { id: 'sa-1', kind: 'defined', role: 'reviewer', sessionId: 's1' },
    tool: { id: 'call', name: 'read_file', arguments: {}, result: { ok: true, output: '', metadata: {} } },
  };

  assert.equal(rule.condition?.matches(scoped), true);
  assert.equal(rule.action.type === 'agent' ? rule.action.role : undefined, 'reviewer');
  assert.equal(rule.action.type === 'agent' ? rule.action.prompt.render(scoped) : '', '复核 sa-1');
  assert.equal(rule.condition?.matches({ ...scoped, agent: undefined }), false);
});

test('Hook compiler 拒绝非法 Agent 角色和前置 Agent 动作', () => {
  assert.throws(() => compileHooks(config({
    event: 'turn_start', action: { type: 'agent', role: 'bad/name', prompt: 'x' },
  })), HookCompileError);
  assert.throws(() => compileHooks(config({
    event: 'pre_tool_use', action: { type: 'agent', prompt: 'x' },
  })), HookCompileError);
});
