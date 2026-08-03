import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdown, sanitizeText, tryParseMarkdown } from './parser.js';
import type { MarkdownBlock } from './types.js';

function collectParagraphs(blocks: readonly MarkdownBlock[]): MarkdownBlock[] {
  return blocks.flatMap(block => {
    if (block.type === 'paragraph') return [block];
    if (block.type === 'list') return block.items.flatMap(item => collectParagraphs(item.blocks));
    if (block.type === 'quote') return collectParagraphs(block.blocks);
    return [];
  });
}

test('解析常见 Markdown 块级与行内语法', () => {
  const ast = parseMarkdown(
    '# 标题\n\n正文包含 **粗体**、*斜体*、`代码` 和 [链接](https://example.com)。\n\n' +
    '- 第一项\n- 第二项\n\n```ts\nconst value = 1;\n```\n\n> 引用\n',
  );
  const headings = ast.blocks.filter(block => block.type === 'heading');
  assert.equal(headings.length, 1);
  assert.equal(headings[0].type === 'heading' && headings[0].level, 1);

  const paragraphs = ast.blocks.filter(block => block.type === 'paragraph');
  assert.ok(paragraphs.some(block => block.type === 'paragraph' &&
    block.inline.some(inline => inline.type === 'strong')));
  assert.ok(paragraphs.some(block => block.type === 'paragraph' &&
    block.inline.some(inline => inline.type === 'code')));
  assert.ok(paragraphs.some(block => block.type === 'paragraph' &&
    block.inline.some(inline => inline.type === 'link')));

  const list = ast.blocks.find(block => block.type === 'list');
  assert.equal(list?.type === 'list' && list.items.length, 2);
  const code = ast.blocks.find(block => block.type === 'code');
  assert.equal(code?.type === 'code' && code.language, 'ts');
  const quote = ast.blocks.find(block => block.type === 'quote');
  assert.equal(quote?.type, 'quote');
});

test('原始 HTML 与 ANSI 控制序列按纯文本安全处理', () => {
  const ast = parseMarkdown('<script>alert(1)</script>\n\n`\u001B[31mred\u001B[0m`');
  const html = ast.blocks.find(block => block.type === 'html');
  assert.equal(html?.type === 'html' && html.content, '<script>alert(1)</script>');
  const paragraph = ast.blocks.find(block => block.type === 'paragraph');
  const code = paragraph?.type === 'paragraph'
    ? paragraph.inline.find(inline => inline.type === 'code')
    : undefined;
  assert.equal(code?.type === 'code' && code.content, 'red');
});

test('列表项中的行内代码按行内语法解析', () => {
  const ast = parseMarkdown('- 支持的命令：\n  - `XADD` 添加事件\n');
  const paragraphs = collectParagraphs(ast.blocks);
  assert.ok(paragraphs.some(block => block.type === 'paragraph' &&
    block.inline.some(inline => inline.type === 'code' && inline.content === 'XADD')));
});

test('表格单元格行内代码解析为 code 节点', () => {
  const ast = parseMarkdown('| 命令 |\n| --- |\n| `SET key` |\n');
  const table = ast.blocks.find(block => block.type === 'table');
  assert.ok(table?.type === 'table');
  assert.ok(table.rows[0].some(cell =>
    cell.some(inline => inline.type === 'code' && inline.content === 'SET key')));
});

test('表格代码内的 | 不被当作列分隔符', () => {
  const ast = parseMarkdown('| 命令 |\n| --- |\n| `SET key [NX|XX]` |\n');
  const table = ast.blocks.find(block => block.type === 'table');
  assert.ok(table?.type === 'table');
  assert.equal(table.rows[0].length, table.header.length);
  assert.ok(table.rows[0][0].some(inline =>
    inline.type === 'code' && inline.content === 'SET key [NX|XX]'));
});

test('空输入与异常输入返回稳定 AST', () => {
  assert.deepEqual(parseMarkdown(''), { blocks: [] });
  assert.equal(sanitizeText('\u001B[31m文字\u001B[0m'), '文字');
  assert.equal(parseMarkdown('普通文本').blocks.length, 1);
  assert.equal(tryParseMarkdown('# 标题').recovered, false);
  assert.equal(tryParseMarkdown('# 标题').ast.blocks.length, 1);

  let calls = 0;
  const brokenInput = {
    toString() {
      calls += 1;
      if (calls === 1) throw new Error('解析器异常');
      return '# 标题';
    },
  } as unknown as string;
  const recovered = tryParseMarkdown(brokenInput);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.ast.blocks.length, 1);
});
