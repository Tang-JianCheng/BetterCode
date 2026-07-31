import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentTool } from './agent-tool.js';

const context = {
  rootDir: '/project',
  signal: new AbortController().signal,
  maxOutputBytes: 64 * 1024,
};

test('agent 工具定义稳定并只准备调度', async () => {
  const tool = new AgentTool();
  assert.equal(tool.name, 'agent');
  assert.equal(tool.effect, 'read_only');
  assert.deepEqual(tool.inputSchema.required, ['type', 'task']);
  const defined = await tool.execute({ type: 'defined', task: '检查', role: 'general' }, context);
  assert.equal(defined.ok, true);
  assert.equal(defined.metadata.subagentDispatch, true);
  const fork = await tool.execute({ type: 'fork', task: '复核' }, context);
  assert.equal(fork.ok, true);
  assert.equal(fork.metadata.subagentType, 'fork');
});

test('agent 工具拒绝 defined 和 fork 非法组合', async () => {
  const tool = new AgentTool();
  for (const input of [
    { type: 'defined', task: '检查' },
    { type: 'fork', task: '检查', role: 'general' },
    { type: 'fork', task: '检查', background: true },
    { type: 'unknown', task: '检查' },
    { type: 'defined', task: '', role: 'general' },
  ]) {
    const result = await tool.execute(input, context);
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'INVALID_ARGUMENTS');
  }
});
