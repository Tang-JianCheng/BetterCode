import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolSuccess, type ToolContext } from '../tool/types.js';
import { createTeamTools, type TeamToolHandler } from './tools.js';

test('团队工具名称稳定并把动作交给统一处理器', async () => {
  const calls: string[] = [];
  const handler: TeamToolHandler = {
    execute: async (tool, input) => {
      calls.push(`${tool}.${String(input.action)}`);
      return createToolSuccess('ok');
    },
  };
  const tools = createTeamTools(handler);
  assert.deepEqual(tools.map(tool => tool.name), [
    'team_status', 'team_member', 'team_task', 'team_message', 'team_approval', 'team_integrate',
  ]);
  const context = {
    rootDir: '/repo', signal: new AbortController().signal, maxOutputBytes: 1024,
  } as ToolContext;
  const result = await tools.find(tool => tool.name === 'team_task')!.execute({ action: 'list' }, context);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['team_task.list']);
});

test('团队工具拒绝未知动作并转换服务异常', async () => {
  const handler: TeamToolHandler = {
    execute: async () => { throw new Error('服务失败'); },
  };
  const tool = createTeamTools(handler).find(item => item.name === 'team_member')!;
  const context = {
    rootDir: '/repo', signal: new AbortController().signal, maxOutputBytes: 1024,
  } as ToolContext;
  assert.equal((await tool.execute({ action: 'unknown' }, context)).error?.code, 'INVALID_ARGUMENTS');
  assert.match((await tool.execute({ action: 'list' }, context)).error?.message ?? '', /服务失败/);
});
