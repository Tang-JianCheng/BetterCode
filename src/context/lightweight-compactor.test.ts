import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Message } from '../provider/types.js';
import { resolveContextOptions } from './constants.js';
import { LightweightCompactor } from './lightweight-compactor.js';
import { TokenEstimator } from './token-estimator.js';
import { ToolResultStore } from './tool-result-store.js';

function batch(contents: string[]): Message[] {
  const calls = contents.map((_, index) => ({
    id: `call-${index}`,
    name: 'read_file',
    arguments: { path: `${index}.txt` },
  }));
  return [
    { role: 'assistant', content: '', toolCalls: calls },
    ...contents.map((content, index): Message => ({
      role: 'tool',
      toolCallId: `call-${index}`,
      toolName: 'read_file',
      content,
      isError: index === 1,
    })),
  ];
}

test('单个超限结果落盘并生成完整有界占位', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'bettercode-light-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const estimator = new TokenEstimator();
  const store = new ToolResultStore(root);
  const compactor = new LightweightCompactor(estimator, store, resolveContextOptions({
    singleToolResultTokens: 80,
    toolBatchTokens: 500,
    toolPreviewTokens: 20,
  }));
  const original = '中文内容'.repeat(100);
  const history = batch([original]);
  const result = await compactor.compact(history, new AbortController().signal);

  assert.equal(result.offloadedCount, 1);
  assert.equal(history[1].role === 'tool' && history[1].content, original);
  const message = result.history[1];
  assert.equal(message.role, 'tool');
  assert.ok(message.role === 'tool' && message.contextReference);
  if (message.role !== 'tool' || !message.contextReference) return;
  assert.equal(message.toolCallId, 'call-0');
  assert.equal(message.isError, false);
  assert.match(message.content, /相对路径:/);
  assert.match(message.content, /SHA-256:/);
  assert.equal(await readFile(path.join(root, message.contextReference.relativePath), 'utf8'), original);
});

test('批次超限按体积降序只处理必要结果', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'bettercode-light-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const estimator = new TokenEstimator();
  const compactor = new LightweightCompactor(
    estimator,
    new ToolResultStore(root),
    resolveContextOptions({
      singleToolResultTokens: 10_000,
      toolBatchTokens: 420,
      toolPreviewTokens: 20,
    }),
  );
  const history = batch(['a'.repeat(1_000), 'b'.repeat(300), '短']);
  const result = await compactor.compact(history, new AbortController().signal);
  assert.equal(result.offloadedCount, 1);
  assert.ok(result.history[1].role === 'tool' && result.history[1].contextReference);
  assert.ok(result.history[2].role === 'tool' && !result.history[2].contextReference);
  assert.equal(result.history[2].role === 'tool' && result.history[2].isError, true);
});

test('重复处理幂等，存储失败和取消保留原历史', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'bettercode-light-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const estimator = new TokenEstimator();
  const options = resolveContextOptions({
    singleToolResultTokens: 40,
    toolBatchTokens: 500,
    toolPreviewTokens: 10,
  });
  const store = new ToolResultStore(root);
  const compactor = new LightweightCompactor(estimator, store, options);
  const first = await compactor.compact(batch(['x'.repeat(1_000)]), new AbortController().signal);
  const second = await compactor.compact(first.history, new AbortController().signal);
  assert.equal(second.offloadedCount, 0);
  assert.deepEqual(second.history, first.history);

  await store.close();
  const original = batch(['y'.repeat(1_000)]);
  const failed = await compactor.compact(original, new AbortController().signal);
  assert.equal(failed.offloadedCount, 0);
  assert.match(failed.failed ?? '', /已关闭/);
  assert.deepEqual(failed.history, original);

  const controller = new AbortController();
  controller.abort();
  const cancelled = await new LightweightCompactor(
    estimator,
    new ToolResultStore(root),
    options,
  ).compact(original, controller.signal);
  assert.deepEqual(cancelled.history, original);
});
