import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { displayWidth } from './capabilities.js';
import { bannerLines, mascotMark, StartupBrand } from './mascot.js';

const modern = {
  columns: 120, density: 'full' as const, color: false, unicode: true, motion: false,
};

function connectedPixelCount(lines: readonly string[]): number {
  const pixels = new Set<string>();
  lines.forEach((line, row) => [...line].forEach((character, column) => {
    if (character !== ' ') pixels.add(`${row}:${column}`);
  }));
  const start = pixels.values().next().value as string | undefined;
  if (!start) return 0;
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const [row, column] = queue.shift()!.split(':').map(Number);
    for (const [nextRow, nextColumn] of [
      [row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1],
    ]) {
      const key = `${nextRow}:${nextColumn}`;
      if (pixels.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(key);
      }
    }
  }
  return visited.size;
}

test('启动品牌渲染一体式像素文字横幅与 BetterCode 信息', () => {
  assert.equal(bannerLines(modern).length, 7);
  assert.equal(bannerLines({ ...modern, columns: 55, density: 'narrow' }).length, 5);
  assert.equal(bannerLines({ ...modern, columns: 90, density: 'compact' }).length, 7);
  assert.equal(bannerLines({ ...modern, columns: 80, density: 'compact' }).length, 7);
  assert.equal(bannerLines(modern).every(line => displayWidth(line) === 60), true);
  assert.equal(bannerLines(modern).every(line => !/[▄▀╗╔╚╝═║]/u.test(line)), true);
  assert.equal(bannerLines(modern).some(line => !line.includes(' ')), false);
  assert.match(bannerLines(modern)[0], /^█████ █████  ████/u);
  assert.match(bannerLines(modern)[3], /^█████ ██████  ██/u);
  const pixels = bannerLines(modern).reduce(
    (total, line) => total + [...line].filter(character => character !== ' ').length,
    0,
  );
  assert.equal(connectedPixelCount(bannerLines(modern)), pixels);
  for (let letter = 0; letter < 'BETTERCODE'.length; letter += 1) {
    const glyph = bannerLines(modern).map(line => line.slice(letter * 6, (letter + 1) * 6));
    const glyphPixels = glyph.reduce(
      (total, line) => total + [...line].filter(character => character !== ' ').length,
      0,
    );
    assert.equal(connectedPixelCount(glyph), glyphPixels);
  }
  for (let boundary = 6; boundary < 60; boundary += 6) {
    assert.equal(bannerLines(modern).some(
      line => line[boundary - 1] !== ' ' && line[boundary] !== ' ',
    ), true);
  }
  assert.equal(bannerLines({
    ...modern, columns: 55, density: 'narrow', unicode: false,
  }).every(line => !/[█╭╰●▄]/u.test(line)), true);
  const view = render(React.createElement(StartupBrand, { capabilities: modern, version: '0.1.0' }));
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /BetterCode v0\.1\.0/u);
  assert.match(frame, /小码准备好了/u);
  assert.match(frame, /█████/u);
  assert.doesNotMatch(frame, /╭|╰|●/u);
  view.unmount();
});

test('品牌简化标记在 Unicode 与 ASCII 模式保留语义', () => {
  assert.equal(mascotMark('info', true), '◇');
  assert.equal(mascotMark('success', false), '[+]');
  assert.equal(mascotMark('warning', false), '[!]');
  assert.equal(mascotMark('danger', false), '[x]');
});
