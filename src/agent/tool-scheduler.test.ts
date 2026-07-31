import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPermissionManager } from '../permission/factory.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { ToolRegistry } from '../tool/registry.js';
import { ToolExecutionState } from '../tool/execution-state.js';
import {
  createToolSuccess,
  type Tool,
  type ToolCall,
  type ToolEffect,
} from '../tool/types.js';
import { ToolScheduler } from './tool-scheduler.js';
import type { AgentEvent } from './types.js';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-scheduler-'));
}

function call(id: string, name: string): ToolCall {
  return { id, name, arguments: {} };
}

function tool(
  name: string,
  effect: ToolEffect,
  execute: Tool['execute'],
): Tool {
  return {
    name,
    effect,
    description: `${name} tool`,
    inputSchema: { type: 'object', additionalProperties: false },
    permission: {
      targetArgument: 'target',
      targetKind: 'value',
      defaultTarget: name,
      risk: effect === 'read_only' ? 'read' : 'write',
    },
    execute,
  };
}

function options(signal = new AbortController().signal) {
  return {
    mode: 'act' as const,
    initialUnknownToolStreak: 0,
    unknownToolLimit: 3,
    maxIterations: 10,
    signal,
    onProgress: () => undefined,
  };
}

function makeScheduler(registry: ToolRegistry): ToolScheduler {
  return new ToolScheduler(
    registry,
    createPermissionManager(registry, 'allow', { userHome: path.join(registry.rootDir, '.home') }),
  );
}

test('scheduler counts unavailable tools and resets the streak on an allowed tool', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  let sideEffectRuns = 0;
  registry.register(tool('read', 'read_only', async () => createToolSuccess('read')));
  registry.register(tool('write', 'side_effect', async () => {
    sideEffectRuns += 1;
    return createToolSuccess('write');
  }));
  const scheduler = makeScheduler(registry);

  const reset = await scheduler.executeBatch(
    [call('1', 'missing-a'), call('2', 'missing-b'), call('3', 'read'), call('4', 'missing-c')],
    1,
    options(),
  );
  assert.equal(reset.unknownToolStreak, 1);
  assert.equal(reset.unknownToolLimitReached, false);

  const planOptions = { ...options(), mode: 'plan' as const };
  const limited = await scheduler.executeBatch(
    [call('1', 'missing-a'), call('2', 'write'), call('3', 'missing-b'), call('4', 'write')],
    1,
    planOptions,
  );
  assert.equal(limited.unknownToolLimitReached, true);
  assert.deepEqual(
    limited.results.map(item => item.result.error?.code),
    ['TOOL_NOT_FOUND', 'TOOL_UNAVAILABLE', 'TOOL_NOT_FOUND', 'CANCELLED'],
  );
  assert.equal(sideEffectRuns, 0);
});

test('scheduler runs reads concurrently, then side effects serially, while preserving result order', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  const timeline: string[] = [];
  let activeReads = 0;
  let maxActiveReads = 0;
  let releaseReads: (() => void) | undefined;
  const readGate = new Promise<void>(resolve => { releaseReads = resolve; });

  for (const name of ['read-a', 'read-b', 'read-c']) {
    registry.register(tool(name, 'read_only', async () => {
      timeline.push(`${name}:start`);
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      if (activeReads === 3) releaseReads?.();
      await readGate;
      activeReads -= 1;
      timeline.push(`${name}:end`);
      return createToolSuccess(name);
    }));
  }
  for (const name of ['write-a', 'write-b']) {
    registry.register(tool(name, 'side_effect', async () => {
      timeline.push(`${name}:start`);
      await Promise.resolve();
      timeline.push(`${name}:end`);
      return createToolSuccess(name);
    }));
  }

  const result = await makeScheduler(registry).executeBatch(
    [
      call('w1', 'write-a'),
      call('r1', 'read-a'),
      call('w2', 'write-b'),
      call('r2', 'read-b'),
      call('r3', 'read-c'),
    ],
    1,
    options(),
  );

  assert.equal(maxActiveReads, 3);
  assert.ok(timeline.indexOf('write-a:start') > timeline.indexOf('read-c:end'));
  assert.deepEqual(timeline.slice(-4), [
    'write-a:start', 'write-a:end', 'write-b:start', 'write-b:end',
  ]);
  assert.deepEqual(result.results.map(item => item.call.id), ['w1', 'r1', 'w2', 'r2', 'r3']);
  assert.deepEqual(result.results.map(item => item.result.output), [
    'write-a', 'read-a', 'write-b', 'read-b', 'read-c',
  ]);
});

