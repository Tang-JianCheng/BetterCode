import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SessionInfo } from '../session/session.js';
import type { TerminalCapabilities } from './capabilities.js';
import {
  displayWidth,
  padDisplay,
  terminalSafeText,
} from './capabilities.js';
import { BETTERCODE_THEME } from './theme.js';

const VISIBLE_SESSION_COUNT = 9;

export interface SessionDialogProps {
  sessions: readonly SessionInfo[];
  currentSessionId: string;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onCancel: () => void;
  capabilities: TerminalCapabilities;
}

function formatSessionTime(value: Date): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SessionDialog({
  sessions,
  currentSessionId,
  onSelect,
  onDelete,
  onCancel,
  capabilities,
}: SessionDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const appleTerminal = capabilities.appleTerminal === true;
  const safeSummary = (session: SessionInfo): string =>
    terminalSafeText(session.summary || '无摘要', appleTerminal);

  const visible = useMemo(() => {
    if (sessions.length === 0) return { start: 0, items: [] as SessionInfo[] };
    const start = Math.max(0, Math.min(
      selectedIndex - Math.floor(VISIBLE_SESSION_COUNT / 2),
      Math.max(0, sessions.length - VISIBLE_SESSION_COUNT),
    ));
    return { start, items: sessions.slice(start, start + VISIBLE_SESSION_COUNT) };
  }, [selectedIndex, sessions]);

  useInput((_input, key) => {
    if (sessions.length === 0) return;
    if (key.upArrow) {
      setSelectedIndex(index => (index - 1 + sessions.length) % sessions.length);
    } else if (key.downArrow) {
      setSelectedIndex(index => (index + 1) % sessions.length);
    } else if (key.return) {
      onSelect(sessions[selectedIndex].id);
    } else if (key.escape) {
      onCancel();
    } else if (key.delete || key.backspace) {
      onDelete(sessions[selectedIndex].id);
    }
  });

  const border = capabilities.unicode ? '─' : '-';
  const marker = capabilities.unicode ? '❯' : '>';
  const contentWidth = Math.max(8, capabilities.columns - 2);
  const markerWidth = 2;
  const gap = 2;
  const metaText = (session: SessionInfo): string => {
    const current = session.id === currentSessionId ? '[当前] ' : '';
    return `${current}${session.messageCount} 条 · ${formatSessionTime(session.modTime)}`;
  };
  const maxMetaWidth = sessions.reduce(
    (max, session) => Math.max(max, displayWidth(terminalSafeText(metaText(session), appleTerminal))),
    0,
  );
  const summaryWidth = Math.max(8, contentWidth - markerWidth - gap - maxMetaWidth);

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
          {' [SESSION] 历史会话'}
        </Text>
        <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {' '}{sessions.length} 个
        </Text>
      </Box>
      {visible.items.map((session, index) => {
        const absoluteIndex = visible.start + index;
        const selected = absoluteIndex === selectedIndex;
        const summary = padDisplay(
          safeSummary(session),
          summaryWidth,
          capabilities.unicode ? '…' : '...',
        );
        const meta = padDisplay(terminalSafeText(metaText(session), appleTerminal), maxMetaWidth);
        const rowText = `${selected ? `${marker} ` : '  '}${summary}${' '.repeat(gap)}${meta}`;
        return (
          <Box key={session.id} width={contentWidth}>
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
      {visible.start + visible.items.length < sessions.length ? (
        <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {'  '}还有 {sessions.length - visible.start - visible.items.length} 个候选
        </Text>
      ) : undefined}
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {border.repeat(contentWidth)}
      </Text>
      <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
        {'  '}↑↓ 选择 · Enter 恢复 · Delete 删除 · Esc 退出
      </Text>
    </Box>
  );
}
