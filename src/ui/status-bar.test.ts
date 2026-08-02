import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatusLines, statusLineText, type StatusBarState } from './status-bar.js';
import { displayWidth, type TerminalCapabilities } from './capabilities.js';

const state: StatusBarState = {
  providerName: 'deepseek',
  model: 'deepseek-v4-pro-with-a-very-long-name',
  agentMode: 'plan',
  permissionMode: 'default',
  usage: {
    inputTokens: 12_345,
    outputTokens: 678,
    totalTokens: 13_023,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 9_000,
  },
  contextWindow: 128_000,
  sessionId: 'abc-12345678',
  activeSkills: ['review'],
  backgroundTasks: 2,
};

function capabilities(columns: number): TerminalCapabilities {
  return {
    columns,
    density: columns >= 100 ? 'full' : columns >= 64 ? 'compact' : 'narrow',
    color: false,
    unicode: true,
    motion: false,
  };
}

test('状态栏在完整与紧凑模式保留核心状态并按宽度收缩', () => {
  for (const columns of [120, 80]) {
    const terminal = capabilities(columns);
    const lines = buildStatusLines(state, terminal);
    const output = lines.map(line => statusLineText(line, terminal));
    assert.equal(output.length, 2);
    assert.match(output[0], /deepseek/u);
    assert.match(output[0], /PLAN/u);
    assert.match(output[0], /DEFAULT/u);
    assert.equal(output.every(line => displayWidth(line) <= columns), true);
  }
});

test('窄屏状态栏拆行保留模型、模式和权限', () => {
  const terminal = capabilities(55);
  const output = buildStatusLines(state, terminal).map(line => statusLineText(line, terminal));
  assert.equal(output.length, 2);
  assert.match(output.join('\n'), /deepseek/u);
  assert.match(output.join('\n'), /PLAN/u);
  assert.match(output.join('\n'), /DEFAULT/u);
  assert.equal(output.every(line => displayWidth(line) <= 55), true);
});

test('无 usage 使用有意设计的空状态', () => {
  const terminal = capabilities(120);
  const output = buildStatusLines({ ...state, usage: undefined }, terminal)
    .map(line => statusLineText(line, terminal)).join('\n');
  assert.match(output, /TOK —/u);
  assert.doesNotMatch(output, /0↑|0↓|0Σ/u);
});
