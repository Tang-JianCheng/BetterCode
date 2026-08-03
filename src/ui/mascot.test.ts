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

function connectedComponentCount(lines: readonly string[]): number {
  const width = Math.max(...lines.map(line => [...line].length));
  const grid = lines.map(line => [...line.padEnd(width)]);
  const visited = new Set<string>();
  let components = 0;
  for (let row = 0; row < grid.length; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const key = `${column}:${row}`;
      if (grid[row][column] === ' ' || visited.has(key)) continue;
      components += 1;
      const pending: Array<[number, number]> = [[column, row]];
      while (pending.length > 0) {
        const [currentColumn, currentRow] = pending.pop()!;
        const currentKey = `${currentColumn}:${currentRow}`;
        if (
          currentRow < 0
          || currentRow >= grid.length
          || currentColumn < 0
          || currentColumn >= width
          || grid[currentRow][currentColumn] === ' '
          || visited.has(currentKey)
        ) continue;
        visited.add(currentKey);
        pending.push(
          [currentColumn - 1, currentRow],
          [currentColumn + 1, currentRow],
          [currentColumn, currentRow - 1],
          [currentColumn, currentRow + 1],
        );
      }
    }
  }
  return components;
}

test('自定义像素模板形成整体连通的 BETTERCODE Logo', () => {
  const renderer = new LogoRenderer({ center: false, animation: false });
  const connected = renderer.layout('BETTERCODE');
  assert.equal(connected.lines.length, 7);
  assert.deepEqual(connected.lines, BETTERCODE_LOGO_TEMPLATE);
  assert.equal(connected.contentWidth, 98);
  assert.equal(connected.lines.every(line => /^[ █▓▒░╭╮╰╯]*$/u.test(line)), true);
  assert.equal(connected.joins.length, 9);
  for (const join of connected.joins) {
    const row = [...connected.lines[join.row]];
    assert.equal(row[join.leftColumn], '░');
    assert.equal(row[join.rightColumn], '░');
    connected.lines.forEach((line, rowIndex) => {
      if (rowIndex === join.row) return;
      const boundary = [...line];
      assert.equal(boundary[join.leftColumn], ' ');
      assert.equal(boundary[join.rightColumn], ' ');
    });
  }
  assert.equal(connectedComponentCount(connected.lines), 1);
  assert.equal(connected.lines.some(line => /^[█▓▒░]+$/u.test(line.trim())), false);
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
  assert.equal(lines[0].match(/^ */u)?.[0].length, 11);
  const frames = renderer.animationFrames();
  assert.equal(frames.length, 15);
  assert.equal(frames[0].every(line => line.trim() === ''), true);
  assert.deepEqual(frames.at(-1), lines);
  assert.equal(frames.every(frame => frame.length === 7), true);
  const ansi = renderer.ansiFrames();
  assert.equal(ansi.length, frames.length);
  assert.match(ansi[0].content, /\u001B\[\?25l/u);
  assert.match(ansi[1].content, /^\u001B\[6A\r/u);
  assert.match(ansi.at(-1)!.content, /\u001B\[\?25h/u);
  assert.equal(ansi.every(frame => frame.delayMs === 50), true);
});

test('启动品牌按终端宽度降级并展示商业 CLI 状态', () => {
  assert.equal(bannerLines(modern).length, 7);
  assert.equal(bannerLines({ ...modern, columns: 55, density: 'narrow' }).length, 7);
  assert.equal(bannerLines({ ...modern, columns: 90, density: 'compact' }).length, 7);
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
  assert.match(frame, /[█▓▒░]/u);
  assert.doesNotMatch(frame, /小码准备好了|把目标交给我|\/_____|╗|╔/u);
  view.unmount();
});

test('品牌简化标记在 Unicode 与 ASCII 模式保留语义', () => {
  assert.equal(mascotMark('info', true), '◇');
  assert.equal(mascotMark('success', false), '[+]');
  assert.equal(mascotMark('warning', false), '[!]');
  assert.equal(mascotMark('danger', false), '[x]');
});
