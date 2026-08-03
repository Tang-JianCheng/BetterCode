import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { displayWidth } from './capabilities.js';
import { bannerLines, mascotMark, StartupBrand } from './mascot.js';
import { createConnectedWordmark } from './wordmark.js';

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

test('启动品牌渲染整体连通的立体字标与 BetterCode 信息', () => {
  const connected = createConnectedWordmark();
  assert.equal(bannerLines(modern).length, 6);
  assert.equal(bannerLines({ ...modern, columns: 55, density: 'narrow' }).length, 5);
  assert.equal(bannerLines({ ...modern, columns: 90, density: 'compact' }).length, 6);
  assert.equal(bannerLines({ ...modern, columns: 80, density: 'compact' }).length, 7);
  assert.equal(bannerLines(modern).every(line => displayWidth(line) <= 83), true);
  assert.match(bannerLines(modern)[0], /^██████╗ █+/u);
  assert.equal(bannerLines(modern).some(line => /[╗╔╚╝═║]/u.test(line)), true);
  assert.equal(connected.joins.length, 9);
  for (const join of connected.joins) {
    const row = [...connected.lines[join.row]];
    assert.equal(row[join.leftColumn], '█');
    assert.equal(row[join.rightColumn], '█');
  }
  assert.equal(connectedComponentCount(connected.lines), 1);
  assert.equal(connected.lines.some(line => /^[█═]+$/u.test(line.trim())), false);
  assert.equal(bannerLines({ ...modern, unicode: false }).length, 7);
  assert.equal(bannerLines({ ...modern, unicode: false }).every(line => !/[█╗╔╚╝═║]/u.test(line)), true);
  const fallback = createConnectedWordmark(() => {
    throw new Error('font missing');
  });
  assert.equal(fallback.lines.length, 6);
  assert.deepEqual(fallback, connected);
  assert.equal(bannerLines({
    ...modern, columns: 55, density: 'narrow', unicode: false,
  }).every(line => !/[█╭╰●▄]/u.test(line)), true);
  const view = render(React.createElement(StartupBrand, { capabilities: modern, version: '0.1.0' }));
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /BetterCode v0\.1\.0/u);
  assert.match(frame, /小码准备好了/u);
  assert.match(frame, /██████╗/u);
  assert.doesNotMatch(frame, /╭|╰|●|▄|▀|\/_____/u);
  view.unmount();
});

test('品牌简化标记在 Unicode 与 ASCII 模式保留语义', () => {
  assert.equal(mascotMark('info', true), '◇');
  assert.equal(mascotMark('success', false), '[+]');
  assert.equal(mascotMark('warning', false), '[!]');
  assert.equal(mascotMark('danger', false), '[x]');
});
