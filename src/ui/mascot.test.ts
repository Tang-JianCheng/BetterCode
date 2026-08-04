import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { displayWidth } from './capabilities.js';
import { bannerLines, mascotMark, StartupBrand } from './mascot.js';
import { BETTERCODE_LOGO_TEMPLATE, LogoRenderer, PixelLogo } from './startup-banner.js';

const modern = {
  columns: 120, density: 'full' as const, color: false, unicode: true, motion: false,
};

test('启动横幅按用户指定模板原样输出 BETTERCODE', () => {
  const renderer = new LogoRenderer({ center: false, animation: false });
  const connected = renderer.layout('BETTERCODE');
  assert.equal(connected.lines.length, 6);
  assert.deepEqual(connected.lines, BETTERCODE_LOGO_TEMPLATE);
  assert.equal(connected.contentWidth, 84);
  assert.equal(connected.lines.every(line => /^[ █╗╔╚╝═║]*$/u.test(line)), true);
  assert.equal(connected.joins.length, 0);
  assert.throws(() => renderer.render('BETTER CODE'), /不支持的 Logo 文字/u);
});

test('启动动画完成后只通知一次且不在渲染阶段更新父组件', async () => {
  const warnings: string[] = [];
  const originalError = console.error;
  console.error = (...values: unknown[]) => warnings.push(values.map(String).join(' '));
  const animated = { ...modern, motion: true };
  let completed = 0;
  const callbackView = render(React.createElement(PixelLogo, {
    capabilities: animated,
    animationDuration: 30,
    onAnimationComplete: () => { completed += 1; },
  }));
  const view = render(React.createElement(StartupBrand, { capabilities: animated, version: '0.1.0' }));

  try {
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(completed, 1);
    await new Promise(resolve => setTimeout(resolve, 850));
    const frame = view.lastFrame() ?? '';
    assert.match(frame, /✦ BetterCode Agent/u);
    assert.equal(warnings.some(message => message.includes('Cannot update a component')), false);
    assert.equal(completed, 1);
  } finally {
    view.unmount();
    callbackView.unmount();
    console.error = originalError;
  }
});

test('LogoRenderer 支持居中、逐行动画和 ANSI 差量帧', () => {
  const renderer = new LogoRenderer({
    width: 120,
    center: true,
    animation: true,
    animationDuration: 700,
  });
  const lines = renderer.render();
  assert.equal(lines.every(line => displayWidth(line) <= 120), true);
  assert.equal(lines[0].match(/^ */u)?.[0].length, 18);
  const frames = renderer.animationFrames();
  assert.equal(frames.length, 13);
  assert.equal(frames[0].every(line => line.trim() === ''), true);
  assert.deepEqual(frames.at(-1), lines);
  assert.equal(frames.every(frame => frame.length === 6), true);
  const ansi = renderer.ansiFrames();
  assert.equal(ansi.length, frames.length);
  assert.match(ansi[0].content, /\u001B\[\?25l/u);
  assert.match(ansi[1].content, /^\u001B\[5A\r/u);
  assert.match(ansi.at(-1)!.content, /\u001B\[\?25h/u);
  assert.equal(ansi.every(frame => frame.delayMs === 58), true);
});

test('启动品牌按终端宽度降级并展示商业 CLI 状态', () => {
  assert.equal(bannerLines(modern).length, 6);
  assert.equal(bannerLines({ ...modern, columns: 55, density: 'narrow' }).length, 7);
  assert.equal(bannerLines({ ...modern, columns: 90, density: 'compact' }).length, 6);
  assert.equal(bannerLines({ ...modern, columns: 80, density: 'compact' }).length, 7);
  assert.equal(bannerLines(modern).every(line => displayWidth(line) <= 118), true);
  assert.equal(bannerLines({ ...modern, columns: 55, density: 'narrow' })
    .every(line => displayWidth(line) <= 53), true);
  assert.equal(bannerLines({ ...modern, unicode: false }).length, 7);
  assert.equal(bannerLines({ ...modern, unicode: false }).every(line => /^[ #]*$/u.test(line)), true);
  assert.equal(bannerLines({
    ...modern, columns: 55, density: 'narrow', unicode: false,
  }).every(line => !/[█╭╰●▄]/u.test(line)), true);
  const view = render(React.createElement(StartupBrand, { capabilities: modern, version: '0.1.0' }));
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /✦ BetterCode Agent v0\.1\.0/u);
  assert.match(frame, /⚡ AI Coding Assistant/u);
  assert.match(frame, /◉ Model: DeepSeek/u);
  assert.match(frame, /◉ Ready/u);
  assert.match(frame, /[█╗╔╚╝═║]/u);
  assert.doesNotMatch(frame, /小码准备好了|把目标交给我|\/_____|▓|▒|░/u);
  view.unmount();
});

test('品牌简化标记在 Unicode 与 ASCII 模式保留语义', () => {
  assert.equal(mascotMark('info', true), '◇');
  assert.equal(mascotMark('success', false), '[+]');
  assert.equal(mascotMark('warning', false), '[!]');
  assert.equal(mascotMark('danger', false), '[x]');
});
