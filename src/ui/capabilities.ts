import stringWidth from 'string-width';

export type LayoutDensity = 'full' | 'compact' | 'narrow';

export interface TerminalCapabilities {
  columns: number;
  rows?: number;
  density: LayoutDensity;
  color: boolean;
  unicode: boolean;
  motion: boolean;
}

export interface TerminalEnvironment {
  columns?: number;
  rows?: number;
  isTTY?: boolean;
  term?: string;
  noColor?: boolean;
  forceAscii?: boolean;
  reduceMotion?: boolean;
  ci?: boolean;
}

export function densityForColumns(columns: number): LayoutDensity {
  if (columns >= 100) return 'full';
  if (columns >= 64) return 'compact';
  return 'narrow';
}

export function detectTerminalCapabilities(
  environment: TerminalEnvironment = {},
): TerminalCapabilities {
  const columns = Math.max(20, Math.floor(environment.columns ?? process.stdout.columns ?? 80));
  const rows = environment.rows ?? process.stdout.rows;
  const term = environment.term ?? process.env.TERM;
  const dumb = term === 'dumb';
  const noColor = environment.noColor ?? Object.hasOwn(process.env, 'NO_COLOR');
  const forceAscii = environment.forceAscii ?? process.env.BETTERCODE_ASCII === '1';
  const reduceMotion = environment.reduceMotion
    ?? process.env.BETTERCODE_REDUCE_MOTION === '1';
  const ci = environment.ci ?? Boolean(process.env.CI);
  const isTTY = environment.isTTY ?? process.stdout.isTTY === true;
  return {
    columns,
    ...(rows ? { rows } : {}),
    density: densityForColumns(columns),
    color: isTTY && !noColor && !dumb,
    unicode: !forceAscii && !dumb,
    motion: isTTY && !reduceMotion && !ci && !dumb,
  };
}

export function displayWidth(value: string): number {
  return stringWidth(value);
}

export function truncateDisplay(
  value: string,
  maxWidth: number,
  ellipsis = '…',
): string {
  if (maxWidth <= 0) return '';
  if (displayWidth(value) <= maxWidth) return value;
  const marker = displayWidth(ellipsis) <= maxWidth
    ? ellipsis
    : '.'.repeat(Math.min(maxWidth, 3));
  const contentWidth = maxWidth - displayWidth(marker);
  if (contentWidth <= 0) return marker;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let result = '';
  let width = 0;
  for (const { segment } of segmenter.segment(value)) {
    const segmentWidth = displayWidth(segment);
    if (width + segmentWidth > contentWidth) break;
    result += segment;
    width += segmentWidth;
  }
  return `${result}${marker}`;
}

export function padDisplay(value: string, width: number, ellipsis = '…'): string {
  const content = truncateDisplay(value, Math.max(0, width), ellipsis);
  return `${content}${' '.repeat(Math.max(0, width - displayWidth(content)))}`;
}

export function terminalEnvironmentFromProcess(): TerminalEnvironment {
  return {
    columns: process.stdout.columns,
    rows: process.stdout.rows,
    isTTY: process.stdout.isTTY,
    term: process.env.TERM,
    noColor: Object.hasOwn(process.env, 'NO_COLOR'),
    forceAscii: process.env.BETTERCODE_ASCII === '1',
    reduceMotion: process.env.BETTERCODE_REDUCE_MOTION === '1',
    ci: Boolean(process.env.CI),
  };
}
