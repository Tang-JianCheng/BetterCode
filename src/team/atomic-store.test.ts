import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AtomicJsonStore, isRevisionedRecord } from './atomic-store.js';
import { TeamError } from './errors.js';

interface TestRecord {
  version: 1;
  revision: number;
  value: string;
}

function valid(value: unknown): value is TestRecord {
  return isRevisionedRecord(value) && (value as TestRecord).version === 1 &&
    typeof (value as TestRecord).value === 'string';
}

test('原子存储创建并按 revision 更新', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-team-store-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new AtomicJsonStore<TestRecord>(path.join(root, 'state.json'), valid);
  const first = store.write({ version: 1, revision: 0, value: 'one' }, 0);
  assert.equal(first.revision, 1);
  const second = store.write({ ...first, value: 'two' }, 1);
  assert.equal(second.revision, 2);
  assert.equal(store.read()?.value, 'two');
  assert.equal(JSON.parse(readFileSync(store.file, 'utf8')).revision, 2);
});

test('原子存储拒绝冲突和损坏数据', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-team-store-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'state.json');
  const store = new AtomicJsonStore<TestRecord>(file, valid);
  store.write({ version: 1, revision: 0, value: 'one' }, 0);
  assert.throws(() => store.write({ version: 1, revision: 0, value: 'stale' }, 0), (error: unknown) =>
    error instanceof TeamError && error.code === 'TEAM_CONFLICT');
  writeFileSync(file, '{ bad json');
  assert.throws(() => store.read(), (error: unknown) =>
    error instanceof TeamError && error.code === 'TEAM_DATA_CORRUPT');
});
