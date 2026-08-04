import React from 'react';
import { Box, Text } from 'ink';
import type { PresentationTone } from '../presentation/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { terminalSafeText, truncateDisplay } from './capabilities.js';
import { BETTERCODE_THEME, TONE_LABELS, toneColor } from './theme.js';

export interface InteractionOption<T extends string = string> {
  value: T;
  label: string;
  shortcut?: string;
  description?: string;
}

export interface InteractionPanelProps<T extends string = string> {
  title: string;
  tone: PresentationTone;
  details?: readonly string[];
  options: readonly InteractionOption<T>[];
  selectedIndex: number;
  footer: string;
  capabilities: TerminalCapabilities;
}

export function moveInteractionIndex(
  current: number,
  count: number,
  direction: 'up' | 'down',
): number {
  if (count <= 0) return 0;
  return direction === 'up'
    ? (current - 1 + count) % count
    : (current + 1) % count;
}

export function InteractionPanel<T extends string>({
  title,
  tone,
  details = [],
  options,
  selectedIndex,
  footer,
  capabilities,
}: InteractionPanelProps<T>) {
  const border = capabilities.unicode ? '─' : '-';
  const appleTerminal = capabilities.appleTerminal === true;
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={capabilities.color ? toneColor(tone) : undefined}>
          {capabilities.unicode ? '╭─' : '+-'}
        </Text>
        <Text bold color={capabilities.color ? toneColor(tone) : undefined}>
          {' '}[{TONE_LABELS[tone]}] {terminalSafeText(title, appleTerminal)}
        </Text>
      </Box>
      {details.map((detail, index) => (
        <Text key={`${index}-${detail}`}>  {truncateDisplay(terminalSafeText(detail, appleTerminal), Math.max(10, capabilities.columns - 4))}</Text>
      ))}
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {'  '}{border.repeat(Math.max(8, Math.min(capabilities.columns - 4, 28)))}
      </Text>
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        const marker = selected ? (capabilities.unicode ? '❯' : '>') : ' ';
        const label = terminalSafeText(option.label, appleTerminal);
        const description = option.description
          ? ` · ${terminalSafeText(option.description, appleTerminal)}`
          : '';
        return (
          <Text
            key={option.value}
            bold={selected}
            inverse={selected && capabilities.color}
            color={selected && capabilities.color ? BETTERCODE_THEME.selected : undefined}
          >
            {' '}{marker} {option.shortcut ? `[${option.shortcut}] ` : ''}{label}{description}
          </Text>
        );
      })}
      <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>  {footer}</Text>
      <Text color={capabilities.color ? toneColor(tone) : undefined}>
        {capabilities.unicode ? '╰' : '+'}{border.repeat(Math.max(8, Math.min(capabilities.columns - 1, 14)))}
      </Text>
    </Box>
  );
}
