import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ToolFailure } from './errors.js';
import { PathGuard } from './path-guard.js';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-path-'));
}

function assertFailure(action: () => unknown, code: string): void {
  assert.throws(action, error => {
    assert.ok(error instanceof ToolFailure);
    assert.equal(error.code, code);
    return true;
  });
}

test('PathGuard resolves in-root files and rejects traversal', t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'inside.txt'), 'inside');
  const guard = new PathGuard(root);

  assert.equal(guard.resolveExisting('inside.txt').relative, 'inside.txt');
  assertFailure(() => guard.resolveExisting('../outside.txt'), 'PATH_OUTSIDE_ROOT');
  assertFailure(() => guard.resolveExisting(path.join(root, 'inside.txt')), 'PATH_OUTSIDE_ROOT');
});

test('PathGuard rejects external and dangling symlinks', t => {
  const root = makeRoot();
  const outside = makeRoot();
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'external.txt'));
  symlinkSync(path.join(outside, 'missing.txt'), path.join(root, 'dangling.txt'));
  mkdirSync(path.join(outside, 'dir'));
  symlinkSync(path.join(outside, 'dir'), path.join(root, 'escape'), 'dir');

  const guard = new PathGuard(root);
  assertFailure(() => guard.resolveExisting('external.txt'), 'PATH_OUTSIDE_ROOT');
  assertFailure(() => guard.resolveForWrite('dangling.txt'), 'PATH_OUTSIDE_ROOT');
  assertFailure(() => guard.resolveForWrite('escape/new.txt'), 'PATH_OUTSIDE_ROOT');
});

test('PathGuard allows a symlink targeting a file inside root', t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'dir'));
  writeFileSync(path.join(root, 'dir', 'file.txt'), 'ok');
  symlinkSync(path.join(root, 'dir', 'file.txt'), path.join(root, 'link.txt'));

  const guard = new PathGuard(root);
  assert.equal(guard.resolveExisting('link.txt').relative, 'dir/file.txt');
});
