import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePasteNewlines, RawInputParser } from './raw-input.js';

test('普通字符分片合并成单个文本事件', () => {
  const parser = new RawInputParser();
  assert.deepEqual(parser.push('hello'), [{ kind: 'text', text: 'hello' }]);
});

test('回车与换行都映射为提交事件', () => {
  const parser = new RawInputParser();
  assert.deepEqual(parser.push('\r'), [{ kind: 'return' }]);
  assert.deepEqual(parser.push('\n'), [{ kind: 'return' }]);
});

test('Shift+Enter 与 Option+Enter 映射为换行', () => {
  const parser = new RawInputParser();
  assert.deepEqual(parser.push('\x1b[13;2u'), [{ kind: 'newline' }]);
  assert.deepEqual(parser.push('\x1b[13;3u'), [{ kind: 'newline' }]);
  assert.deepEqual(parser.push('\x1b\r'), [{ kind: 'newline' }]);
});

test('Ctrl+Enter 仍按提交处理', () => {
  const parser = new RawInputParser();
  assert.deepEqual(parser.push('\x1b[13;4u'), [{ kind: 'return' }]);
});

test('方向键、Tab、Backspace、Delete 与 Esc 事件', () => {
  const parser = new RawInputParser();
  assert.deepEqual(parser.push('\x1b[A'), [{ kind: 'up' }]);
  assert.deepEqual(parser.push('\x1b[B'), [{ kind: 'down' }]);
  assert.deepEqual(parser.push('\x1b[C'), [{ kind: 'right' }]);
  assert.deepEqual(parser.push('\x1b[D'), [{ kind: 'left' }]);
  assert.deepEqual(parser.push('\x1bOA'), [{ kind: 'up' }]);
  assert.deepEqual(parser.push('\t'), [{ kind: 'tab' }]);
  assert.deepEqual(parser.push('\x1b[Z'), [{ kind: 'shifttab' }]);
  assert.deepEqual(parser.push('\b'), [{ kind: 'backspace' }]);
  assert.deepEqual(parser.push('\x7f'), [{ kind: 'backspace' }]);
  assert.deepEqual(parser.push('\x1b[3~'), [{ kind: 'delete' }]);
  assert.deepEqual(parser.push('\x1b'), [{ kind: 'escape' }]);
});

test('括号粘贴内容原样透传，换行统一为 \\n', () => {
  const parser = new RawInputParser();
  const events = parser.push('\x1b[200~第一行\r\n第二行\r\x1b[201~');
  assert.deepEqual(events, [{ kind: 'paste', text: '第一行\n第二行\n' }]);
});

test('粘贴标记分片到达也能正确合并', () => {
  const parser = new RawInputParser();
  assert.deepEqual(parser.push('\x1b[200~hello'), []);
  assert.deepEqual(parser.push(' wor'), []);
  assert.deepEqual(parser.push('ld\x1b[201~'), [{ kind: 'paste', text: 'hello world' }]);
});

test('粘贴结束后的剩余按键继续解析', () => {
  const parser = new RawInputParser();
  const events = parser.push('\x1b[200~abc\x1b[201~\r');
  assert.deepEqual(events, [
    { kind: 'paste', text: 'abc' },
    { kind: 'return' },
  ]);
});

test('控制字符在非粘贴场景被忽略而不污染输入', () => {
  const parser = new RawInputParser();
  assert.deepEqual(parser.push('a\x03b'), [
    { kind: 'text', text: 'a' },
    { kind: 'ignore' },
    { kind: 'text', text: 'b' },
  ]);
});

test('未知转义序列整体丢弃，避免垃圾文本混入', () => {
  const parser = new RawInputParser();
  assert.deepEqual(parser.push('x\x1b[31my'), [
    { kind: 'text', text: 'x' },
    { kind: 'text', text: 'y' },
  ]);
});

test('未发完的转义序列跨分片等待后解析', () => {
  const parser = new RawInputParser();
  assert.deepEqual(parser.push('\x1b[13'), []);
  assert.deepEqual(parser.push(';2u'), [{ kind: 'newline' }]);
});

test('normalizePasteNewlines 统一换行符', () => {
  assert.equal(normalizePasteNewlines('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(normalizePasteNewlines('纯文本'), '纯文本');
});
