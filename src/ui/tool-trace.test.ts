import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import type { ToolTraceEntry } from '../presentation/types.js';
import type { ToolResult } from '../tool/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import {
  summarizeToolArguments,
  summarizeToolResult,
  toolResultStatus,
  ToolTraceView,
} from './tool-trace.js';

function capabilities(columns: number, unicode = true): TerminalCapabilities {
  return {
    columns,
    density: 'full',
    color: false,
    unicode,
    motion: false,
  };
}

const entries: ToolTraceEntry[] = [
  { callId: 'c1', toolName: 'read_file', status: 'success', args: '{"path":"src/a.ts"}', result: '读取 42 行' },
  { callId: 'c2', toolName: 'run_command', status: 'error', args: '{"command":"pnpm test"}', result: '退出码 1' },
];

test('ToolTraceView 默认折叠为一行摘要', async () => {
  const view = render(React.createElement(ToolTraceView, {
    entries,
    capabilities: capabilities(80),
  }));
  await new Promise(resolve => setTimeout(resolve, 20));
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /▶ 工具调用 × 2/u);
  assert.doesNotMatch(frame, /read_file/u, '折叠时不应展开工具明细');
  view.unmount();
});

test('ToolTraceView live 模式始终展开并显示明细', async () => {
  const view = render(React.createElement(ToolTraceView, {
    entries,
    capabilities: capabilities(80),
    live: true,
  }));
  await new Promise(resolve => setTimeout(resolve, 20));
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /工具调用/u);
  assert.match(frame, /read_file/u);
  assert.match(frame, /run_command/u);
  assert.match(frame, /✓/u);
  assert.match(frame, /✗/u);
  view.unmount();
});

test('ToolTraceView toggleSignal 自增切换折叠与展开', async () => {
  const view = render(React.createElement(ToolTraceView, {
    entries,
    capabilities: capabilities(80),
    toggleSignal: 0,
  }));
  const flush = () => new Promise(resolve => setTimeout(resolve, 20));
  await flush();
  assert.doesNotMatch(view.lastFrame() ?? '', /read_file/u, '初始折叠');
  view.rerender(React.createElement(ToolTraceView, {
    entries,
    capabilities: capabilities(80),
    toggleSignal: 1,
  }));
  await flush();
  assert.match(view.lastFrame() ?? '', /read_file/u, '第一次信号展开');
  view.rerender(React.createElement(ToolTraceView, {
    entries,
    capabilities: capabilities(80),
    toggleSignal: 2,
  }));
  await flush();
  assert.doesNotMatch(view.lastFrame() ?? '', /read_file/u, '第二次信号收起');
  view.unmount();
});

test('summarize 与状态推导纯函数', () => {
  assert.equal(summarizeToolArguments({ path: 'x.ts' }), '{"path":"x.ts"}');
  assert.equal(summarizeToolResult('  第一行\n第二行  '), '第一行 第二行');
  const ok: ToolResult = { ok: true, output: 'done', metadata: {} };
  const denied: ToolResult = {
    ok: false, output: '', metadata: {},
    error: { code: 'PERMISSION_DENIED', message: '拒绝' },
  };
  const failed: ToolResult = {
    ok: false, output: '', metadata: {},
    error: { code: 'EXECUTION_ERROR', message: '失败' },
  };
  assert.equal(toolResultStatus(ok), 'success');
  assert.equal(toolResultStatus(denied), 'denied');
  assert.equal(toolResultStatus(failed), 'error');
});

test('ToolTraceView ASCII 模式不输出 Unicode 装饰', async () => {
  const view = render(React.createElement(ToolTraceView, {
    entries,
    capabilities: capabilities(80, false),
    live: true,
  }));
  await new Promise(resolve => setTimeout(resolve, 20));
  const frame = view.lastFrame() ?? '';
  assert.doesNotMatch(frame, /[▶▼✓✗⚙⛔]/u);
  assert.match(frame, /\[ok\]/u);
  view.unmount();
});
