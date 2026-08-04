import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ClaudeModelTier, ModelTierConfig } from '../config/types.js';
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
  model_tiers?: Partial<Record<ClaudeModelTier, ModelTierConfig>>;
  active_tier?: ClaudeModelTier;
}

export interface ModelTierOption {
  tier: ClaudeModelTier;
  model: string;
  context_window?: number;
}

export interface ModelDialogProps {
  providers?: readonly ModelOption[];
  currentProviderName?: string;
  onSelect?: (name: string) => void;
  tiers?: readonly ModelTierOption[];
  currentTier?: ClaudeModelTier;
  onSelectTier?: (tier: ClaudeModelTier) => void;
  onCancel: () => void;
  capabilities: TerminalCapabilities;
}

export const MODEL_TIER_LABELS: Record<ClaudeModelTier, string> = {
  sonnet: 'Sonnet',
  opus: 'Opus',
  haiku: 'Haiku',
  fable: 'Fable',
};

function formatContextWindow(value: number): string {
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value % 1_000 === 0) return `${value / 1_000}K`;
  return `${value} Token`;
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
  tiers,
  currentTier,
  onSelectTier,
  onCancel,
  capabilities,
}: ModelDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const appleTerminal = capabilities.appleTerminal === true;
  const tierMode = (tiers?.length ?? 0) > 0;

  interface DialogItem {
    key: string;
    name: string;
    meta: string;
    current: boolean;
    select: () => void;
  }

  const items = useMemo<DialogItem[]>(() => {
    if (tierMode) {
      return (tiers ?? []).map(tier => ({
        key: tier.tier,
        name: MODEL_TIER_LABELS[tier.tier],
        meta: `${tier.tier === currentTier ? '[当前] ' : ''}${tier.model}${tier.context_window === undefined ? '' : ` · ${formatContextWindow(tier.context_window)}`}`,
        current: tier.tier === currentTier,
        select: () => onSelectTier?.(tier.tier),
      }));
    }
    return (providers ?? []).map(provider => {
      const current = provider.name === currentProviderName ? '[当前] ' : '';
      return {
        key: provider.name,
        name: provider.name,
        meta: `${current}${provider.model} · ${hostOf(provider.base_url)}`,
        current: provider.name === currentProviderName,
        select: () => onSelect?.(provider.name),
      };
    });
  }, [currentProviderName, currentTier, onSelect, onSelectTier, providers, tierMode, tiers]);

  const visible = useMemo(() => {
    if (items.length === 0) return { start: 0, items: [] as DialogItem[] };
    const start = Math.max(0, Math.min(
      selectedIndex - Math.floor(VISIBLE_PROVIDER_COUNT / 2),
      Math.max(0, items.length - VISIBLE_PROVIDER_COUNT),
    ));
    return { start, items: items.slice(start, start + VISIBLE_PROVIDER_COUNT) };
  }, [items, selectedIndex]);

  useInput((_input, key) => {
    if (items.length === 0) return;
    if (key.upArrow) {
      setSelectedIndex(index => (index - 1 + items.length) % items.length);
    } else if (key.downArrow) {
      setSelectedIndex(index => (index + 1) % items.length);
    } else if (key.return) {
      items[selectedIndex]?.select();
    } else if (key.escape) {
      onCancel();
    }
  });

  const border = capabilities.unicode ? '─' : '-';
  const marker = capabilities.unicode ? '❯' : '>';
  const contentWidth = Math.max(8, capabilities.columns - 2);
  const markerWidth = 2;
  const gap = 2;
  const nameWidth = Math.min(
    Math.max(12, ...items.map(item => displayWidth(terminalSafeText(item.name, appleTerminal)))),
    Math.max(12, contentWidth - 2),
  );
  const maxMetaWidth = items.reduce(
    (max, item) => Math.max(max, displayWidth(terminalSafeText(item.meta, appleTerminal))),
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
          {' '}{items.length} 个
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
          terminalSafeText(provider.meta, appleTerminal),
          metaWidth,
          capabilities.unicode ? '…' : '...',
        );
        const rowText = `${selected ? `${marker} ` : '  '}${name}${' '.repeat(gap)}${meta}`;
        return (
          <Box key={provider.key} width={contentWidth}>
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
      {visible.start + visible.items.length < items.length ? (
        <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {'  '}还有 {items.length - visible.start - visible.items.length} 个候选
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
