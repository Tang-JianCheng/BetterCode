import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { PresentationTone } from '../presentation/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { BETTERCODE_THEME, toneColor } from './theme.js';
import { LogoRenderer, PixelLogo } from './startup-banner.js';

export interface StartupBrandProps {
  capabilities: TerminalCapabilities;
  version: string;
}

export function bannerLines(capabilities: TerminalCapabilities): readonly string[] {
  const availableWidth = Math.max(20, capabilities.columns - 2);
  return new LogoRenderer({
    width: availableWidth,
    center: true,
    animation: false,
    unicode: capabilities.unicode,
  }).render('BETTERCODE');
}

export function StartupBrand({ capabilities, version }: StartupBrandProps) {
  const [revealed, setRevealed] = useState(!capabilities.motion);
  useEffect(() => setRevealed(!capabilities.motion), [capabilities.motion]);
  const revealDetails = useCallback(() => setRevealed(true), []);
  const symbol = (unicode: string, ascii: string) => capabilities.unicode ? unicode : ascii;
  return (
    <Box flexDirection="column" marginBottom={1} width={Math.max(20, capabilities.columns - 2)}>
      <PixelLogo capabilities={capabilities} onAnimationComplete={revealDetails} />
      <Box flexDirection="column" alignItems="center" height={4} marginTop={1}>
        <Text bold color={capabilities.color ? BETTERCODE_THEME.brandHighlight : undefined}>
          {revealed ? `${symbol('✦', '*')} BetterCode Agent` : ' '}
          {revealed ? <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}> v{version}</Text> : undefined}
        </Text>
        <Text color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
          {revealed ? `${symbol('⚡', '>')} AI Coding Assistant` : ' '}
        </Text>
        <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {revealed ? `${symbol('◉', 'o')} Model: DeepSeek` : ' '}
        </Text>
        <Text color={capabilities.color ? BETTERCODE_THEME.success : undefined}>
          {revealed ? `${symbol('◉', 'o')} Ready` : ' '}
        </Text>
      </Box>
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
