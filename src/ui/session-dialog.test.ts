import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import type { SessionInfo } from '../session/session.js';
import type { TerminalCapabilities } from './capabilities.js';
import { SessionDialog } from './session-dialog.js';

const capabilities: TerminalCapabilities = {
  columns: 100,
  density: 'full',
  color: false,
  unicode: true,
  motion: false,
};

function session(id: string, summary: string, messageCount = 2): SessionInfo {
  return {
    id,
    summary,
    messageCount,
    size: 100,
    modTime: new Date('2026-08-04T10:00:00Z'),
  };
}

async function flushInput(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('会话选择器展示摘要、当前标记并支持 Enter 恢复', async () => {
  let selected: string | undefined;
  let cancelled = false;
  const view = render(React.createElement(SessionDialog, {
    sessions: [
      session('aaa-11111111', '修复解析器'),
      session('bbb-22222222', '优化 UI 面板'),
    ],
    currentSessionId: 'aaa-11111111',
    onSelect: id => { selected = id; },
    onDelete: () => undefined,
    onCancel: () => { cancelled = true; },
    capabilities,
  }));
  await flushInput();
  let frame = view.lastFrame() ?? '';
  assert.match(frame, /历史会话/u);
  assert.match(frame, /修复解析器/u);
  assert.match(frame, /\[当前\]/u);
  assert.doesNotMatch(frame, /首条任务/u);

  view.stdin.write('\r');
  await flushInput();
  assert.equal(selected, 'aaa-11111111');
  assert.equal(cancelled, false);
  view.unmount();
});

test('方向键移动选择，Enter 恢复选中项，Esc 退出', async () => {
  const selected: string[] = [];
  let cancelled = false;
  const view = render(React.createElement(SessionDialog, {
    sessions: [
      session('aaa-11111111', '修复解析器'),
      session('bbb-22222222', '优化 UI 面板'),
    ],
    currentSessionId: 'none',
    onSelect: id => selected.push(id),
    onDelete: () => undefined,
    onCancel: () => { cancelled = true; },
    capabilities,
  }));
  await flushInput();
  view.stdin.write('\u001B[B');
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(selected, ['bbb-22222222']);

  view.stdin.write('\u001B');
  await flushInput();
  assert.equal(cancelled, true);
  view.unmount();
});

test('Delete 删除选中会话，向上方向键可回绕到末尾', async () => {
  const deleted: string[] = [];
  let selected: string | undefined;
  const view = render(React.createElement(SessionDialog, {
    sessions: [
      session('aaa-11111111', '修复解析器'),
      session('bbb-22222222', '优化 UI 面板'),
    ],
    currentSessionId: 'none',
    onSelect: id => { selected = id; },
    onDelete: id => deleted.push(id),
    onCancel: () => undefined,
    capabilities,
  }));
  await flushInput();
  view.stdin.write('\u001B[A');
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  assert.equal(selected, 'bbb-22222222');
  view.stdin.write('\u007F');
  await flushInput();
  assert.deepEqual(deleted, ['bbb-22222222']);
  view.unmount();
});

test('超过一页时显示剩余候选并可滚动窗口', async () => {
  const sessions = Array.from({ length: 12 }, (_, index) =>
    session(`s${index + 1}-00000001`, `摘要 ${index + 1}`));
  const view = render(React.createElement(SessionDialog, {
    sessions,
    currentSessionId: 'none',
    onSelect: () => undefined,
    onDelete: () => undefined,
    onCancel: () => undefined,
    capabilities,
  }));
  await flushInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /还有 3 个候选/u);
  assert.match(frame, /摘要 1/u);
  assert.doesNotMatch(frame, /摘要 12/u);

  for (let index = 0; index < 11; index += 1) {
    view.stdin.write('\u001B[B');
    await flushInput();
  }
  const scrolled = view.lastFrame() ?? '';
  assert.match(scrolled, /摘要 12/u);
  view.unmount();
});
