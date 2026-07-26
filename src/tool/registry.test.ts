import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCoreToolRegistry } from './factory.js';
import { createToolSuccess, type Tool } from './types.js';
import { ToolRegistry } from './registry.js';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-registry-'));
}

function makeTool(
  name: string,
  execute: Tool['execute'],
  effect: Tool['effect'] = 'read_only',
): Tool {
  return {
    name,
    effect,
    description: `${name} tool`,
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    permission: {
      targetArgument: 'value',
      targetKind: 'value',
      risk: effect === 'read_only' ? 'read' : 'write',
    },
    execute,
  };
}

test('registry registers, validates and executes tools', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let executions = 0;
  const registry = new ToolRegistry(root);
  registry.register(makeTool('one', async input => {
    executions += 1;
    return createToolSuccess(String(input.value));
  }));

  assert.deepEqual(registry.definitions().map(definition => definition.name), ['one']);
  const result = await registry.execute({ id: '1', name: 'one', arguments: { value: 'ok' } });
  assert.equal(result.ok, true);
  assert.equal(result.output, 'ok');
  assert.equal(executions, 1);

  const invalid = await registry.execute({ id: '2', name: 'one', arguments: { value: 42 } });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error?.code, 'INVALID_ARGUMENTS');
  assert.equal(executions, 1);

  const preflight = registry.validate({ id: 'preflight', name: 'one', arguments: { value: 42 } });
  assert.equal(preflight?.error?.code, 'INVALID_ARGUMENTS');
  assert.equal(executions, 1);

  const unknown = await registry.execute({ id: '3', name: 'unknown', arguments: {} });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error?.code, 'TOOL_NOT_FOUND');
  assert.throws(() => registry.register(makeTool('one', async () => createToolSuccess('x'))));
});

test('registry filters definitions by effect without exposing local metadata', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  registry.register(makeTool('read', async () => createToolSuccess('read')));
  registry.register(makeTool('write', async () => createToolSuccess('write'), 'side_effect'));

  assert.equal(registry.effectOf('missing'), undefined);
  assert.equal(registry.effectOf('write'), 'side_effect');
  assert.deepEqual(registry.definitions('read_only').map(item => item.name), ['read']);
  assert.deepEqual(registry.definitions('side_effect').map(item => item.name), ['write']);
  assert.equal('effect' in registry.definitions()[0], false);
  assert.equal('permission' in registry.definitions()[0], false);
});

test('registry converts exceptions and timeouts to structured results', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root, { timeoutMs: 20 });
  registry.register(makeTool('throws', async () => {
    throw new Error('boom');
  }));
  registry.register(makeTool('waits', async (_input, context) => new Promise(resolve => {
    context.signal.addEventListener('abort', () => resolve(createToolSuccess('aborted')), { once: true });
  })));

  const failure = await registry.execute({ id: '1', name: 'throws', arguments: { value: 'x' } });
  assert.equal(failure.ok, false);
  assert.equal(failure.error?.code, 'INTERNAL_ERROR');
  assert.match(failure.error?.message ?? '', /boom/);

  const timeout = await registry.execute({ id: '2', name: 'waits', arguments: { value: 'x' } });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.error?.code, 'TIMEOUT');
});

test('registry distinguishes external cancellation from its timeout', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root, { timeoutMs: 1000 });
  registry.register(makeTool('waits', async (_input, context) => new Promise(resolve => {
    context.signal.addEventListener('abort', () => resolve(createToolSuccess('late')), { once: true });
  })));
  const controller = new AbortController();
  const pending = registry.execute(
    { id: '1', name: 'waits', arguments: { value: 'x' } },
    controller.signal,
  );
  controller.abort();
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'CANCELLED');
});

test('registry leaves no partial state when schema compilation fails', t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  const invalid: Tool = {
    ...makeTool('broken', async () => createToolSuccess('broken')),
    inputSchema: { type: 'not-a-json-schema-type' },
  };

  assert.throws(() => registry.register(invalid));
  assert.equal(registry.get('broken'), undefined);
  assert.equal(registry.effectOf('broken'), undefined);
  assert.deepEqual(registry.definitions(), []);

  registry.register(makeTool('broken', async () => createToolSuccess('valid')));
  assert.equal(registry.get('broken')?.name, 'broken');
});

test('core tool definitions keep stable order and reinforced descriptions', t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = createCoreToolRegistry(root);
  const first = registry.definitions();
  const second = registry.definitions();

  assert.deepEqual(first, second);
  assert.deepEqual(first.map(tool => tool.name), [
    'read_file', 'write_file', 'edit_file', 'run_command', 'find_files', 'search_code',
  ]);
  assert.deepEqual(registry.definitions('read_only').map(tool => tool.name), [
    'read_file', 'find_files', 'search_code',
  ]);
  assert.match(first.find(tool => tool.name === 'read_file')?.description ?? '', /编辑或覆盖.*先读取/);
  assert.match(first.find(tool => tool.name === 'edit_file')?.description ?? '', /调用前必须先读取/);
  assert.match(first.find(tool => tool.name === 'run_command')?.description ?? '', /没有专用工具/);
  assert.equal(first.some(tool => 'effect' in tool), false);
  assert.equal(first.some(tool => tool.description.includes(root)), false);
});