test('scheduler cancellation prevents remaining side effects', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  const controller = new AbortController();
  let runs = 0;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  registry.register(tool('first', 'side_effect', async (_input, context) => {
    runs += 1;
    markStarted?.();
    await new Promise<void>(resolve => {
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return createToolSuccess('late');
  }));
  registry.register(tool('second', 'side_effect', async () => {
    runs += 1;
    return createToolSuccess('second');
  }));

  const pending = makeScheduler(registry).executeBatch(
    [call('1', 'first'), call('2', 'second')],
    1,
    options(controller.signal),
  );
  await started;
  controller.abort();
  const result = await pending;

  assert.equal(runs, 1);
  assert.equal(result.cancelled, true);
  assert.deepEqual(result.results.map(item => item.result.error?.code), ['CANCELLED', 'CANCELLED']);
});

test('scheduler keeps running allowed tools after an ordinary tool failure', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  let secondRuns = 0;
  registry.register(tool('fails', 'read_only', async () => {
    throw new Error('boom');
  }));
  registry.register(tool('succeeds', 'read_only', async () => {
    secondRuns += 1;
    return createToolSuccess('ok');
  }));
  const result = await makeScheduler(registry).executeBatch(
    [call('1', 'fails'), call('2', 'succeeds')],
    1,
    options(),
  );

  assert.equal(result.results[0].result.error?.code, 'INTERNAL_ERROR');
  assert.equal(result.results[1].result.ok, true);
  assert.equal(result.unknownToolStreak, 0);
  assert.equal(secondRuns, 1);
});

test('scheduler cancellation settles all concurrent read tools as cancelled', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  const controller = new AbortController();
  let starts = 0;
  for (const name of ['read-a', 'read-b']) {
    registry.register(tool(name, 'read_only', async (_input, context) => {
      starts += 1;
      await new Promise<void>(resolve => {
        context.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return createToolSuccess('late');
    }));
  }
  const pending = makeScheduler(registry).executeBatch(
    [call('1', 'read-a'), call('2', 'read-b')],
    1,
    options(controller.signal),
  );
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  const result = await pending;

  assert.equal(starts, 2);
  assert.deepEqual(result.results.map(item => item.result.error?.code), ['CANCELLED', 'CANCELLED']);
});

test('scheduler serializes permission checks and reuses a session allow in the same batch', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  let executions = 0;
  registry.register(tool('read', 'read_only', async () => {
    executions += 1;
    return createToolSuccess('ok');
  }));
  const permissionManager = createPermissionManager(
    registry,
    'default',
    { userHome: path.join(root, '.home') },
  );
  const events: AgentEvent[] = [];
  let prompts = 0;
  const result = await new ToolScheduler(registry, permissionManager).executeBatch(
    [call('1', 'read'), call('2', 'read')],
    1,
    {
      ...options(),
      permissionDecider: async () => {
        prompts += 1;
        return 'allow_session';
      },
      onProgress: event => events.push(event),
    },
  );

  assert.equal(prompts, 1);
  assert.equal(executions, 2);
  assert.equal(result.results.every(item => item.result.ok), true);
  assert.deepEqual(
    events.filter(event => event.type === 'permission_decision')
      .map(event => event.type === 'permission_decision' ? event.source : ''),
    ['user', 'session_rule'],
  );
});

test('scheduler does not prompt for invalid arguments or count permission denials as unknown tools', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  registry.register(tool('read', 'read_only', async () => createToolSuccess('ok')));
  const permissionManager = createPermissionManager(
    registry,
    'strict',
    { userHome: path.join(root, '.home') },
  );
  let prompts = 0;
  const result = await new ToolScheduler(registry, permissionManager).executeBatch(
    [
      { id: 'invalid', name: 'read', arguments: { extra: true } },
      call('denied', 'read'),
    ],
    1,
    {
      ...options(),
      permissionDecider: async () => {
        prompts += 1;
        return 'allow_once';
      },
    },
  );

  assert.deepEqual(result.results.map(item => item.result.error?.code), [
    'INVALID_ARGUMENTS', 'PERMISSION_DENIED',
  ]);
  assert.equal(result.unknownToolStreak, 0);
  assert.equal(result.unknownToolLimitReached, false);
  assert.equal(prompts, 0);
});

