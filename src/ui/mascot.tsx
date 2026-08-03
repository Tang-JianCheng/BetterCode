import React from 'react';
import { Box, Text } from 'ink';
import type { PresentationTone } from '../presentation/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { BETTERCODE_THEME, toneColor } from './theme.js';
import { Wordmark, wordmarkLines } from './wordmark.js';

export interface StartupBrandProps {
  capabilities: TerminalCapabilities;
  version: string;
}

export const bannerLines = wordmarkLines;

export function StartupBrand({ capabilities, version }: StartupBrandProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Wordmark capabilities={capabilities} />
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
