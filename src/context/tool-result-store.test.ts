import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { ToolResultStore } from './tool-result-store.js';

async function temporaryRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'bettercode-context-'));
}

test('结果目录惰性创建并限制在项目根内', async t => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ToolResultStore(root);
  assert.rejects(lstat(path.join(root, '.bettercode/context')));

  const [stored] = await store.writeBatch([
    { toolCallId: 'one', toolName: 'read_file', content: '原始内容' },
  ], new AbortController().signal);
  assert.match(stored.relativePath, /^\.bettercode\/context\/session-[^/]+\/tool-results\//);
  assert.equal(await readFile(path.join(root, stored.relativePath), 'utf8'), '原始内容');
  assert.equal(stored.originalBytes, Buffer.byteLength('原始内容'));
  assert.equal(stored.sha256.length, 64);

  const directoryStat = await lstat(path.dirname(path.join(root, stored.relativePath)));
  const fileStat = await lstat(path.join(root, stored.relativePath));
  assert.equal(directoryStat.mode & 0o777, 0o700);
  assert.equal(fileStat.mode & 0o777, 0o600);
});

test('批量写入内容、哈希和会话隔离保持稳定', async t => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = new ToolResultStore(root);
  const second = new ToolResultStore(root);
  const signal = new AbortController().signal;
  const stored = await first.writeBatch([
    { toolCallId: 'one', toolName: 'bash', content: '一' },
    { toolCallId: 'two', toolName: 'bash', content: '二\n' },
  ], signal);
  const [other] = await second.writeBatch([
    { toolCallId: 'three', toolName: 'bash', content: '三' },
  ], signal);
  assert.notEqual(stored[0].relativePath.split('/')[2], other.relativePath.split('/')[2]);
  assert.deepEqual(await Promise.all(stored.map(item =>
    readFile(path.join(root, item.relativePath), 'utf8'))), ['一', '二\n']);
});

test('取消写入不创建结果，关闭后拒绝写入', async t => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ToolResultStore(root);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    store.writeBatch([{ toolCallId: 'one', toolName: 'bash', content: '内容' }], controller.signal),
    /已取消/,
  );
  await store.close();
  await store.close();
  await assert.rejects(
    store.writeBatch([{ toolCallId: 'one', toolName: 'bash', content: '内容' }], new AbortController().signal),
    /已关闭/,
  );
});

test('clear 只删除当前会话并允许创建新会话', async t => {
  const root = await temporaryRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.bettercode'), { recursive: true });
  await writeFile(path.join(root, '.bettercode/mcp.yaml'), '保留');
  const store = new ToolResultStore(root);
  const [first] = await store.writeBatch([
    { toolCallId: 'one', toolName: 'bash', content: '旧内容' },
  ], new AbortController().signal);
  await store.clear();
  await assert.rejects(readFile(path.join(root, first.relativePath)));
  assert.equal(await readFile(path.join(root, '.bettercode/mcp.yaml'), 'utf8'), '保留');
  const [second] = await store.writeBatch([
    { toolCallId: 'two', toolName: 'bash', content: '新内容' },
  ], new AbortController().signal);
  assert.notEqual(first.relativePath.split('/')[2], second.relativePath.split('/')[2]);
});

test('上下文目录符号链接会被拒绝', async t => {
  const root = await temporaryRoot();
  const outside = await temporaryRoot();
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]));
  await mkdir(path.join(root, '.bettercode'), { recursive: true });
  await symlink(outside, path.join(root, '.bettercode/context'));
  const store = new ToolResultStore(root);
  await assert.rejects(
    store.writeBatch([{ toolCallId: 'one', toolName: 'bash', content: '秘密' }], new AbortController().signal),
    /不安全|符号链接/,
  );
  await assert.rejects(readFile(path.join(outside, '秘密')));
});