test('scheduler 拒绝白名单外工具并让系统工具跳过权限确认', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  let hiddenRuns = 0;
  let systemRuns = 0;
  registry.register(tool('hidden', 'read_only', async () => {
    hiddenRuns += 1;
    return createToolSuccess('hidden');
  }));
  registry.register(tool('load_skill', 'read_only', async () => {
    systemRuns += 1;
    return createToolSuccess('loaded');
  }), { system: true });
  const permissionManager = createPermissionManager(
    registry,
    'strict',
    { userHome: path.join(root, '.home') },
  );
  let prompts = 0;
  const result = await new ToolScheduler(registry, permissionManager).executeBatch(
    [call('1', 'hidden'), call('2', 'load_skill')],
    1,
    {
      ...options(),
      allowedToolNames: new Set(['load_skill']),
      permissionDecider: async () => {
        prompts += 1;
        return 'allow_once';
      },
    },
  );

  assert.equal(result.results[0].result.error?.code, 'TOOL_UNAVAILABLE');
  assert.equal(result.results[1].result.ok, true);
  assert.equal(result.unknownToolStreak, 0);
  assert.equal(hiddenRuns, 0);
  assert.equal(systemRuns, 1);
  assert.equal(prompts, 0);
});

test('scheduler 下传读取缓存并在成功副作用后按范围失效', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'first.txt'), 'first');
  writeFileSync(path.join(root, 'second.txt'), 'second');
  const registry = createCoreToolRegistry(root);
  const state = new ToolExecutionState();
  const scheduler = new ToolScheduler(
    registry,
    createPermissionManager(registry, 'allow', { userHome: path.join(root, '.home') }),
    undefined,
    state,
  );

  await scheduler.executeBatch([
    { id: 'r1', name: 'read_file', arguments: { path: 'first.txt' } },
    { id: 'r2', name: 'read_file', arguments: { path: 'second.txt' } },
  ], 1, options());
  const firstStat = statSync(path.join(root, 'first.txt'));
  const secondStat = statSync(path.join(root, 'second.txt'));
  const firstPath = realpathSync(path.join(root, 'first.txt'));
  const secondPath = realpathSync(path.join(root, 'second.txt'));
  assert.equal(state.getFileRead(firstPath, firstStat.size, firstStat.mtimeMs), 'first');
  assert.equal(state.getFileRead(secondPath, secondStat.size, secondStat.mtimeMs), 'second');

  await scheduler.executeBatch([{
    id: 'w1', name: 'write_file', arguments: { path: './first.txt', content: 'changed' },
  }], 2, options());
  assert.equal(state.getFileRead(firstPath, firstStat.size, firstStat.mtimeMs), undefined);
  assert.equal(state.getFileRead(secondPath, secondStat.size, secondStat.mtimeMs), 'second');

  await scheduler.executeBatch([{
    id: 'c1', name: 'run_command', arguments: { command: 'true' },
  }], 3, options());
  assert.equal(state.getFileRead(secondPath, secondStat.size, secondStat.mtimeMs), undefined);
});

test('scheduler 不会因失败的副作用清理读取缓存', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  registry.register(tool('fails', 'side_effect', async () => {
    throw new Error('失败');
  }));
  const state = new ToolExecutionState();
  state.setFileRead({ absolutePath: path.join(root, 'kept.txt'), size: 4, mtimeMs: 1, content: 'kept' });
  const scheduler = new ToolScheduler(
    registry,
    createPermissionManager(registry, 'allow', { userHome: path.join(root, '.home') }),
    undefined,
    state,
  );

  const result = await scheduler.executeBatch([call('f1', 'fails')], 1, options());
  assert.equal(result.results[0].result.ok, false);
  assert.equal(state.getFileRead(path.join(root, 'kept.txt'), 4, 1), 'kept');
});
