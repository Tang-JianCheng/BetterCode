import assert from 'node:assert/strict';
import test from 'node:test';
import {
  densityForColumns,
  detectTerminalCapabilities,
  displayWidth,
  padDisplay,
  terminalSafeText,
  truncateDisplay,
  truncateStart,
} from './capabilities.js';

test('终端密度阈值保持确定性', () => {
  assert.equal(densityForColumns(100), 'full');
  assert.equal(densityForColumns(99), 'compact');
  assert.equal(densityForColumns(64), 'compact');
  assert.equal(densityForColumns(63), 'narrow');
});

test('终端能力按颜色、ASCII、低动态和 dumb 环境降级', () => {
  assert.deepEqual(detectTerminalCapabilities({
    columns: 120, isTTY: true, term: 'xterm-256color', noColor: false, ci: false,
    reduceMotion: false,
  }), {
    columns: 120, density: 'full', color: true, unicode: true, motion: true,
  });
  assert.deepEqual(detectTerminalCapabilities({
    columns: 80, isTTY: true, term: 'xterm', noColor: true, forceAscii: true,
    reduceMotion: true,
  }), {
    columns: 80, density: 'compact', color: false, unicode: false, motion: false,
  });
  const dumb = detectTerminalCapabilities({ columns: 55, isTTY: true, term: 'dumb' });
  assert.equal(dumb.color, false);
  assert.equal(dumb.unicode, false);
  assert.equal(dumb.motion, false);
});

test('显示宽度和截断正确处理中文与组合字符', () => {
  assert.equal(displayWidth('模型abc'), 7);
  assert.equal(displayWidth('e\u0301'), 1);
  const truncated = truncateDisplay('模型deepseek-chat', 10);
  assert.ok(displayWidth(truncated) <= 10);
  assert.match(truncated, /…$/u);
  assert.equal(truncateDisplay('e\u0301clair', 2), 'e\u0301…');
  assert.equal(truncateDisplay('abcdef', 2, '...'), '..');
  assert.equal(displayWidth(padDisplay('命令', 8)), 8);
  assert.equal(displayWidth(padDisplay('超长中文字段', 8)), 8);
});

test('从左侧截断保留右缘并带省略号', () => {
  assert.equal(truncateStart('abcdef', 6), 'abcdef');
  assert.equal(truncateStart('abcdef', 4, '...'), '...f');
  assert.equal(truncateStart('模型deepseek', 6), '…pseek');
  assert.ok(displayWidth(truncateStart('启动功能、模块或系统性优化', 10)) <= 10);
  assert.equal(truncateStart('abc', 0), '');
});

test('识别 Apple Terminal 并把破折号替换为 ASCII 显示', () => {
  const caps = detectTerminalCapabilities({
    columns: 100, isTTY: true, term: 'xterm-256color', termProgram: 'Apple_Terminal',
    noColor: false, ci: false, reduceMotion: false,
  });
  assert.equal(caps.appleTerminal, true);
  assert.deepEqual(detectTerminalCapabilities({
    columns: 100, isTTY: true, term: 'xterm-256color', termProgram: 'iTerm.app',
    noColor: false, ci: false, reduceMotion: false,
  }), {
    columns: 100, density: 'full', color: true, unicode: true, motion: true,
  });
  assert.equal(terminalSafeText('a—b–c', false), 'a—b–c');
  assert.equal(terminalSafeText('a—b–c', true), 'a--b-c');
});
