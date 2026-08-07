import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import type { McpRemoteTool, McpServerToolListing } from '../mcp/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { McpDialog } from './mcp-dialog.js';

const capabilities: TerminalCapabilities = {
  columns: 100,
  density: 'full',
  color: false,
  unicode: true,
  motion: false,
};

function tool(name: string, description = ''): McpRemoteTool {
  return { name, description, inputSchema: { type: 'object' }, readOnly: false };
}

function server(name: string, transport: 'stdio' | 'http', tools: McpRemoteTool[], connected = true): McpServerToolListing {
  return { name, transport, connected, tools };
}

async function flushInput(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('/mcp 第一级展示 Server 列表，名称左对齐、状态右对齐', async () => {
  let cancelled = false;
  const view = render(React.createElement(McpDialog, {
    servers: [
      server('context7', 'http', [tool('get_docs', '文档')]),
      server('playwright', 'stdio', [tool('browser_click')]),
    ],
    onCancel: () => { cancelled = true; },
    capabilities,
  }));
  await flushInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /\[MCP\] MCP 服务器/u);
  assert.match(frame, /context7/u);
  assert.match(frame, /playwright/u);
  assert.match(frame, /http · 1 工具 · 已连接/u);
  assert.match(frame, /stdio · 1 工具 · 已连接/u);
  assert.equal(cancelled, false);

  view.stdin.write('\u001B'); // Esc 退出
  await flushInput();
  assert.equal(cancelled, true);
  view.unmount();
});

test('/mcp 进入 Server 展示其工具，Esc 返回服务器列表', async () => {
  let cancelled = false;
  const view = render(React.createElement(McpDialog, {
    servers: [
      server('playwright', 'stdio', [tool('browser_click', '点击'), tool('browser_navigate', '导航')]),
    ],
    onCancel: () => { cancelled = true; },
    capabilities,
  }));
  await flushInput();
  view.stdin.write('\r'); // Enter 进入 playwright
  await flushInput();
  let frame = view.lastFrame() ?? '';
  assert.match(frame, /\[MCP\] playwright 工具/u);
  assert.match(frame, /browser_click/u);
  assert.match(frame, /browser_navigate/u);
  assert.match(frame, /点击/u);

  view.stdin.write('\u001B'); // Esc 回到服务器列表
  await flushInput();
  frame = view.lastFrame() ?? '';
  assert.match(frame, /\[MCP\] MCP 服务器/u);
  assert.match(frame, /playwright/u);

  view.stdin.write('\u001B'); // 再 Esc 退出
  await flushInput();
  assert.equal(cancelled, true);
  view.unmount();
});

test('/mcp 连接失败的 Server 显示失败状态，无工具时不进入工具页', async () => {
  let cancelled = false;
  const view = render(React.createElement(McpDialog, {
    servers: [server('github', 'http', [], false)],
    onCancel: () => { cancelled = true; },
    capabilities,
  }));
  await flushInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /github/u);
  assert.match(frame, /失败/u);
  view.stdin.write('\r'); // 无工具，Enter 直接退出
  await flushInput();
  assert.equal(cancelled, true);
  view.unmount();
});
