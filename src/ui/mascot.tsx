import React from 'react';
import { Box, Text } from 'ink';
import type { PresentationTone } from '../presentation/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { BETTERCODE_THEME, toneColor } from './theme.js';

const UNICODE_MASCOT = [
  '       ╭──────╮',
  '    ╭──╯  ▄▄  ╰──╮',
  '    │    ●  ●    │',
  '    │      ▿     │',
  '    ╰╮   ╰──╯   ╭╯',
  '     ╰──╮    ╭──╯',
  '       ╱╰────╯╲',
] as const;

const ASCII_MASCOT = [
  '    .------.',
  '  /  o  o   \\',
  ' |     v     |',
  '  \\  ----  /',
  '   /|____|\\',
] as const;

export interface StartupBrandProps {
  capabilities: TerminalCapabilities;
  version: string;
}

export function mascotLines(capabilities: TerminalCapabilities): readonly string[] {
  return capabilities.unicode && capabilities.density !== 'narrow'
    ? UNICODE_MASCOT
    : ASCII_MASCOT;
}

export function StartupBrand({ capabilities, version }: StartupBrandProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {mascotLines(capabilities).map((line, index) => (
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
