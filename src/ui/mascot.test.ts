import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { displayWidth } from './capabilities.js';
import { mascotLines, mascotMark, StartupBrand } from './mascot.js';

const modern = {
  columns: 120, density: 'full' as const, color: false, unicode: true, motion: false,
};

test('启动品牌渲染完整原创形象与 BetterCode 信息', () => {
  assert.equal(mascotLines(modern).length, 7);
  assert.equal(mascotLines({ ...modern, columns: 55, density: 'narrow' }).length, 5);
  assert.equal(mascotLines(modern).every(line => displayWidth(line) <= 24), true);
  const view = render(React.createElement(StartupBrand, { capabilities: modern, version: '0.1.0' }));
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /BetterCode v0\.1\.0/u);
  assert.match(frame, /小码准备好了/u);
  assert.match(frame, /●  ●/u);
  view.unmount();
});

test('品牌简化标记在 Unicode 与 ASCII 模式保留语义', () => {
  assert.equal(mascotMark('info', true), '◇');
  assert.equal(mascotMark('success', false), '[+]');
  assert.equal(mascotMark('warning', false), '[!]');
  assert.equal(mascotMark('danger', false), '[x]');
});
