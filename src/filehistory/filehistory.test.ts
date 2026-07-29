import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileHistory, MAX_SNAPSHOTS } from './filehistory.js';

test('文件历史可恢复修改文件并删除快照后新建文件', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-filehistory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'existing.txt'), '旧内容');
  const history = new FileHistory(root, 'session-one');
  history.makeSnapshot(3, '修改文件');
  history.trackEdit('existing.txt');
  history.trackEdit('created.txt');
  writeFileSync(path.join(root, 'existing.txt'), '新内容');
  writeFileSync(path.join(root, 'created.txt'), '新文件');
  assert.deepEqual(history.rewind(0), ['created.txt', 'existing.txt']);
  assert.equal(readFileSync(path.join(root, 'existing.txt'), 'utf8'), '旧内容');
  assert.equal(existsSync(path.join(root, 'created.txt')), false);
});

test('文件历史状态可重载且快照数量有界', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-filehistory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const history = new FileHistory(root, 'session-two');
  for (let index = 0; index < MAX_SNAPSHOTS + 5; index += 1) {
    history.makeSnapshot(index, `消息 ${index}`);
  }
  assert.equal(history.getSnapshots().length, MAX_SNAPSHOTS);
  const restored = new FileHistory(root, 'session-two');
  assert.equal(restored.getSnapshots().length, MAX_SNAPSHOTS);
  assert.equal(restored.getSnapshots().at(-1)?.userText, `消息 ${MAX_SNAPSHOTS + 4}`);
});
