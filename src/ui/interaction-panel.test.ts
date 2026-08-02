import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { InteractionPanel, moveInteractionIndex } from './interaction-panel.js';

const capabilities = {
  columns: 55, density: 'narrow' as const, color: false, unicode: false, motion: false,
};

test('交互索引循环移动且空列表保持零', () => {
  assert.equal(moveInteractionIndex(0, 4, 'up'), 3);
  assert.equal(moveInteractionIndex(3, 4, 'down'), 0);
  assert.equal(moveInteractionIndex(0, 0, 'down'), 0);
});

test('无颜色 ASCII 交互面板仍明确显示选中项与帮助', () => {
  const view = render(React.createElement(InteractionPanel, {
    title: '权限确认', tone: 'warning', capabilities, selectedIndex: 1,
    details: ['工具: run_command', '目标: pnpm test'],
    options: [
      { value: 'deny', label: '拒绝', shortcut: 'd' },
      { value: 'once', label: '仅本次', shortcut: 'o' },
    ],
    footer: '上下键选择 · Enter 确认 · Esc 取消',
  }));
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /^\+- \[WARN\] 权限确认/mu);
  assert.match(frame, /> \[o\] 仅本次/u);
  assert.match(frame, /Enter 确认/u);
  view.unmount();
});
