import type { ThemeName } from '../config/types.js';
import type { PresentationTone } from '../presentation/types.js';

export type ThemeColor =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'gray'
  | '#FFA500'
  | '#B45309'
  | '#FFB547'
  | '#713F12';

export interface BetterCodeTheme {
  brand: ThemeColor;
  brandHighlight: ThemeColor;
  brandShadow: ThemeColor;
  brandGhost: ThemeColor;
  accent: ThemeColor;
  text: ThemeColor;
  muted: ThemeColor;
  border: ThemeColor;
  success: ThemeColor;
  info: ThemeColor;
  warning: ThemeColor;
  danger: ThemeColor;
  selected: ThemeColor;
}

const DARK_THEME: BetterCodeTheme = {
  brand: '#FFA500',
  brandHighlight: '#FFB547',
  brandShadow: '#B45309',
  brandGhost: '#713F12',
  accent: 'cyan',
  text: 'white',
  // 黑底终端下正文统一用白/灰白，弱化文字由 dimColor 叠加成灰白
  muted: 'white',
  border: 'gray',
  success: 'green',
  info: 'cyan',
  warning: 'yellow',
  danger: 'red',
  selected: 'cyan',
};

const LIGHT_THEME: BetterCodeTheme = {
  brand: '#FFA500',
  brandHighlight: '#FFB547',
  brandShadow: '#B45309',
  brandGhost: '#713F12',
  // 白底终端用深色文字保证对比度，accent/info/selected 统一用蓝色
  accent: 'blue',
  text: 'black',
  muted: 'gray',
  border: 'gray',
  success: 'green',
  info: 'blue',
  warning: 'yellow',
  danger: 'red',
  selected: 'blue',
};

const HIGH_CONTRAST_THEME: BetterCodeTheme = {
  brand: '#FFA500',
  brandHighlight: '#FFB547',
  brandShadow: '#B45309',
  brandGhost: '#713F12',
  accent: 'cyan',
  text: 'white',
  muted: 'white',
  // 高对比主题用白色边框，弱化文字不再叠加 dimColor，保持全亮
  border: 'white',
  success: 'green',
  info: 'cyan',
  warning: 'yellow',
  danger: 'red',
  selected: 'cyan',
};

const THEMES: Record<ThemeName, BetterCodeTheme> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
  'high-contrast': HIGH_CONTRAST_THEME,
};

export const THEME_NAMES: readonly ThemeName[] = ['dark', 'light', 'high-contrast'];

let activeTheme: BetterCodeTheme = DARK_THEME;
let activeThemeName: ThemeName = 'dark';

/**
 * BETTERCODE_THEME 通过 getter 转发到当前激活主题，现有组件 import 后
 * 每次渲染读取都能拿到最新色板，运行时切换不需要重建引用。
 */
export const BETTERCODE_THEME: BetterCodeTheme = {
  get brand(): ThemeColor { return activeTheme.brand; },
  get brandHighlight(): ThemeColor { return activeTheme.brandHighlight; },
  get brandShadow(): ThemeColor { return activeTheme.brandShadow; },
  get brandGhost(): ThemeColor { return activeTheme.brandGhost; },
  get accent(): ThemeColor { return activeTheme.accent; },
  get text(): ThemeColor { return activeTheme.text; },
  get muted(): ThemeColor { return activeTheme.muted; },
  get border(): ThemeColor { return activeTheme.border; },
  get success(): ThemeColor { return activeTheme.success; },
  get info(): ThemeColor { return activeTheme.info; },
  get warning(): ThemeColor { return activeTheme.warning; },
  get danger(): ThemeColor { return activeTheme.danger; },
  get selected(): ThemeColor { return activeTheme.selected; },
};

export function applyTheme(name: ThemeName): void {
  activeTheme = THEMES[name] ?? DARK_THEME;
  activeThemeName = name;
}

export function currentThemeName(): ThemeName {
  return activeThemeName;
}

function isThemeName(value: string | undefined): value is ThemeName {
  return value !== undefined && THEME_NAMES.includes(value as ThemeName);
}

/**
 * 解析主题名：环境变量 BETTERCODE_THEME > config.yaml 的 ui.theme > 默认 dark。
 * 非法值忽略并回退下一优先级。
 */
export function resolveThemeName(
  environment: NodeJS.ProcessEnv,
  configured?: ThemeName,
): ThemeName {
  if (isThemeName(environment.BETTERCODE_THEME)) return environment.BETTERCODE_THEME;
  if (isThemeName(configured)) return configured;
  return 'dark';
}

export const TONE_LABELS: Record<PresentationTone, string> = {
  neutral: 'NOTE',
  info: 'INFO',
  success: 'OK',
  warning: 'WARN',
  danger: 'ERROR',
};

export function toneColor(tone: PresentationTone): ThemeColor {
  return tone === 'neutral' ? BETTERCODE_THEME.muted : BETTERCODE_THEME[tone];
}
