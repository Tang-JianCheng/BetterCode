import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { createConversation, createDocument, createNotice } from '../presentation/builders.js';
import { PresentationView, formatBlockLines } from './presentation-view.js';
import { displayWidth, type TerminalCapabilities } from './capabilities.js';

function capabilities(columns: number, unicode = true): TerminalCapabilities {
  return {
    columns,
    density: columns >= 100 ? 'full' : columns >= 64 ? 'compact' : 'narrow',
    color: false,
    unicode,
    motion: false,
  };
}

test('普通对话保持轻量，通知和命令文档保持明确层级', () => {
  const assistant = render(React.createElement(PresentationView, {
    item: createConversation({ role: 'assistant', content: '正文 /help 不应变成面板' }),
    capabilities: capabilities(100),
  }));
  assert.equal((assistant.lastFrame() ?? '').trimEnd(), '正文 /help 不应变成面板');
  assistant.unmount();

  const notice = render(React.createElement(PresentationView, {
    item: createNotice({ tone: 'warning', title: '权限变化', message: '当前为 strict' }),
    capabilities: capabilities(100),
  }));
  assert.match(notice.lastFrame() ?? '', /WARN · 权限变化.*当前为 strict/su);
  notice.unmount();

  const document = render(React.createElement(PresentationView, {
    item: createDocument({
      source: 'command', title: '命令目录', tone: 'info', badge: 'HELP',
      blocks: [{ type: 'key_value', entries: [{ label: '模式', value: 'PLAN' }] }],
    }),
    capabilities: capabilities(100),
  }));
  assert.match(document.lastFrame() ?? '', /\[HELP\] 命令目录.*模式: PLAN/su);
  document.unmount();
});

test('表格在三档宽度内保持有界并在窄屏转逐项布局', () => {
  const block = {
    type: 'table' as const,
    columns: [{ key: 'command', label: '命令' }, { key: 'description', label: '说明' }],
    rows: [['/permission strict', '切换到非常严格的权限模式并保留说明']],
  };
  for (const columns of [120, 80, 55]) {
    const lines = formatBlockLines(block, capabilities(columns), columns - 4);
    assert.equal(lines.every(line => displayWidth(line) <= columns - 4), true);
  }
  const aligned = formatBlockLines(block, capabilities(80), 76)
    .filter(line => line.includes(' │ '));
  assert.equal(aligned.length, 2);
  assert.equal(
    displayWidth(aligned[0].slice(0, aligned[0].indexOf(' │ '))),
    displayWidth(aligned[1].slice(0, aligned[1].indexOf(' │ '))),
  );
  assert.match(formatBlockLines(block, capabilities(55), 51).join('\n'), /命令: \/permission/u);
});

test('ASCII 模式使用 ASCII 边界与列表标记', () => {
  const view = render(React.createElement(PresentationView, {
    item: createDocument({
      source: 'command', title: '列表', tone: 'info', blocks: [{ type: 'list', items: ['一', '二'] }],
    }),
    capabilities: capabilities(55, false),
  }));
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /^\+- /u);
  assert.match(frame, /- 一/u);
  assert.doesNotMatch(frame, /[╭╰•─]/u);
  view.unmount();
});
