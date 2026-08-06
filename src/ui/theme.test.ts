import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTheme,
  BETTERCODE_THEME,
  currentThemeName,
  resolveThemeName,
  THEME_NAMES,
} from './theme.js';

test('默认使用暗色主题', () => {
  assert.equal(currentThemeName(), 'dark');
  assert.equal(BETTERCODE_THEME.text, 'white');
  assert.equal(BETTERCODE_THEME.border, 'gray');
});

test('applyTheme 切换主题并实时生效', () => {
  applyTheme('light');
  assert.equal(currentThemeName(), 'light');
  assert.equal(BETTERCODE_THEME.text, 'black');
  assert.equal(BETTERCODE_THEME.accent, 'blue');
  assert.equal(BETTERCODE_THEME.border, 'gray');
});

test('高对比主题边框与正文保持高亮', () => {
  applyTheme('high-contrast');
  assert.equal(currentThemeName(), 'high-contrast');
  assert.equal(BETTERCODE_THEME.border, 'white');
  assert.equal(BETTERCODE_THEME.text, 'white');
  applyTheme('dark');
});

test('品牌色各主题保持一致', () => {
  for (const name of THEME_NAMES) {
    applyTheme(name);
    assert.equal(BETTERCODE_THEME.brand, '#FFA500');
  }
  applyTheme('dark');
});

test('resolveThemeName 优先级：环境变量 > 配置 > 默认', () => {
  assert.equal(resolveThemeName({}, undefined), 'dark');
  assert.equal(resolveThemeName({}, 'light'), 'light');
  assert.equal(resolveThemeName({ BETTERCODE_THEME: 'high-contrast' }, 'light'), 'high-contrast');
  // 非法值忽略并回退
  assert.equal(resolveThemeName({ BETTERCODE_THEME: 'unknown' }, 'light'), 'light');
  assert.equal(resolveThemeName({ BETTERCODE_THEME: 'unknown' }, undefined), 'dark');
});
