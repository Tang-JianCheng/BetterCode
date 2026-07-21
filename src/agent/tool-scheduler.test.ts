import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ToolRegistry } from '../tool/registry.js';
import {
  createToolSuccess,
  type Tool,
  type ToolCall,
  type ToolEffect,
} from '../tool/types.js';
import { ToolScheduler } from './tool-scheduler.js';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'mew-scheduler-'));
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
  const scheduler = new ToolScheduler(registry);

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

  const result = await new ToolScheduler(registry).executeBatch(
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
  registry.register(tool('first', 'side_effect', async (_input, context) => {
    runs += 1;
    await new Promise<void>(resolve => {
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return createToolSuccess('late');
  }));
  registry.register(tool('second', 'side_effect', async () => {
    runs += 1;
    return createToolSuccess('second');
  }));

  const pending = new ToolScheduler(registry).executeBatch(
    [call('1', 'first'), call('2', 'second')],
    1,
    options(controller.signal),
  );
  await Promise.resolve();
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
  const result = await new ToolScheduler(registry).executeBatch(
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
  const pending = new ToolScheduler(registry).executeBatch(
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
