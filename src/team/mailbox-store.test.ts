import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MailboxStore } from './mailbox-store.js';
import type { TeamMessage } from './types.js';

const options = { lockTimeoutMs: 1_000, retryIntervalMs: 5, staleLockMs: 200 };

function message(id: string): TeamMessage {
  return {
    id, type: 'text', sender: 'lead', recipient: 'worker', body: id, summary: id,
    timestamp: new Date().toISOString(), read: false,
  };
}

test('并发邮箱追加不丢失消息', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-team-mailbox-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'worker.jsonl');
  const stores = [new MailboxStore(file, options), new MailboxStore(file, options)];
  await Promise.all(Array.from({ length: 30 }, (_, index) => stores[index % 2].append(message(`m-${index}`))));
  const all = stores[0].readAll();
  assert.equal(all.length, 30);
  assert.equal(new Set(all.map(item => item.id)).size, 30);
});

test('邮箱已读更新保持其他消息并跳过残缺尾行', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-team-mailbox-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'worker.jsonl');
  const store = new MailboxStore(file, options);
  await store.append(message('one'));
  await store.append(message('two'));
  await store.markRead(['one']);
  assert.deepEqual(store.unread().map(item => item.id), ['two']);
  appendFileSync(file, '{ unfinished');
  assert.deepEqual(store.readAll().map(item => item.id), ['one', 'two']);
});
