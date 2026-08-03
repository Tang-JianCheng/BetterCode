import React from 'react';
import { Box, Text } from 'ink';
import type { PresentationTone } from '../presentation/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { BETTERCODE_THEME, toneColor } from './theme.js';

// 立体横幅：ANSI Shadow 风格 BETTERCODE 字表，字母紧贴无间隔，连成一个整体。
const BEVELED_BANNER = [
  '██████╗███████╗████████╗████████╗███████╗██████╗██████╗██████╗██████╗███████╗      ',
  '██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '██████╔╝█████╗   ██║   ██║█████╗██████╔╝██║██║   ██║██║  ██║█████╗                 ',
  '██╔══██╗██╔══╝   ██║   ██║██╔══╝██╔══██╗██║██║   ██║██║  ██║██╔══╝                 ',
  '██████╔╝███████╗   ██║   ██║███████╗██║  ██║╚██████╗╚██████╔╝██████╔╝███████╗      ',
  '╚═════╝╚══════╝   ╚═╝   ╚═╝╚══════╝╚═╝  ╚═╝╚═════╝╚═════╝╚═════╝╚══════╝           ',
] as const;

// 5 列宽 × 7 行高的像素字体，`#` 作为占位块，渲染时替换成 █ 或 ASCII 块。
const PIXEL_FONT: Record<string, readonly string[]> = {
  B: ['#####', '#   #', '#   #', '#####', '#   #', '#   #', '#####'],
  E: ['#####', '#    ', '#    ', '#####', '#    ', '#    ', '#####'],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  R: ['#####', '#   #', '#   #', '#####', '##   ', '# #  ', '#  # '],
  C: ['#### ', '#    ', '#    ', '#    ', '#    ', '#    ', '#### '],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  D: ['#####', '#   #', '#   #', '#   #', '#   #', '#   #', '#####'],
};

// 3 列宽 × 5 行高的窄屏像素字体。
const PIXEL_FONT_NARROW: Record<string, readonly string[]> = {
  B: ['###', '# #', '###', '# #', '###'],
  E: ['###', '#  ', '###', '#  ', '###'],
  T: ['###', ' # ', ' # ', ' # ', ' # '],
  R: ['###', '# #', '###', '# #', '#  '],
  C: ['###', '#  ', '#  ', '#  ', '###'],
  O: ['###', '# #', '# #', '# #', '###'],
  D: ['## ', '# #', '# #', '# #', '## '],
};

export interface StartupBrandProps {
  capabilities: TerminalCapabilities;
  version: string;
}

export function bannerLines(capabilities: TerminalCapabilities): readonly string[] {
  if (capabilities.unicode && capabilities.density !== 'narrow' && capabilities.columns >= 84) {
    return BEVELED_BANNER;
  }
  const narrow = capabilities.density === 'narrow';
  const font = narrow ? PIXEL_FONT_NARROW : PIXEL_FONT;
  const block = capabilities.unicode ? '█' : '#';
  const rows = narrow ? 5 : 7;
  const letters = 'BETTERCODE';
  return Array.from({ length: rows }, (_, row) =>
    letters.split('').map(letter => font[letter][row].replaceAll('#', block)).join(' '),
  );
}

export function StartupBrand({ capabilities, version }: StartupBrandProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {bannerLines(capabilities).map((line, index) => (
          <Text key={`${index}-${line}`} color={capabilities.color ? BETTERCODE_THEME.brand : undefined}>
            {line}
          </Text>
        ))}
      </Box>
      <Box>
        <Text bold color={capabilities.color ? BETTERCODE_THEME.brand : undefined}>BetterCode</Text>
        <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}> v{version}</Text>
        <Text color={capabilities.color ? BETTERCODE_THEME.accent : undefined}> · 小码准备好了</Text>
      </Box>
      <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
        把目标交给我，剩下的我们一起拆开做。
      </Text>
    </Box>
  );
}

export interface MascotMarkProps {
  tone?: PresentationTone;
  capabilities: TerminalCapabilities;
}

export function mascotMark(tone: PresentationTone, unicode: boolean): string {
  if (!unicode) {
    return tone === 'danger' ? '[x]' : tone === 'warning' ? '[!]' : tone === 'success' ? '[+]' : '[*]';
  }
  return tone === 'danger' ? '◆' : tone === 'warning' ? '▲' : tone === 'success' ? '●' : '◇';
}

export function MascotMark({ tone = 'info', capabilities }: MascotMarkProps) {
  return (
    <Text bold color={capabilities.color ? toneColor(tone) : undefined}>
      {mascotMark(tone, capabilities.unicode)}
    </Text>
  );
}
