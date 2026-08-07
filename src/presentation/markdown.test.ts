import assert from 'node:assert/strict';
import test from 'node:test';
import {
  presentationBlocksToMarkdown,
  presentationDocumentMarkdown,
  presentationNoticeMarkdown,
} from './markdown.js';

test('文档块转换为 Markdown AST，保留标题、表格与键值结构', () => {
  const ast = presentationDocumentMarkdown({
    title: '命令目录',
    badge: 'HELP',
    footer: '使用 /help <命令> 查看',
    blocks: [
      { type: 'text', content: '查看与本地操作', heading: true },
      {
        type: 'table',
        columns: [{ key: 'usage', label: '命令' }, { key: 'description', label: '说明' }],
        rows: [['/help', '显示帮助']],
      },
      { type: 'key_value', entries: [{ label: '模式', value: 'PLAN' }] },
    ],
  });
  assert.equal(ast.blocks.length, 5);
  const heading = ast.blocks[0];
  assert.equal(heading.type, 'heading');
  assert.equal(heading.level, 2);
  assert.match(
    heading.inline.map(node => node.type === 'text' ? node.content : '').join(''),
    /\[HELP\] 命令目录/u,
  );
  assert.equal(ast.blocks[1].type, 'heading');
  assert.equal(ast.blocks[2].type, 'table');
  assert.equal(ast.blocks[3].type, 'list');
  assert.equal(ast.blocks[4].type, 'paragraph');
});

test('列表、分隔线和通知内容转换为对应 Markdown 块', () => {
  const blocks = presentationBlocksToMarkdown([
    { type: 'list', items: ['一', '二'] },
    { type: 'divider' },
  ]);
  assert.equal(blocks[0].type, 'list');
  assert.equal(blocks[1].type, 'hr');

  const notice = presentationNoticeMarkdown({
    message: '当前为 strict',
    details: ['规则未命中'],
  });
  assert.ok(notice);
  assert.equal(notice.blocks[0].type, 'paragraph');
  assert.equal(notice.blocks[1].type, 'list');
  assert.equal(presentationNoticeMarkdown({}), undefined);
});

test('通知 message 保留多段与列表结构，不被截断成首段', () => {
  const notice = presentationNoticeMarkdown({
    message: [
      'MCP 启动: 已连接 1/3 个 Server，注册 2 个工具。',
      'MCP 诊断:',
      '- github: 连接失败',
      '- playwright: 启动失败',
      '安全边界: 外部 MCP Server 不受沙箱保护。',
    ].join('\n'),
  });
  assert.ok(notice);
  assert.equal(notice.blocks[0].type, 'paragraph');
  assert.equal(notice.blocks[1].type, 'list', '列表行应保留为列表块');
  assert.ok(notice.blocks[1].type === 'list' &&
    notice.blocks[1].items.length === 2, '两条诊断各为列表项');
  // 列表项正文（含续行并入的安全边界）不应丢失
  const listText = notice.blocks[1].type === 'list'
    ? JSON.stringify(notice.blocks[1].items)
    : '';
  assert.match(listText, /github: 连接失败/u);
  assert.match(listText, /playwright: 启动失败/u);
  assert.match(listText, /安全边界/u);
});

test('树形块转换为带缩进与分支标记的 Markdown 树', () => {
  const blocks = presentationBlocksToMarkdown([{
    type: 'tree',
    lines: [
      { content: 'MCP tools: 16.2k tokens (1.6%) · 2 tools' },
      {
        content: 'mcp_demo: ~~421 tokens~~',
        indent: 5,
        branch: true,
        prefix: '⛶ ⛶   ',
        prefixSegments: [{ text: '⛁ ⛁', color: 'brand' }, { text: '   ', color: 'muted' }],
        color: 'warning',
      },
    ],
  }]);
  assert.equal(blocks[0].type, 'tree');
  if (blocks[0].type === 'tree') {
    assert.equal(blocks[0].lines.length, 2);
    assert.equal(blocks[0].lines[0].indent, 0);
    assert.equal(blocks[0].lines[0].branch, false);
    assert.equal(blocks[0].lines[1].indent, 5);
    assert.equal(blocks[0].lines[1].branch, true);
    assert.equal(blocks[0].lines[1].prefix, '⛶ ⛶   ');
    assert.deepEqual(blocks[0].lines[1].prefixSegments,
      [{ text: '⛁ ⛁', color: 'brand' }, { text: '   ', color: 'muted' }]);
    assert.equal(blocks[0].lines[1].color, 'warning');
    assert.equal(blocks[0].lines[1].content[0].type, 'text');
    assert.equal(blocks[0].lines[1].content[1].type, 'del');
  }
});
