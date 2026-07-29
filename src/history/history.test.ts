import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { append, load, MAX_ENTRIES } from './history.js';

test('Prompt 历史持久化、相邻去重、坏行跳过和容量限制', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  append(root, '第一条');
  append(root, '第一条');
  append(root, '第二条');
  const file = path.join(root, '.bettercode/prompt_history.jsonl');
  appendFileSync(file, '{ bad json\n');
  assert.deepEqual(load(root), ['第一条', '第二条']);
  for (let index = 0; index < MAX_ENTRIES + 10; index += 1) append(root, `消息-${index}`);
  const loaded = load(root);
  assert.equal(loaded.length, MAX_ENTRIES);
  assert.equal(loaded.at(-1), `消息-${MAX_ENTRIES + 9}`);
  assert.doesNotThrow(() => readFileSync(file, 'utf8').trim().split('\n').forEach(line => JSON.parse(line)));
});
