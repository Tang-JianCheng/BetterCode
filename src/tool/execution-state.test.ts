import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolExecutionState } from './execution-state.js';

test('文件读取缓存按 size 和 mtime 指纹命中并失效', () => {
  const state = new ToolExecutionState();
  state.setFileRead({ absolutePath: '/root/a.txt', size: 3, mtimeMs: 1, content: 'one' });
  assert.equal(state.getFileRead('/root/a.txt', 3, 1), 'one');
  assert.equal(state.getFileRead('/root/a.txt', 4, 1), undefined);
  state.setFileRead({ absolutePath: '/root/a.txt', size: 3, mtimeMs: 2, content: 'two' });
  assert.equal(state.getFileRead('/root/a.txt', 3, 1), undefined);
});

test('文件读取缓存支持单路径、全量清理和实例隔离', () => {
  const left = new ToolExecutionState();
  const right = new ToolExecutionState();
  for (const state of [left, right]) {
    state.setFileRead({ absolutePath: '/root/a.txt', size: 1, mtimeMs: 1, content: 'a' });
    state.setFileRead({ absolutePath: '/root/b.txt', size: 1, mtimeMs: 1, content: 'b' });
  }
  left.invalidateFile('/root/a.txt');
  assert.equal(left.getFileRead('/root/a.txt', 1, 1), undefined);
  assert.equal(right.getFileRead('/root/a.txt', 1, 1), 'a');
  left.invalidateAllFiles();
  assert.equal(left.getFileRead('/root/b.txt', 1, 1), undefined);
  assert.equal(right.getFileRead('/root/b.txt', 1, 1), 'b');
});

test('文件读取缓存按绝对路径隔离不同工作区', () => {
  const state = new ToolExecutionState();
  state.setFileRead({ absolutePath: '/left/src/file.ts', size: 2, mtimeMs: 1, content: 'left' });
  state.setFileRead({ absolutePath: '/right/src/file.ts', size: 2, mtimeMs: 1, content: 'right' });

  assert.equal(state.getFileRead('/left/src/file.ts', 2, 1), 'left');
  assert.equal(state.getFileRead('/right/src/file.ts', 2, 1), 'right');
  state.invalidateFile('/left/src/file.ts');
  assert.equal(state.getFileRead('/left/src/file.ts', 2, 1), undefined);
  assert.equal(state.getFileRead('/right/src/file.ts', 2, 1), 'right');
});
