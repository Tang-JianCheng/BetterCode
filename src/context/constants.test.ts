import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTEXT_SUMMARY_HEADINGS,
  DEFAULT_CONTEXT_OPTIONS,
  DEFAULT_CONTEXT_WINDOW,
  resolveContextOptions,
} from './constants.js';

test('上下文默认值完整且稳定', () => {
  assert.equal(DEFAULT_CONTEXT_WINDOW, 128_000);
  assert.equal(CONTEXT_SUMMARY_HEADINGS.length, 7);
  assert.deepEqual(resolveContextOptions(), DEFAULT_CONTEXT_OPTIONS);
});

test('上下文选项允许合法覆盖', () => {
  const options = resolveContextOptions({
    singleToolResultTokens: 100,
    toolPreviewTokens: 20,
    automaticReserveTokens: 50,
    manualReserveTokens: 10,
  });

  assert.equal(options.singleToolResultTokens, 100);
  assert.equal(options.toolPreviewTokens, 20);
  assert.equal(options.toolBatchTokens, DEFAULT_CONTEXT_OPTIONS.toolBatchTokens);
});

test('上下文选项拒绝非法数值和关系', () => {
  for (const value of [0, -1, 1.5]) {
    assert.throws(
      () => resolveContextOptions({ recentHistoryMessages: value }),
      /必须是正整数/,
    );
  }
  assert.throws(
    () => resolveContextOptions({ singleToolResultTokens: 100, toolPreviewTokens: 100 }),
    /预览阈值必须小于/,
  );
  assert.throws(
    () => resolveContextOptions({ automaticReserveTokens: 100, manualReserveTokens: 100 }),
    /手动压缩安全余量必须小于/,
  );
});
