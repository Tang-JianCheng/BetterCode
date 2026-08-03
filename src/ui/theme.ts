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
  | '#FFA500';

export interface BetterCodeTheme {
  brand: ThemeColor;
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

export const BETTERCODE_THEME: BetterCodeTheme = {
  brand: '#FFA500',
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
