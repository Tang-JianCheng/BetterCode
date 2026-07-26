import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { PermissionConfigStore } from './config-store.js';

function setup(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-config-root-'));
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-config-home-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  return {
    root,
    home,
    store: new PermissionConfigStore(root, new Map([
      ['read_file', 'path'],
      ['run_command', 'command'],
    ] as const), home),
  };
}

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

test('config store loads three ordered permission layers', t => {
  const { store } = setup(t);
  write(store.paths.user, 'version: 1\nrules:\n  - effect: deny\n    expression: read_file\n');
  write(store.paths.project, 'version: 1\nrules:\n  - effect: allow\n    expression: read_file(src/**)\n');
  write(store.paths.local, 'version: 1\nrules:\n  - effect: allow\n    expression: run_command(git *)\n');

  const loaded = store.load();
  assert.equal(loaded.diagnostics.length, 0);
  assert.deepEqual(loaded.rules.user.map(rule => rule.order), [0]);
  assert.equal(loaded.rules.project[0].expression, 'read_file(src/**)');
  assert.equal(loaded.rules.local[0].expression, 'run_command(git *)');
});

test('config store skips an invalid layer and preserves valid layers', t => {
  const { store } = setup(t);
  write(store.paths.user, 'version: 1\nrules: [top-secret');
  write(store.paths.project, 'version: 1\nrules:\n  - effect: allow\n    expression: read_file\n');
  write(store.paths.local, 'version: 1\nrules:\n  - effect: allow\n    expression: unknown(*)\n');

  const loaded = store.load();
  assert.equal(loaded.rules.user.length, 0);
  assert.equal(loaded.rules.project.length, 1);
  assert.equal(loaded.rules.local.length, 0);
  assert.deepEqual(loaded.diagnostics.map(item => item.layer), ['user', 'local']);
  assert.match(loaded.diagnostics[0].file, /permissions\.yaml$/);
  assert.doesNotMatch(loaded.diagnostics[0].message, /expression:/);
  assert.doesNotMatch(loaded.diagnostics[0].message, /top-secret/);
});

test('config store appends local allow atomically and without duplicates', async t => {
  const { store } = setup(t);
  write(
    store.paths.local,
    '# 本地权限\nversion: 1\nrules:\n  - effect: deny\n    expression: read_file(secret/**)\n',
  );

  const first = await store.appendLocalAllow('read_file(src/index.ts)');
  const second = await store.appendLocalAllow('read_file(src/index.ts)');
  const content = readFileSync(store.paths.local, 'utf8');
  assert.equal(first.added.effect, 'allow');
  assert.equal(second.rules.length, 2);
  assert.equal(content.match(/read_file\(src\/index\.ts\)/gu)?.length, 1);
  assert.match(content, /# 本地权限/);
  assert.equal(store.load().rules.local.length, 2);
});

test('config store refuses to overwrite an invalid local file', async t => {
  const { store } = setup(t);
  const invalid = 'version: 2\nrules: []\n';
  write(store.paths.local, invalid);

  await assert.rejects(() => store.appendLocalAllow('read_file(src/index.ts)'), /version 必须是 1/);
  assert.equal(readFileSync(store.paths.local, 'utf8'), invalid);
});

test('config store rejects project config symlink escape', async t => {
  const { root, store } = setup(t);
  const outside = mkdtempSync(path.join(tmpdir(), 'bettercode-config-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, path.join(root, '.bettercode'));

  const loaded = store.load();
  assert.deepEqual(loaded.diagnostics.map(item => item.layer), ['project', 'local']);
  await assert.rejects(
    () => store.appendLocalAllow('read_file(src/index.ts)'),
    /超出项目边界/,
  );
  assert.equal(existsSync(path.join(outside, 'permissions.local.yaml')), false);
});

test('config store keeps offline MCP rules dormant and restores argument matching', t => {
  const { root, home, store } = setup(t);
  const toolName = 'mcp_server_tool_deadbeef';
  write(store.paths.local, `version: 1
rules:
  - effect: allow
    expression: ${toolName}({"path":"src/**"})
`);

  const offline = store.load();

  assert.equal(offline.diagnostics.length, 0);
  assert.equal(offline.rules.local.length, 1);
  assert.equal(offline.rules.local[0]?.matches('{"path":"src/a.ts"}'), true);

  const restored = new PermissionConfigStore(
    root,
    new Map([[toolName, 'arguments']]),
    home,
  ).load();
  assert.equal(restored.diagnostics.length, 0);
  assert.equal(restored.rules.local[0]?.matches('{"path":"src/a.ts"}'), true);
  assert.equal(restored.rules.local[0]?.matches('{"path":"test/a.ts"}'), false);
});
