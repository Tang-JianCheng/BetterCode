import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { parseMarkdown } from '../markdown/parser.js';
import { createConversation, createDocument, createNotice } from '../presentation/builders.js';
import { PresentationView } from './presentation-view.js';
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

function renderItem(
  item: Parameters<typeof PresentationView>[0]['item'],
  caps: TerminalCapabilities,
): string {
  const view = render(React.createElement(PresentationView, { item, capabilities: caps }));
  const frame = view.lastFrame() ?? '';
  view.unmount();
  return frame;
}

test('普通对话保持轻量，通知和命令文档统一走 Markdown 展示', () => {
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
  const documentFrame = document.lastFrame() ?? '';
  assert.match(documentFrame, /\[HELP\] 命令目录/u);
  assert.match(documentFrame, /• 模式: PLAN/u);
  assert.doesNotMatch(documentFrame, /[╭╰]/u);
  document.unmount();
});

test('助手消息携带 markdown 时渲染 Markdown，用户消息保持纯文本', () => {
  const content = '# 标题\n\n[链接](https://example.com)';
  const assistant = renderItem(createConversation({
    role: 'assistant',
    content,
    markdown: parseMarkdown(content),
  }), capabilities(100));
  assert.match(assistant, /标题/u);
  assert.doesNotMatch(assistant, /# 标题/u);
  assert.match(assistant, /链接 \(https:\/\/example\.com\)/u);

  const user = renderItem(createConversation({ role: 'user', content }), capabilities(100));
  assert.match(user, /❯ # 标题/u);
  assert.match(user, /\[链接\]\(https:\/\/example\.com\)/u);
  assert.doesNotMatch(user, /链接 \(https:\/\/example\.com\)/u);
});

test('命令文档在三档宽度内保持有界并在窄屏降级为键值行', () => {
  const item = createDocument({
    source: 'command', title: '命令目录', tone: 'info', badge: 'HELP',
    blocks: [{
      type: 'table',
      columns: [{ key: 'command', label: '命令' }, { key: 'description', label: '说明' }],
      rows: [['/permission strict', '切换到非常严格的权限模式并保留说明']],
    }],
  });
  for (const columns of [120, 80, 55]) {
    const frame = renderItem(item, capabilities(columns));
    for (const line of frame.split('\n')) {
      assert.equal(displayWidth(line) <= columns, true, `行超过 ${columns} 列: ${line}`);
    }
  }
  assert.match(renderItem(item, capabilities(55)), /命令: \/permission/u);
});

test('ASCII 模式不使用 Unicode 装饰并保留列表标记', () => {
  const frame = renderItem(createDocument({
    source: 'command', title: '列表', tone: 'info', blocks: [{ type: 'list', items: ['一', '二'] }],
  }), capabilities(55, false));
  assert.match(frame, /- 一/u);
  assert.doesNotMatch(frame, /[╭╰•─│]/u);
});

test('命令表格在超宽终端限制为 88 列', () => {
  const item = createDocument({
    source: 'command', title: '命令目录', tone: 'info', badge: 'HELP',
    blocks: [{
      type: 'table',
      columns: [{ key: 'command', label: '命令' }, { key: 'description', label: '说明' }],
      rows: [['/help', '显示命令帮助']],
    }],
  });
  const frame = renderItem(item, capabilities(120));
  for (const line of frame.split('\n')) {
    assert.equal(displayWidth(line) <= 88, true, `行超过 88 列: ${line}`);
  }
});

test('树形明细块渲染出缩进与分支线', () => {
  const item = createDocument({
    source: 'command', title: '上下文使用', tone: 'info', badge: 'CONTEXT',
    blocks: [{
      type: 'tree',
      lines: [
        { content: 'MCP tools: 16.2k tokens (1.6%) · 2 tools' },
        { content: 'mcp_demo: 421 tokens', indent: 5, branch: true },
      ],
    }],
  });
  assert.match(renderItem(item, capabilities(100)), /MCP tools: 16\.2k tokens/u);
  assert.match(renderItem(item, capabilities(100)), /     ├ mcp_demo: 421 tokens/u);
  assert.match(renderItem(item, capabilities(100, false)), /     \|- mcp_demo: 421 tokens/u);
});

test('Apple Terminal 下用户消息与思考内容中的破折号被替换', () => {
  const user = renderItem(createConversation({ role: 'user', content: '你好—世界' }), {
    ...capabilities(100), appleTerminal: true,
  });
  assert.doesNotMatch(user, /—/u);
  assert.match(user, /你好--世界/u);

  const thinkingFrame = renderItem(createConversation({
    role: 'assistant', content: '正文', thinking: '思考—草稿',
  }), { ...capabilities(100), appleTerminal: true });
  assert.doesNotMatch(thinkingFrame, /—/u);
  assert.match(thinkingFrame, /思考--草稿/u);
});

test('纯文本消息与思考按列宽硬换行，避免超长单行', () => {
  const content = 'A'.repeat(120) + ' ' + 'B'.repeat(50);
  const frame = renderItem(createConversation({ role: 'assistant', content }), capabilities(80));
  for (const line of frame.split('\n')) {
    assert.ok(displayWidth(line) <= 80, `行超过 80 列: ${line.slice(0, 40)}`);
  }
  assert.equal(frame.replace(/\n/gu, '').replace(/ /gu, ''), content.replace(/ /gu, ''));

  const thinking = '思'.repeat(120);
  const thinkingFrame = renderItem(createConversation({
    role: 'assistant', content: '正文', thinking,
  }), { ...capabilities(60), appleTerminal: true });
  for (const line of thinkingFrame.split('\n')) {
    assert.ok(displayWidth(line) <= 60, `思考行超过 60 列: ${line.slice(0, 40)}`);
  }
});
