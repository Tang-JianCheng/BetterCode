import assert from 'node:assert/strict';
import test from 'node:test';
import stringWidth from 'string-width';
import { parseMarkdown } from './parser.js';
import { markdownLineText, renderMarkdown } from './renderer.js';
import type { MarkdownAst } from './types.js';

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
    assert.match(text, /一级标题/u);
    assert.doesNotMatch(text, /# 一级标题/u);
    assert.match(text, /\n \n/u);
    assert.match(text, /项目一/u);
    assert.match(text, /引用内容/u);
    assert.match(text, /ts/u);
  }
});

test('分隔线使用短横线且宽屏表格限制为 88 列', () => {
  const ast = parseMarkdown(
    '# 标题\n\n---\n\n| 命令 | 说明 |\n| --- | --- |\n| /help | 显示帮助 |\n',
  );
  const lines = renderMarkdown(ast, capabilities(120));
  const texts = lines.map(markdownLineText);
  const dividers = texts.filter(text => /^─+$/u.test(text));
  assert.ok(dividers.length >= 2);
  assert.ok(dividers.some(text => stringWidth(text) <= 28));
  for (const divider of dividers) {
    assert.equal(stringWidth(divider) <= 88, true, `分隔线超过 88 列: ${divider}`);
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

test('表格单元格内的行内代码按 Markdown 渲染', () => {
  const ast = parseMarkdown('| 命令 |\n| --- |\n| `SET key` |\n');
  const colorText = renderMarkdown(ast, capabilities(80)).map(markdownLineText).join('\n');
  assert.match(colorText, /SET key/u);
  assert.doesNotMatch(colorText, /`/u);

  const monoText = renderMarkdown(ast, capabilities(80, true, false)).map(markdownLineText).join('\n');
  assert.match(monoText, /`SET key`/u);
});

test('表格代码内 | 被正确合并且不显示原始反引号', () => {
  const ast = parseMarkdown('| 命令 |\n| --- |\n| `SET key [NX|XX]` |\n');
  const colorText = renderMarkdown(ast, capabilities(80)).map(markdownLineText).join('\n');
  assert.match(colorText, /SET key \[NX\|XX\]/u);
  assert.doesNotMatch(colorText, /`/u);
});

test('宽屏表格按内容自适应列宽并去掉外侧边框', () => {
  const ast = parseMarkdown(
    '| 操作 | 命令 |\n| --- | --- |\n| 设置键值 | `SET key value [NX|XX]` |\n| 获取键值 | `GET key` |\n',
  );
  const text = renderMarkdown(ast, capabilities(80)).map(markdownLineText).join('\n');
  assert.doesNotMatch(text, /^│/u);
  assert.doesNotMatch(text, /│$/u);
  assert.match(text, /操作\s+│\s+命令/u);
  assert.match(text, /设置键值\s+│\s+SET key value \[NX\|XX\]/u);
});

test('无颜色与 ASCII 模式使用文字标记且不输出 Unicode 装饰', () => {
  const ast = parseMarkdown('# 标题\n\n**加粗** 与 `code` 和 [链接](https://example.com)\n\n> 引用\n');
  const ascii = renderMarkdown(ast, capabilities(80, false, false));
  const text = ascii.map(markdownLineText).join('\n');
  assert.match(text, /标题/u);
  assert.doesNotMatch(text, /# 标题/u);
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

test('树形块按缩进渲染分支明细并弱化 token 数值', () => {
  const ast: MarkdownAst = {
    blocks: [{
      type: 'tree',
      lines: [
        { content: [{ type: 'text', content: 'MCP tools: 16.2k tokens (1.6%) · 2 tools' }], indent: 0, branch: false },
        {
          content: [
            { type: 'text', content: 'mcp_demo: ' },
            { type: 'del', children: [{ type: 'text', content: '421 tokens' }] },
          ],
          indent: 5,
          branch: true,
          prefix: '⛶ ⛶   ',
          color: 'warning',
        },
      ],
    }],
  };
  const lines = renderMarkdown(ast, capabilities(80));
  assert.equal(lines[0].indent, 0);
  assert.match(markdownLineText(lines[0]), /^MCP tools:/u);
  assert.equal(lines[1].indent, 5);
  assert.match(markdownLineText(lines[1]), /^⛶ ⛶   ├ mcp_demo: 421 tokens$/u);
  assert.equal(lines[1].segments[0].text, '⛶ ⛶   ');
  assert.equal(lines[1].segments[0].style, 'normal');
  assert.equal(lines[1].segments[1].text, '├ ');
  assert.equal(lines[1].segments.find(segment => segment.text === 'mcp_demo:')?.color, 'warning');
  const muted = lines[1].segments.filter(segment => segment.style === 'muted');
  const mutedText = muted.map(segment => segment.text).join('');
  assert.ok(mutedText.includes('├ '));
  assert.ok(mutedText.includes('421 tokens'));

  const colored = renderMarkdown({
    blocks: [{
      type: 'tree',
      lines: [{
        content: [{ type: 'text', content: 'deepseek-v4-flash[1M]' }],
        indent: 0,
        branch: false,
        prefixSegments: [
          { text: '⛁ ⛁', color: 'brand' },
          { text: ' ', color: 'muted' },
          { text: '⛶ ⛶', color: 'muted' },
          { text: '   ', color: 'muted' },
        ],
      }],
    }],
  }, capabilities(80));
  const prefix = colored[0].segments.slice(0, 4);
  assert.equal(prefix[0].color, 'brand');
  assert.equal(prefix[1].color, 'muted');
  assert.equal(prefix[2].color, 'muted');
  assert.match(markdownLineText(colored[0]), /^⛁ ⛁ ⛶ ⛶\s+deepseek-v4-flash/u);

  const ascii = renderMarkdown(ast, capabilities(80, false, false));
  assert.match(markdownLineText(ascii[1]), /^⛶ ⛶   \|- mcp_demo: ~~421 tokens~~$/u);
});
