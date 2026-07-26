import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { createCoreToolRegistry } from '../tool/factory.js';
import type { ToolCall } from '../tool/types.js';
import { createPermissionManager } from './factory.js';
import type { PermissionChoice, PermissionDecider, PermissionRequest } from './types.js';

function setup(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-manager-root-'));
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-manager-home-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
  writeFileSync(path.join(root, 'file.txt'), 'ok');
  const registry = createCoreToolRegistry(root);
  return { root, home, registry };
}

function call(id: string, name: string, arguments_: Record<string, unknown>): ToolCall {
  return { id, name, arguments: arguments_ };
}

function decide(choice: PermissionChoice): PermissionDecider {
  return async () => choice;
}

test('permission manager never lets modes, rules or deciders bypass hard layers', async t => {
  const { root, home, registry } = setup(t);
  mkdirSync(path.join(root, '.bettercode'), { recursive: true });
  writeFileSync(
    path.join(root, '.bettercode', 'permissions.yaml'),
    'version: 1\nrules:\n  - effect: allow\n    expression: run_command(*)\n  - effect: allow\n    expression: read_file\n',
  );
  const manager = createPermissionManager(registry, 'allow', { userHome: home });
  let prompts = 0;
  const options = {
    signal: new AbortController().signal,
    decider: decide('allow_permanent'),
    onRequest: () => { prompts += 1; },
  };

  const dangerous = await manager.authorize(
    call('danger', 'run_command', { command: 'rm -rf /' }),
    registry.get('run_command')!,
    options,
  );
  const outside = await manager.authorize(
    call('outside', 'read_file', { path: '../secret.txt' }),
    registry.get('read_file')!,
    options,
  );
  assert.equal(dangerous.allowed, false);
  assert.equal(dangerous.allowed ? undefined : dangerous.result.error?.code, 'DANGEROUS_COMMAND');
  assert.equal(outside.allowed, false);
  assert.equal(outside.allowed ? undefined : outside.result.error?.code, 'PATH_OUTSIDE_ROOT');
  assert.equal(prompts, 0);
});

test('permission manager applies rules and unmatched mode behavior', async t => {
  const { root, home, registry } = setup(t);
  mkdirSync(path.join(root, '.bettercode'), { recursive: true });
  writeFileSync(
    path.join(root, '.bettercode', 'permissions.yaml'),
    'version: 1\nrules:\n  - effect: deny\n    expression: read_file(file.txt)\n  - effect: allow\n    expression: run_command(git *)\n',
  );
  const manager = createPermissionManager(registry, 'strict', { userHome: home });
  const options = { signal: new AbortController().signal, onRequest: () => undefined };

  const denied = await manager.authorize(
    call('read', 'read_file', { path: 'file.txt' }), registry.get('read_file')!, options,
  );
  const allowed = await manager.authorize(
    call('git', 'run_command', { command: 'git status' }), registry.get('run_command')!, options,
  );
  const strict = await manager.authorize(
    call('find', 'find_files', { pattern: '*.ts' }), registry.get('find_files')!, options,
  );
  assert.equal(denied.source, 'project_rule');
  assert.equal(denied.allowed, false);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.source, 'project_rule');
  assert.equal(strict.allowed, false);
  assert.equal(strict.source, 'mode');

  manager.setMode('allow');
  const permissive = await manager.authorize(
    call('find-2', 'find_files', { pattern: '*.ts' }), registry.get('find_files')!, options,
  );
  assert.equal(permissive.allowed, true);
  assert.equal(permissive.source, 'mode');
});

test('permission manager handles once, session and unavailable decisions', async t => {
  const { home, registry } = setup(t);
  const manager = createPermissionManager(registry, 'default', { userHome: home });
  const toolCall = call('read', 'read_file', { path: 'file.txt' });
  const requests: PermissionRequest[] = [];
  const options = (decider?: PermissionDecider) => ({
    signal: new AbortController().signal,
    decider,
    onRequest: (request: PermissionRequest) => requests.push(request),
  });

  const unavailable = await manager.authorize(toolCall, registry.get('read_file')!, options());
  assert.equal(unavailable.allowed, false);
  assert.equal(unavailable.allowed ? undefined : unavailable.result.error?.code, 'PERMISSION_UNAVAILABLE');

  const once = await manager.authorize(toolCall, registry.get('read_file')!, options(decide('allow_once')));
  assert.equal(once.allowed, true);
  await manager.authorize(toolCall, registry.get('read_file')!, options(decide('allow_session')));
  const session = await manager.authorize(toolCall, registry.get('read_file')!, options());
  assert.equal(session.allowed, true);
  assert.equal(session.source, 'session_rule');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].target, 'file.txt');
  assert.equal(requests[0].proposedRule, 'read_file(file.txt)');

  manager.clearSessionRules();
  const afterClear = await manager.authorize(toolCall, registry.get('read_file')!, options());
  assert.equal(afterClear.allowed, false);
});

test('permission manager persists permanent allows and reloads them', async t => {
  const { root, home, registry } = setup(t);
  const manager = createPermissionManager(registry, 'default', { userHome: home });
  const toolCall = call('git', 'run_command', { command: 'git status' });
  const result = await manager.authorize(toolCall, registry.get('run_command')!, {
    signal: new AbortController().signal,
    decider: decide('allow_permanent'),
    onRequest: () => undefined,
  });
  assert.equal(result.allowed, true);

  const reloadedRegistry = createCoreToolRegistry(root);
  const reloaded = createPermissionManager(reloadedRegistry, 'strict', { userHome: home });
  const persisted = await reloaded.authorize(toolCall, reloadedRegistry.get('run_command')!, {
    signal: new AbortController().signal,
    onRequest: () => undefined,
  });
  assert.equal(persisted.allowed, true);
  assert.equal(persisted.source, 'local_rule');
});

test('permission manager refuses permanent allow when local config is invalid', async t => {
  const { root, home, registry } = setup(t);
  mkdirSync(path.join(root, '.bettercode'), { recursive: true });
  writeFileSync(path.join(root, '.bettercode', 'permissions.local.yaml'), 'version: 2\nrules: []\n');
  const manager = createPermissionManager(registry, 'default', { userHome: home });
  const result = await manager.authorize(
    call('read', 'read_file', { path: 'file.txt' }),
    registry.get('read_file')!,
    {
      signal: new AbortController().signal,
      decider: decide('allow_permanent'),
      onRequest: () => undefined,
    },
  );
  assert.equal(result.allowed, false);
  assert.equal(result.allowed ? undefined : result.result.error?.code, 'PERMISSION_CONFIG_ERROR');
});

test('permission manager cancellation wins over a late decision', async t => {
  const { home, registry } = setup(t);
  const manager = createPermissionManager(registry, 'default', { userHome: home });
  const controller = new AbortController();
  let finish: ((choice: PermissionChoice) => void) | undefined;
  const pending = manager.authorize(
    call('read', 'read_file', { path: 'file.txt' }),
    registry.get('read_file')!,
    {
      signal: controller.signal,
      decider: () => new Promise(resolve => { finish = resolve; }),
      onRequest: () => undefined,
    },
  );
  await Promise.resolve();
  controller.abort();
  const result = await pending;
  finish?.('allow_session');

  assert.equal(result.allowed, false);
  assert.equal(result.allowed ? undefined : result.result.error?.code, 'PERMISSION_CANCELLED');
  assert.equal(manager.getStatus().ruleCounts.session, 0);
});
