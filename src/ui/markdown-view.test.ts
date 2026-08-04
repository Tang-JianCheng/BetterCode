import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { parseMarkdown } from '../markdown/parser.js';
import { displayWidth, type TerminalCapabilities } from './capabilities.js';
import { MarkdownView } from './markdown-view.js';

function capabilities(columns: number, unicode = true, color = false): TerminalCapabilities {
  return {
    columns,
    density: columns >= 100 ? 'full' : columns >= 64 ? 'compact' : 'narrow',
    color,
    unicode,
    motion: false,
  };
}

function frameText(source: string, caps: TerminalCapabilities): string {
  const view = render(React.createElement(MarkdownView, {
    ast: parseMarkdown(source),
    capabilities: caps,
  }));
  const frame = view.lastFrame() ?? '';
  view.unmount();
  return frame;
}

test('标题、列表、引用、代码块与表格在 120 列完整渲染', () => {
  const source = '# 标题\n\n正文 **粗体** 与 `代码` 和 [链接](https://example.com)。\n\n' +
    '- 项目一\n- 项目二\n\n> 引用\n\n```ts\nconst x = 1;\n```\n\n' +
    '| 命令 | 说明 |\n| --- | --- |\n| /help | 帮助 |\n';
  const frame = frameText(source, capabilities(120));
  assert.match(frame, /标题/u);
  assert.doesNotMatch(frame, /# 标题/u);
  assert.match(frame, /粗体/u);
  assert.match(frame, /代码/u);
  assert.match(frame, /链接 \(https:\/\/example\.com\)/u);
  assert.match(frame, /• 项目一/u);
  assert.match(frame, /┊ 引用/u);
  assert.match(frame, /┌─ ts/u);
  assert.match(frame, /│ 说明/u);
});

test('80 与 55 列均不越界，窄屏表格降级为键值行', () => {
  const source = '# 标题\n\n- 项目一\n- 项目二\n\n> 引用内容\n\n' +
    "```ts\nconst veryLongVariableName = '这行必须被安全处理而不会横向溢出';\n```\n\n" +
    '| 命令 | 说明 |\n| --- | --- |\n| /help | 显示帮助 |\n';
  for (const columns of [80, 55]) {
    const caps = capabilities(columns);
    const view = render(React.createElement(MarkdownView, {
      ast: parseMarkdown(source),
      capabilities: caps,
    }));
    const frame = view.lastFrame() ?? '';
    for (const line of frame.split('\n')) {
      assert.equal(displayWidth(line) <= columns, true, `行超过 ${columns} 列: ${line}`);
    }
    view.unmount();
  }
  assert.match(frameText(source, capabilities(55)), /命令: \/help/u);
});

test('无颜色保留文字语义，ASCII 不使用 Unicode 装饰', () => {
  const source = '**加粗** 与 `code` 和 [链接](https://example.com)\n\n> 引用\n';
  const mono = frameText(source, capabilities(80, true, false));
  assert.match(mono, /\*\*加粗\*\*/u);
  assert.match(mono, /`code`/u);
  assert.match(mono, /┊ 引用/u);

  const ascii = frameText(source, capabilities(80, false, false));
  assert.doesNotMatch(ascii, /[•┊│─]/u);
  assert.match(ascii, /> 引用/u);
});

test('彩色模式下标题省略 # 标记', () => {
  const frame = frameText('# 标题\n\n正文', capabilities(80, true, true));
  assert.match(frame, /标题/u);
  assert.doesNotMatch(frame, /# 标题/u);
});

test('Apple Terminal 下正文与思考中的破折号以 ASCII 展示', () => {
  const safe = frameText('正文——带破折号', { ...capabilities(80), appleTerminal: true });
  assert.doesNotMatch(safe, /—/u);
  assert.match(safe, /----/u);

  const normal = frameText('正文——带破折号', capabilities(80));
  assert.match(normal, /——/u);

  const view = render(React.createElement(MarkdownView, {
    ast: parseMarkdown('正文'),
    capabilities: { ...capabilities(80), appleTerminal: true },
    thinking: '思路—草稿',
  }));
  const thinkingFrame = view.lastFrame() ?? '';
  view.unmount();
  assert.doesNotMatch(thinkingFrame, /—/u);
  assert.match(thinkingFrame, /思路--草稿/u);
});
