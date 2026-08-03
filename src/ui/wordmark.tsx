import figlet from 'figlet';
import React from 'react';
import { Box, Text } from 'ink';
import type { TerminalCapabilities } from './capabilities.js';
import { BETTERCODE_THEME } from './theme.js';

// 打包环境缺少字体文件时使用同款预生成快照，避免启动失败或字符集降级。
const SLANTED_FALLBACK = [
  '    ____  ____________________________  __________  ____  ______',
  '   / __ )/ ____/_  __/_  __/ ____/ __ \\/ ____/ __ \\/ __ \\/ ____/',
  '  / __  / __/   / /   / / / __/ / /_/ / /   / / / / / / / __/',
  ' / /_/ / /___  / /   / / / /___/ _, _/ /___/ /_/ / /_/ / /___',
  '/_____/_____/ /_/   /_/ /_____/_/ |_|\\____/\\____/_____/_____/',
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

export function createSlantedWordmark(render: FigletRenderer = figlet.textSync): readonly string[] {
  try {
    return render('BETTERCODE', {
      font: 'Slant',
      horizontalLayout: 'controlled smushing',
      verticalLayout: 'default',
      whitespaceBreak: false,
    }).trimEnd().split('\n').map(line => line.trimEnd());
  } catch {
    return SLANTED_FALLBACK;
  }
}

const SLANTED_WORDMARK = createSlantedWordmark();
const SLANTED_WORDMARK_WIDTH = Math.max(...SLANTED_WORDMARK.map(line => line.length));

export function wordmarkLines(capabilities: TerminalCapabilities): readonly string[] {
  if (capabilities.density !== 'narrow' && capabilities.columns >= SLANTED_WORDMARK_WIDTH) {
    return SLANTED_WORDMARK;
  }
  const narrow = capabilities.density === 'narrow';
  const font = narrow ? PIXEL_FONT_NARROW : PIXEL_FONT;
  const block = capabilities.unicode ? '█' : '#';
  const rows = narrow ? 5 : 7;
  return Array.from({ length: rows }, (_, row) =>
    [...'BETTERCODE'].map(letter => font[letter][row].replaceAll('#', block)).join(' '),
  );
}

export interface WordmarkProps {
  capabilities: TerminalCapabilities;
}

export function Wordmark({ capabilities }: WordmarkProps) {
  return (
    <Box flexDirection="column">
      {wordmarkLines(capabilities).map((line, index) => (
        <Text key={`${index}-${line}`} color={capabilities.color ? BETTERCODE_THEME.brand : undefined}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
