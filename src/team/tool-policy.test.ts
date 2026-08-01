import assert from 'node:assert/strict';
import test from 'node:test';
import type { Tool, ToolPolicyInput } from '../tool/types.js';
import { TeamToolPolicy } from './tool-policy.js';
import type { LeadActor, MemberActor } from './types.js';

const baseTool = {
  name: 'write_file',
  effect: 'side_effect',
  description: '',
  inputSchema: {},
  permission: { targetKind: 'arguments', risk: 'write' },
  execute: async () => ({ ok: true, output: '', metadata: {} }),
} as Tool;

function input(name: string, action?: string, tool = baseTool): ToolPolicyInput {
  return {
    call: { id: 'call', name, arguments: action ? { action } : {} },
    tool: { ...tool, name },
    mode: 'act',
    iteration: 1,
    rootDir: '/repo',
    signal: new AbortController().signal,
  };
}

test('团队工具要求有效 actor 并按成员动作收窄', async () => {
  const unavailable = new TeamToolPolicy({ actor: () => undefined });
  assert.equal((await unavailable.authorize(input('team_status', 'get')))?.error?.code, 'TEAM_UNAVAILABLE');
  const member: MemberActor = { kind: 'member', team: 'alpha', member: 'one', generation: 1 };
  const policy = new TeamToolPolicy({ actor: () => member });
  assert.equal((await policy.authorize(input('team_member', 'create')))?.error?.code, 'TEAM_STATE_ERROR');
  assert.equal(await policy.authorize(input('team_task', 'report')), undefined);
});

test('成员副作用工具经过审批门禁', async () => {
  const member: MemberActor = { kind: 'member', team: 'alpha', member: 'one', generation: 1 };
  const denied = new TeamToolPolicy({
    actor: () => member,
    currentTaskId: () => 'task-1',
    approvals: { authorizeTool: () => { throw new Error('计划未批准'); } },
  });
  assert.equal((await denied.authorize(input('write_file')))?.error?.code, 'TEAM_APPROVAL_REQUIRED');
});

test('Coordinator 拒绝普通副作用并委托 Shell 白名单', async () => {
  const lead: LeadActor = { kind: 'lead', team: 'alpha', sessionId: 'session', generation: 1 };
  const policy = new TeamToolPolicy({
    actor: () => lead,
    coordinatorActive: () => true,
    authorizeCoordinatorCommand: command => command === 'git status'
      ? undefined
      : { ok: false, output: '', error: { code: 'TEAM_STATE_ERROR', message: '拒绝' }, metadata: {} },
  });
  assert.equal((await policy.authorize(input('write_file')))?.error?.code, 'TEAM_STATE_ERROR');
  const shellTool = { ...baseTool, name: 'run_command' } as Tool;
  const allowed = input('run_command', undefined, shellTool);
  allowed.call.arguments = { command: 'git status' };
  assert.equal(await policy.authorize(allowed), undefined);
  allowed.call.arguments = { command: 'echo x > file' };
  assert.equal((await policy.authorize(allowed))?.error?.code, 'TEAM_STATE_ERROR');
});
