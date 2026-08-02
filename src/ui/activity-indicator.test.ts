import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { ActivityIndicator, activityFrame } from './activity-indicator.js';

const capabilities = {
  columns: 80, density: 'compact' as const, color: false, unicode: true, motion: false,
};

test('活动帧在动态与低动态模式使用对应字符', () => {
  assert.equal(activityFrame(0, { ...capabilities, motion: true }), '⠋');
  assert.equal(activityFrame(1, { ...capabilities, motion: true }), '⠙');
  assert.equal(activityFrame(9, { ...capabilities, unicode: false, motion: true }), '/');
  assert.equal(activityFrame(3, capabilities), '·');
});

test('活动组件展示阶段、轮次和工具并保持窄宽度有界', () => {
  const view = render(React.createElement(ActivityIndicator, {
    capabilities: { ...capabilities, columns: 55, density: 'narrow' },
    activity: {
      stage: 'executing_tool', label: '正在执行工具', iteration: 2, maxIterations: 10,
      toolName: 'very_long_tool_name_that_must_be_truncated', startedAt: 1,
    },
  }));
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /正在执行工具 2\/10/u);
  assert.match(frame, /…/u);
  view.unmount();
});
