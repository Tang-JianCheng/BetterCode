import assert from 'node:assert/strict';
import test from 'node:test';
import type { LLMProvider } from '../provider/types.js';
import type { AgentDefinition } from '../subagent/types.js';
import { ToolRegistry } from '../tool/registry.js';
import type { Tool } from '../tool/types.js';
import { TeamMemberRuntimeResolver } from './member-runtime.js';
import type { TeamMemberRecord, TeamTaskRecord } from './types.js';

const provider = { name: 'default' } as LLMProvider;
const member = { name: 'alice', role: 'coder', generation: 2 } as TeamMemberRecord;
const task = { id: 'task-1', history: [] } as unknown as TeamTaskRecord;

function tool(name: string, effect: Tool['effect']): Tool {
  return { name, effect, description: '', inputSchema: {}, permission: { targetKind: 'arguments', risk: 'read' }, execute: async () => ({ ok: true, output: '', metadata: {} }) };
}

function resolver(definition: AgentDefinition) {
  const registry = new ToolRegistry('/tmp');
  registry.register(tool('read_file', 'read_only'));
  registry.register(tool('write_file', 'side_effect'));
  registry.register(tool('agent', 'side_effect'));
  registry.register(tool('load_skill', 'read_only'));
  for (const name of ['team_status', 'team_task', 'team_message', 'team_approval', 'team_member', 'team_integrate']) {
    registry.register(tool(name, name === 'team_status' ? 'read_only' : 'side_effect'));
  }
  const definitions = {
    get: () => definition,
    getSnapshot: () => ({ revision: 7, definitions: new Map<string, AgentDefinition>(), disabledNames: new Set<string>(), diagnostics: [] }),
    resolveProviderName: () => undefined,
  };
  return new TeamMemberRuntimeResolver(registry, definitions, { has: () => true, resolve: () => provider });
}

test('只读角色共享根目录并自动注入成员协作工具', () => {
  const definition = {
    name: 'coder', tools: ['read_file'], disallowedTools: [], model: 'inherit', permissionMode: 'default',
    maxIterations: 8, backgroundTools: [], isolation: 'none', body: '', scope: 'project', entryPath: '', description: '',
  } as AgentDefinition;
  const snapshot = resolver(definition).resolve('alpha', member, task, provider);
  assert.equal(snapshot.requiresWorktree, false);
  assert.equal(snapshot.visibleToolNames.has('read_file'), true);
  assert.equal(snapshot.visibleToolNames.has('team_task'), true);
  assert.equal(snapshot.visibleToolNames.has('team_member'), false);
  assert.equal(snapshot.roleRevision, 7);
});

test('可写角色要求 Worktree 且剥离 Agent 和 Skill 工具', () => {
  const definition = {
    name: 'coder', tools: ['write_file', 'agent', 'load_skill'], disallowedTools: [], model: 'inherit', permissionMode: 'default',
    maxIterations: 8, backgroundTools: [], isolation: 'none', body: '', scope: 'project', entryPath: '', description: '',
  } as AgentDefinition;
  const snapshot = resolver(definition).resolve('alpha', member, task, provider);
  assert.equal(snapshot.requiresWorktree, true);
  assert.equal(snapshot.visibleToolNames.has('agent'), false);
  assert.equal(snapshot.visibleToolNames.has('load_skill'), false);
});

test('显式空工具白名单只保留系统注入的协作工具', () => {
  const definition = {
    name: 'coder', tools: [], disallowedTools: [], model: 'inherit', permissionMode: 'default',
    maxIterations: 8, backgroundTools: [], isolation: 'none', body: '', scope: 'project', entryPath: '', description: '',
  } as AgentDefinition;
  const snapshot = resolver(definition).resolve('alpha', member, task, provider);
  assert.deepEqual([...snapshot.visibleToolNames].sort(), ['team_approval', 'team_message', 'team_status', 'team_task']);
});
