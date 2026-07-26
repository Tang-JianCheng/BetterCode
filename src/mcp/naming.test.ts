import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMcpToolName,
  isMcpToolName,
  MAX_LOCAL_TOOL_NAME_LENGTH,
} from './naming.js';

test('MCP names are stable, legal and bounded', () => {
  const first = createMcpToolName('Issue Tracker', 'Search Issues');
  const second = createMcpToolName('Issue Tracker', 'Search Issues');
  const long = createMcpToolName('服'.repeat(100), 'Tool!'.repeat(100));
  assert.equal(first, second);
  assert.match(first, /^[a-z][a-z0-9_]*$/u);
  assert.equal(isMcpToolName(first), true);
  assert.equal(long.length <= MAX_LOCAL_TOOL_NAME_LENGTH, true);
  assert.equal(isMcpToolName(long), true);
});

test('MCP name hash distinguishes source and normalized collisions', () => {
  const names = new Set([
    createMcpToolName('one', 'search'),
    createMcpToolName('two', 'search'),
    createMcpToolName('a-b', 'tool'),
    createMcpToolName('a_b', 'tool'),
  ]);
  assert.equal(names.size, 4);
  assert.equal(isMcpToolName('read_file'), false);
  assert.equal(isMcpToolName('mcp_fake_tool_deadbeef_extra'), false);
});
