import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TeamPathGuard } from './path-guard.js';

test('团队与成员名称使用严格字符边界', t => {
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-team-path-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const guard = new TeamPathGuard(home);
  assert.equal(guard.teamName(' Alpha-Team '), 'alpha-team');
  assert.equal(guard.memberName('Reviewer_1'), 'reviewer_1');
  for (const name of ['', '.', '..', '../x', 'a/b', '含中文', 'a'.repeat(65)]) {
    assert.throws(() => guard.teamName(name), /名称/);
  }
  assert.throws(() => guard.memberName('lead'), /保留身份/);
});

test('团队路径拒绝用户目录外部符号链接', t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'bettercode-team-symlink-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const home = path.join(parent, 'home');
  const outside = path.join(parent, 'outside');
  mkdirSync(home);
  mkdirSync(outside);
  const guard = new TeamPathGuard(home);
  guard.ensureRoot();
  symlinkSync(outside, path.join(guard.rootDir, 'escaped'));
  assert.throws(() => guard.team('escaped'), /超出/);
});
