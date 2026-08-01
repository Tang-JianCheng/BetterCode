import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentDefinition } from '../subagent/types.js';
import type { TeamMemberRecord, TeamTaskRecord } from './types.js';
import { buildMemberSystemPrompt, buildMemberTaskPrompt } from './prompts.js';

const definition = {
  name: 'coder', body: '专注实现代码。', permissionMode: 'default', maxIterations: 10,
  tools: [], disallowedTools: [], backgroundTools: [], model: 'inherit', isolation: 'none',
  scope: 'project', entryPath: '/role.md', description: '编码',
} as AgentDefinition;
const member = { name: 'alice' } as TeamMemberRecord;
const task = { id: 'task-0001', title: '实现功能', description: '完成团队功能', state: 'ready' } as TeamTaskRecord;

test('成员系统提示使用 BetterCode 名称并固定身份与工作目录', () => {
  const prompt = buildMemberSystemPrompt(definition, {
    team: 'alpha', member, task, cwd: '/repo/.bettercode/worktrees/team/alpha/alice', branch: 'bettercode/team/alice',
  });
  assert.match(prompt, /BetterCode/);
  assert.match(prompt, /成员：alice/);
  assert.match(prompt, /当前工作目录：\/repo/);
  assert.match(prompt, /专属分支：bettercode\/team\/alice/);
  assert.match(prompt, /专注实现代码/);
});

test('成员任务提示包含任务、邮箱和状态报告约定', () => {
  const prompt = buildMemberTaskPrompt({
    team: 'alpha', member, task, cwd: '/repo',
    messages: [{ type: 'text', sender: 'lead', body: '先补测试' } as never],
  });
  assert.match(prompt, /task-0001/);
  assert.match(prompt, /先补测试/);
  assert.match(prompt, /team_task\.report/);
});
