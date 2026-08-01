import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentDefinition } from './types.js';
import { resolveDefinedToolSnapshot, resolveForkToolDefinitions } from './tool-filter.js';
import { IMMUTABLE_SUBAGENT_DENIED_TOOLS } from './types.js';

function definition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'test',
    description: '测试',
    disallowedTools: ['write_file'],
    backgroundTools: ['read_file', 'write_file'],
    model: 'inherit',
    maxIterations: 5,
    permissionMode: 'default',
    isolation: 'none',
    scope: 'builtin',
    entryPath: '/agent.md',
    body: '测试',
    ...overrides,
  };
}

test('定义式工具按白名单、黑名单和后台交集收窄', () => {
  const registryNames = ['read_file', 'write_file', 'search_code', 'agent'];
  const denied = new Set(['agent']);
  const unrestricted = resolveDefinedToolSnapshot({ registryNames, definition: definition(), deniedTools: denied });
  assert.deepEqual([...unrestricted.foreground], ['read_file', 'search_code']);
  assert.deepEqual([...unrestricted.background], ['read_file']);
  const restricted = resolveDefinedToolSnapshot({
    registryNames,
    definition: definition({ tools: [] }),
    deniedTools: denied,
  });
  assert.deepEqual([...restricted.foreground], []);
});

test('Fork 工具保持父顺序并移除禁用项', () => {
  const tools = ['search_code', 'agent', 'read_file'].map(name => ({
    name,
    description: name,
    inputSchema: { type: 'object' },
  }));
  const filtered = resolveForkToolDefinitions({ parentTools: tools, deniedTools: new Set(['agent']) });
  assert.deepEqual(filtered.map(tool => tool.name), ['search_code', 'read_file']);
  assert.notEqual(filtered[0].inputSchema, tools[0].inputSchema);
});

test('普通子 Agent 永久移除全部团队工具', () => {
  const registryNames = ['read_file', 'team_status', 'team_task', 'team_message', 'team_integrate'];
  const snapshot = resolveDefinedToolSnapshot({
    registryNames,
    definition: definition(),
    deniedTools: new Set(IMMUTABLE_SUBAGENT_DENIED_TOOLS),
  });
  assert.deepEqual([...snapshot.foreground], ['read_file']);
  const fork = resolveForkToolDefinitions({
    parentTools: registryNames.map(name => ({ name, description: name, inputSchema: {} })),
    deniedTools: new Set(IMMUTABLE_SUBAGENT_DENIED_TOOLS),
  });
  assert.deepEqual(fork.map(item => item.name), ['read_file']);
});
