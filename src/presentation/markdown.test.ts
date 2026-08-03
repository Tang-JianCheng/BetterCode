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
