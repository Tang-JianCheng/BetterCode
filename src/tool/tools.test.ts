import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCoreToolRegistry } from './factory.js';
import type { ToolResult } from './types.js';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-tools-'));
}

async function call(root: string, name: string, arguments_: Record<string, unknown>, options = {}) {
  const registry = createCoreToolRegistry(root, { timeoutMs: 1000, maxOutputBytes: 64 * 1024, ...options });
  return registry.execute({ id: `${name}-1`, name, arguments: arguments_ });
}

test('read, write and edit tools handle normal and unique replacement paths', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const write = await call(root, 'write_file', { path: 'nested/file.txt', content: 'alpha beta' });
  assert.equal(write.ok, true);
  assert.equal(readFileSync(path.join(root, 'nested/file.txt'), 'utf8'), 'alpha beta');

  const read = await call(root, 'read_file', { path: 'nested/file.txt' });
  assert.equal(read.ok, true);
  assert.equal(read.output, 'alpha beta');

  const edit = await call(root, 'edit_file', {
    path: 'nested/file.txt',
    old_text: 'beta',
    new_text: 'gamma',
  });
  assert.equal(edit.ok, true);
  assert.equal(readFileSync(path.join(root, 'nested/file.txt'), 'utf8'), 'alpha gamma');
});

test('edit_file refuses zero and multiple matches without changing content', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'file.txt'), 'same\nsame');

  const missing = await call(root, 'edit_file', { path: 'file.txt', old_text: 'none', new_text: 'x' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error?.code, 'MATCH_NOT_FOUND');

  const multiple = await call(root, 'edit_file', { path: 'file.txt', old_text: 'same', new_text: 'x' });
  assert.equal(multiple.ok, false);
  assert.equal(multiple.error?.code, 'MATCH_NOT_UNIQUE');
  assert.equal(readFileSync(path.join(root, 'file.txt'), 'utf8'), 'same\nsame');
});

test('find_files and search_code return stable project-relative results', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'b.ts'), 'const needle = 1;\n');
  writeFileSync(path.join(root, 'a.ts'), 'const other = 2;\nneedle();\n');
  writeFileSync(path.join(root, 'data.bin'), Buffer.from([0xff, 0x00]));

  const files = await call(root, 'find_files', { pattern: '*.ts' });
  assert.equal(files.ok, true);
  assert.equal(files.output, 'a.ts\nb.ts');

  const search = await call(root, 'search_code', { query: 'needle', glob: '*.ts' });
  assert.equal(search.ok, true);
  assert.match(search.output, /a\.ts:2:needle\(\);/);
  assert.match(search.output, /b\.ts:1:const needle = 1;/);

  const noMatch = await call(root, 'search_code', { query: 'missing', glob: '*.ts' });
  assert.equal(noMatch.ok, true);
  assert.equal(noMatch.output, '');
});

test('run_command captures output, failures and timeouts', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const node = JSON.stringify(process.execPath);

  const success = await call(root, 'run_command', {
    command: `${node} -e "process.stdout.write('ok')"`,
  });
  assert.equal(success.ok, true);
  assert.match(success.output, /stdout:\nok/);
  assert.equal(success.metadata.exitCode, 0);

  const failure = await call(root, 'run_command', {
    command: `${node} -e "process.stderr.write('bad'); process.exit(3)"`,
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.error?.code, 'EXECUTION_ERROR');
  assert.equal(failure.metadata.exitCode, 3);
  assert.match(failure.output, /stderr:\nbad/);

  const timeout = await call(root, 'run_command', {
    command: `${node} -e "setTimeout(() => {}, 10000)"`,
  }, { timeoutMs: 50 });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.error?.code, 'TIMEOUT');
});

test('registry validates arguments and truncates output', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const invalid = await call(root, 'read_file', { path: 42 });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error?.code, 'INVALID_ARGUMENTS');

  const output = await call(root, 'run_command', {
    command: `${JSON.stringify(process.execPath)} -e "process.stdout.write('x'.repeat(200))"`,
  }, { maxOutputBytes: 20 });
  assert.equal(output.ok, true);
  assert.equal(output.metadata.truncated, true);
  assert.ok(Buffer.byteLength(output.output, 'utf8') <= 20);
});

test('core tools expose stable local permission profiles', t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = createCoreToolRegistry(root);

  assert.deepEqual(registry.get('read_file')?.permission, {
    targetArgument: 'path', targetKind: 'path', pathIntent: 'existing', risk: 'read',
  });
  assert.deepEqual(registry.get('write_file')?.permission, {
    targetArgument: 'path', targetKind: 'path', pathIntent: 'write', risk: 'write',
  });
  assert.deepEqual(registry.get('edit_file')?.permission, {
    targetArgument: 'path', targetKind: 'path', pathIntent: 'existing', risk: 'write',
  });
  assert.deepEqual(registry.get('run_command')?.permission, {
    targetArgument: 'command', targetKind: 'command', risk: 'execute',
  });
  assert.deepEqual(registry.get('find_files')?.permission, {
    targetArgument: 'pattern', targetKind: 'glob', pathIntent: 'glob', risk: 'read',
  });
  assert.deepEqual(registry.get('search_code')?.permission, {
    targetArgument: 'glob', targetKind: 'glob', defaultTarget: '**/*', pathIntent: 'glob', risk: 'read',
  });
});
