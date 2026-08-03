import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdown } from '../markdown/parser.js';
import { createConversation, createDocument, createNotice } from './builders.js';

test('展示构造器保留合法结构与对话原文', () => {
  const document = createDocument({
    source: 'command',
    title: '  命令帮助  ',
    tone: 'info',
    blocks: [{
      type: 'table',
      columns: [{ key: 'name', label: '命令' }, { key: 'description', label: '说明' }],
      rows: [['/help', '显示帮助']],
    }],
  });
  assert.equal(document.title, '命令帮助');
  assert.equal(document.kind, 'document');
  assert.ok(document.markdown);

  const content = '  第一行\n第二行  ';
  assert.equal(createConversation({ role: 'assistant', content }).content, content);
  const markdown = parseMarkdown('# 标题\n\n正文');
  const rendered = createConversation({ role: 'assistant', content, markdown });
  assert.equal(rendered.markdown, markdown);
  assert.equal(rendered.content, content);
  assert.deepEqual(createNotice({ tone: 'success', title: ' 完成 ', details: [] }), {
    kind: 'notice', tone: 'success', title: '完成', message: undefined, details: undefined,
  });
});

test('展示构造器拒绝空标题、错列表格和无界详情', () => {
  assert.throws(() => createNotice({ tone: 'info', title: '  ' }), /标题不能为空/u);
  assert.throws(() => createDocument({
    source: 'system', title: '错误表格', tone: 'danger', blocks: [{
      type: 'table', columns: [{ key: 'a', label: 'A' }], rows: [['a', 'b']],
    }],
  }), /行列数量不一致/u);
  assert.throws(() => createNotice({
    tone: 'warning', title: '太多详情', details: Array.from({ length: 21 }, (_, index) => `${index}`),
  }), /不能超过 20 条/u);
});
