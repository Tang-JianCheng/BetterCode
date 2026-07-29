import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommandInput } from './parser.js';

test('命令解析区分空输入、普通输入和斜杠命令', () => {
  assert.deepEqual(parseCommandInput('   '), { status: 'empty' });
  assert.deepEqual(parseCommandInput('普通任务'), { status: 'not_command' });
  assert.deepEqual(parseCommandInput(' /HeLp  session '), {
    status: 'command',
    command: { raw: '/HeLp  session', name: 'help', args: 'session' },
  });
});

test('命令解析只拆第一个空白并保留参数内部空格', () => {
  assert.deepEqual(parseCommandInput('/review src/chat  manager.ts'), {
    status: 'command',
    command: {
      raw: '/review src/chat  manager.ts',
      name: 'review',
      args: 'src/chat  manager.ts',
    },
  });
  assert.deepEqual(parseCommandInput('/'), {
    status: 'command',
    command: { raw: '/', name: '', args: '' },
  });
});
