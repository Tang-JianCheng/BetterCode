import assert from 'node:assert/strict';
import test from 'node:test';
import stringWidth from 'string-width';
import { parseMarkdown } from './parser.js';
import { markdownLineText, renderMarkdown } from './renderer.js';

function capabilities(columns: number, unicode = true, color = true) {
  return { columns, unicode, color };
}

function assertWithinWidth(lines: ReturnType<typeof renderMarkdown>, columns: number): void {
  for (const line of lines) {
    assert.equal(
      stringWidth(markdownLineText(line)) <= columns,
      true,
      `行超过 ${columns} 列: ${markdownLineText(line)}`,
    );
  }
}

test('标题、列表、引用和代码块在三档宽度内有界', () => {
  const ast = parseMarkdown(
    "# 一级标题\n\n- 项目一\n- 项目二\n\n> 引用内容\n\n```ts\nconst veryLongVariableName = '这行必须被安全处理而不会横向溢出';\n```\n",
  );
  for (const columns of [120, 80, 55]) {
    const lines = renderMarkdown(ast, capabilities(columns));
    assertWithinWidth(lines, columns);
    const text = lines.map(markdownLineText).join('\n');
    assert.match(text, /# 一级标题/u);
    assert.match(text, /项目一/u);
    assert.match(text, /引用内容/u);
    assert.match(text, /ts/u);
  }
});

test('表格在宽屏紧凑展示并在窄屏降级为键值行', () => {
  const ast = parseMarkdown('| 命令 | 说明 |\n| --- | --- |\n| /help | 显示帮助 |\n| /status | 显示状态 |\n');
  const wide = renderMarkdown(ast, capabilities(80)).map(markdownLineText).join('\n');
  assert.match(wide, /│/u);
  assert.match(wide, /说明/u);
  assert.match(wide, /显示帮助/u);

  const narrow = renderMarkdown(ast, capabilities(55)).map(markdownLineText).join('\n');
  assert.match(narrow, /命令: \/help/u);
  assert.match(narrow, /说明: 显示帮助/u);
  assertWithinWidth(renderMarkdown(ast, capabilities(55)), 55);
});

test('无颜色与 ASCII 模式使用文字标记且不输出 Unicode 装饰', () => {
  const ast = parseMarkdown('**加粗** 与 `code` 和 [链接](https://example.com)\n\n> 引用\n');
  const ascii = renderMarkdown(ast, capabilities(80, false, false));
  const text = ascii.map(markdownLineText).join('\n');
  assert.match(text, /\*\*加粗\*\*/u);
  assert.match(text, /`code`/u);
  assert.match(text, /\(https:\/\/example\.com\)/u);
  assert.match(text, /> 引用/u);
  assert.doesNotMatch(text, /[•┊│─]/u);
});

test('HTML 与图片按纯文本占位展示', () => {
  const ast = parseMarkdown('<script>alert(1)</script>\n\n![alt 文本](https://example.com/a.png)');
  const text = renderMarkdown(ast, capabilities(80)).map(markdownLineText).join('\n');
  assert.match(text, /<script>alert\(1\)<\/script>/u);
  assert.match(text, /\[alt 文本\]\(https:\/\/example\.com\/a\.png\)/u);
});
