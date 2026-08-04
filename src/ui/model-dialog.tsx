import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TerminalCapabilities } from './capabilities.js';
import {
  displayWidth,
  padDisplay,
  terminalSafeText,
} from './capabilities.js';
import { BETTERCODE_THEME } from './theme.js';

const VISIBLE_PROVIDER_COUNT = 9;

export interface ModelOption {
  name: string;
  model: string;
  base_url: string;
}

export interface ModelDialogProps {
  providers: readonly ModelOption[];
  currentProviderName: string;
  onSelect: (name: string) => void;
  onCancel: () => void;
  capabilities: TerminalCapabilities;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ModelDialog({
  providers,
  currentProviderName,
  onSelect,
  onCancel,
  capabilities,
}: ModelDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const appleTerminal = capabilities.appleTerminal === true;

  const visible = useMemo(() => {
    if (providers.length === 0) return { start: 0, items: [] as ModelOption[] };
    const start = Math.max(0, Math.min(
      selectedIndex - Math.floor(VISIBLE_PROVIDER_COUNT / 2),
      Math.max(0, providers.length - VISIBLE_PROVIDER_COUNT),
    ));
    return { start, items: providers.slice(start, start + VISIBLE_PROVIDER_COUNT) };
  }, [selectedIndex, providers]);

  useInput((_input, key) => {
    if (providers.length === 0) return;
    if (key.upArrow) {
      setSelectedIndex(index => (index - 1 + providers.length) % providers.length);
    } else if (key.downArrow) {
      setSelectedIndex(index => (index + 1) % providers.length);
    } else if (key.return) {
      onSelect(providers[selectedIndex].name);
    } else if (key.escape) {
      onCancel();
    }
  });

  const border = capabilities.unicode ? '─' : '-';
  const marker = capabilities.unicode ? '❯' : '>';
  const contentWidth = Math.max(8, capabilities.columns - 2);
  const markerWidth = 2;
  const gap = 2;
  const metaText = (provider: ModelOption): string => {
    const current = provider.name === currentProviderName ? '[当前] ' : '';
    return `${current}${provider.model} · ${hostOf(provider.base_url)}`;
  };
  const nameWidth = Math.min(
    Math.max(12, ...providers.map(provider => displayWidth(terminalSafeText(provider.name, appleTerminal)))),
    Math.max(12, contentWidth - 2),
  );
  const maxMetaWidth = providers.reduce(
    (max, provider) => Math.max(max, displayWidth(terminalSafeText(metaText(provider), appleTerminal))),
    0,
  );
  const metaWidth = Math.max(12, Math.min(maxMetaWidth, contentWidth - markerWidth - gap - nameWidth));

  return (
    <Box flexDirection="column">
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {border.repeat(contentWidth)}
      </Text>
      <Box>
        <Text bold color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
          {capabilities.unicode ? '╭─' : '+-'}
        </Text>
        <Text bold color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
          {' [MODEL] 切换模型'}
        </Text>
        <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {' '}{providers.length} 个
        </Text>
      </Box>
      {visible.items.map((provider, index) => {
        const absoluteIndex = visible.start + index;
        const selected = absoluteIndex === selectedIndex;
        const name = padDisplay(
          terminalSafeText(provider.name, appleTerminal),
          nameWidth,
          capabilities.unicode ? '…' : '...',
        );
        const meta = padDisplay(
          terminalSafeText(metaText(provider), appleTerminal),
          metaWidth,
          capabilities.unicode ? '…' : '...',
        );
        const rowText = `${selected ? `${marker} ` : '  '}${name}${' '.repeat(gap)}${meta}`;
        return (
          <Box key={provider.name} width={contentWidth}>
            <Text
              bold={selected}
              inverse={selected && capabilities.color}
              color={capabilities.color
                ? selected ? BETTERCODE_THEME.selected : BETTERCODE_THEME.text
                : undefined}
            >
              {rowText}
            </Text>
          </Box>
        );
      })}
      {visible.start + visible.items.length < providers.length ? (
        <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {'  '}还有 {providers.length - visible.start - visible.items.length} 个候选
        </Text>
      ) : undefined}
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {border.repeat(contentWidth)}
      </Text>
      <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
        {'  '}↑↓ 选择 · Enter 切换 · Esc 退出
      </Text>
    </Box>
  );
}
