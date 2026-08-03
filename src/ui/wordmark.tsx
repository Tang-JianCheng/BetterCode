import figlet from 'figlet';
import React from 'react';
import { Box, Text } from 'ink';
import type { TerminalCapabilities } from './capabilities.js';
import { BETTERCODE_THEME } from './theme.js';

const WORDMARK_TEXT = 'BETTERCODE';
const WORDMARK_HEIGHT = 6;

// 每个数字指定对应字间连接所在的行。错开连接高度，避免生成贯穿整词的辅助横线。
const JOIN_ROWS = [3, 0, 1, 4, 4, 3, 4, 3, 2] as const;

const CONNECTED_FALLBACK = [
  '██████╗ ████████████████╗████████╗███████╗██████╗  ██████╗ ██████╗ ██████╗ ███████╗',
  '██╔══██╗██╔════╝╚══██╔══██══██╔══╝██╔════╝██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '██████╔╝█████╗     ██║      ██║   █████╗  ██████╔╝██║     ██║   ██║██║  ████████╗',
  '██╔══█████╔══╝     ██║      ██║   ██╔══╝  ██╔══█████║     ██║   █████║  ██║██╔══╝',
  '██████╔╝███████╗   ██║      ██║  ███████████║  ██║╚██████████████╔╝██████╔╝███████╗',
  '╚═════╝ ╚══════╝   ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
] as const;

const PIXEL_FONT: Record<string, readonly string[]> = {
  B: ['#####', '#   #', '#   #', '#####', '#   #', '#   #', '#####'],
  E: ['#####', '#    ', '#    ', '#####', '#    ', '#    ', '#####'],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  R: ['#####', '#   #', '#   #', '#####', '##   ', '# #  ', '#  # '],
  C: ['#### ', '#    ', '#    ', '#    ', '#    ', '#    ', '#### '],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  D: ['#####', '#   #', '#   #', '#   #', '#   #', '#   #', '#####'],
};

const PIXEL_FONT_NARROW: Record<string, readonly string[]> = {
  B: ['###', '# #', '###', '# #', '###'],
  E: ['###', '#  ', '###', '#  ', '###'],
  T: ['###', ' # ', ' # ', ' # ', ' # '],
  R: ['###', '# #', '###', '# #', '#  '],
  C: ['###', '#  ', '#  ', '#  ', '###'],
  O: ['###', '# #', '# #', '# #', '###'],
  D: ['## ', '# #', '# #', '# #', '## '],
};

type FigletRenderer = (
  text: string,
  options: Parameters<typeof figlet.textSync>[1],
) => string;

export interface WordmarkJoin {
  row: number;
  leftColumn: number;
  rightColumn: number;
}

export interface ConnectedWordmark {
  lines: readonly string[];
  joins: readonly WordmarkJoin[];
}

function fallbackWordmark(): ConnectedWordmark {
  const widths = [8, 8, 9, 9, 8, 8, 8, 9, 8, 8];
  let offset = 0;
  const starts = widths.map(width => {
    const start = offset;
    offset += width;
    return start;
  });
  return {
    lines: CONNECTED_FALLBACK,
    joins: JOIN_ROWS.map((row, index) => ({
      row,
      leftColumn: starts[index] + widths[index] - 1,
      rightColumn: starts[index + 1],
    })),
  };
}

export function createConnectedWordmark(
  render: FigletRenderer = figlet.textSync,
): ConnectedWordmark {
  try {
    const glyphs = [...WORDMARK_TEXT].map(letter => {
      const lines = render(letter, {
        font: 'ANSI Shadow',
        horizontalLayout: 'full',
        verticalLayout: 'default',
        whitespaceBreak: false,
      }).trimEnd().split('\n');
      if (lines.length !== WORDMARK_HEIGHT) throw new Error('unexpected FIGfont height');
      const width = Math.max(...lines.map(line => [...line].length));
      if (width === 0) throw new Error('empty FIGfont glyph');
      return { lines: lines.map(line => [...line.padEnd(width)]), width };
    });

    const rows = Array.from({ length: WORDMARK_HEIGHT }, () => [] as string[]);
    const starts: number[] = [];
    let offset = 0;
    for (const glyph of glyphs) {
      starts.push(offset);
      for (let row = 0; row < WORDMARK_HEIGHT; row += 1) rows[row].push(...glyph.lines[row]);
      offset += glyph.width;
    }

    const joins = JOIN_ROWS.map((row, index) => {
      const leftColumn = starts[index] + glyphs[index].width - 1;
      const rightColumn = starts[index + 1];
      if (rows[row][leftColumn] === ' ' || rows[row][rightColumn] === ' ') {
        throw new Error('FIGfont boundary cannot be joined safely');
      }
      rows[row][leftColumn] = '█';
      rows[row][rightColumn] = '█';
      return { row, leftColumn, rightColumn };
    });

    return {
      lines: rows.map(row => row.join('').trimEnd()),
      joins,
    };
  } catch {
    return fallbackWordmark();
  }
}

const CONNECTED_WORDMARK = createConnectedWordmark();
const CONNECTED_WORDMARK_WIDTH = Math.max(...CONNECTED_WORDMARK.lines.map(line => [...line].length));

export function wordmarkLines(capabilities: TerminalCapabilities): readonly string[] {
  if (
    capabilities.unicode
    && capabilities.density !== 'narrow'
    && capabilities.columns >= CONNECTED_WORDMARK_WIDTH
  ) {
    return CONNECTED_WORDMARK.lines;
  }
  const narrow = capabilities.density === 'narrow';
  const font = narrow ? PIXEL_FONT_NARROW : PIXEL_FONT;
  const block = capabilities.unicode ? '█' : '#';
  const rows = narrow ? 5 : 7;
  return Array.from({ length: rows }, (_, row) =>
    [...WORDMARK_TEXT].map(letter => font[letter][row].replaceAll('#', block)).join(' '),
  );
}

export interface WordmarkProps {
  capabilities: TerminalCapabilities;
}

function wordmarkRuns(line: string): Array<{ shadow: boolean; value: string }> {
  const runs: Array<{ shadow: boolean; value: string }> = [];
  for (const character of line) {
    const shadow = /[╔╗╚╝═║]/u.test(character);
    const previous = runs.at(-1);
    if (previous?.shadow === shadow) previous.value += character;
    else runs.push({ shadow, value: character });
  }
  return runs;
}

export function Wordmark({ capabilities }: WordmarkProps) {
  const lines = wordmarkLines(capabilities);
  const beveled = lines === CONNECTED_WORDMARK.lines;
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`}>
          {wordmarkRuns(line).map((run, runIndex) => (
            <Text
              key={`${runIndex}-${run.value}`}
              color={capabilities.color
                ? (beveled && run.shadow ? BETTERCODE_THEME.brandShadow : BETTERCODE_THEME.brand)
                : undefined}
            >
              {run.value}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
