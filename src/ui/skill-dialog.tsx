import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SkillMetadata } from '../skill/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import {
  displayWidth,
  padDisplay,
  terminalSafeText,
  truncateDisplay,
} from './capabilities.js';
import { BETTERCODE_THEME } from './theme.js';

const VISIBLE_SKILL_COUNT = 9;

export interface SkillDialogProps {
  skills: readonly SkillMetadata[];
  onSelect: (name: string) => void;
  onCancel: () => void;
  capabilities: TerminalCapabilities;
}

function modeLabel(mode: SkillMetadata['mode']): string {
  return mode === 'isolated' ? '独立' : '共享';
}

/**
 * /skill 动态命令面板：列出全部可用 Skill（名称左对齐、模式与描述右对齐），
 * Enter 运行选中的 Skill，Esc 退出。支持方向键选择、整行高亮、超一页滚动与剩余数量提示。
 */
export function SkillDialog({ skills, onSelect, onCancel, capabilities }: SkillDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const appleTerminal = capabilities.appleTerminal === true;
  const safeText = (value: string) => terminalSafeText(value, appleTerminal);

  const visible = useMemo(() => {
    if (skills.length === 0) return { start: 0, items: [] as SkillMetadata[] };
    const start = Math.max(0, Math.min(
      selectedIndex - Math.floor(VISIBLE_SKILL_COUNT / 2),
      Math.max(0, skills.length - VISIBLE_SKILL_COUNT),
    ));
    return { start, items: skills.slice(start, start + VISIBLE_SKILL_COUNT) };
  }, [selectedIndex, skills]);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (skills.length === 0) return;
    if (key.upArrow) {
      setSelectedIndex(index => (index - 1 + skills.length) % skills.length);
    } else if (key.downArrow) {
      setSelectedIndex(index => (index + 1) % skills.length);
    } else if (key.return) {
      onSelect(skills[selectedIndex].name);
    }
  });

  const border = capabilities.unicode ? '─' : '-';
  const marker = capabilities.unicode ? '❯' : '>';
  const contentWidth = Math.max(8, capabilities.columns - 2);
  const markerWidth = 2;
  const gap = 2;

  const metaText = (skill: SkillMetadata): string => {
    const active = modeLabel(skill.mode);
    return `${active} · ${safeText(skill.description)}`;
  };
  const maxMetaWidth = skills.reduce(
    (max, skill) => Math.max(max, displayWidth(metaText(skill))),
    0,
  );
  const nameWidth = Math.max(
    8,
    contentWidth - markerWidth - gap - Math.min(maxMetaWidth, Math.max(8, Math.floor(contentWidth * 0.4))),
  );
  const metaWidth = Math.max(8, contentWidth - markerWidth - gap - nameWidth);

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
          {' [SKILL] 可用 Skill'}
        </Text>
        <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {' '}{skills.length} 个
        </Text>
      </Box>
      {visible.items.length === 0 ? (
        <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {'  '}没有可用 Skill
        </Text>
      ) : visible.items.map((skill, index) => {
        const absoluteIndex = visible.start + index;
        const isSelected = absoluteIndex === selectedIndex;
        const name = padDisplay(
          safeText(`/${skill.name}`),
          nameWidth,
          capabilities.unicode ? '…' : '...',
        );
        const meta = padDisplay(
          truncateDisplay(metaText(skill), metaWidth, capabilities.unicode ? '…' : '...'),
          metaWidth,
        );
        const rowText = `${isSelected ? `${marker} ` : '  '}${name}${' '.repeat(gap)}${meta}`;
        return (
          <Box key={skill.name} width={contentWidth}>
            <Text
              bold={isSelected}
              inverse={isSelected && capabilities.color}
              color={capabilities.color
                ? isSelected ? BETTERCODE_THEME.selected : BETTERCODE_THEME.text
                : undefined}
            >
              {rowText}
            </Text>
          </Box>
        );
      })}
      {visible.start + visible.items.length < skills.length ? (
        <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {'  '}还有 {skills.length - visible.start - visible.items.length} 个候选
        </Text>
      ) : undefined}
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {border.repeat(contentWidth)}
      </Text>
      <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
        {'  '}↑↓ 选择 · Enter 运行 · Esc 退出
      </Text>
    </Box>
  );
}
