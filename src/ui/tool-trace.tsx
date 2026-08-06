import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { ToolTraceEntry } from '../presentation/types.js';
import type { ToolResult } from '../tool/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { terminalSafeText, truncateDisplay } from './capabilities.js';
import { BETTERCODE_THEME } from './theme.js';

function statusSymbol(status: ToolTraceEntry['status'], unicode: boolean): string {
  if (!unicode) {
    if (status === 'success') return '[ok]';
    if (status === 'error') return '[x]';
    if (status === 'denied') return '[--]';
    return '...';
  }
  if (status === 'success') return '✓';
  if (status === 'error') return '✗';
  if (status === 'denied') return '⛔';
  return '⚙';
}

/** 工具参数转紧凑摘要：JSON 序列化后截断，避免超大参数撑爆内存。 */
export function summarizeToolArguments(arguments_: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(arguments_);
    return text ? text.slice(0, 400) : '';
  } catch {
    return '';
  }
}

/** 工具输出转摘要：折叠空白并截断，渲染时再按列宽截断。 */
export function summarizeToolResult(output: string): string {
  return output.trim().replace(/\s+/gu, ' ').slice(0, 400);
}

/** 由 ToolResult 推导展示状态：拒绝类错误单独标记，避免误导为执行失败。 */
export function toolResultStatus(result: ToolResult): ToolTraceEntry['status'] {
  if (result.ok) return 'success';
  const code = result.error?.code ?? '';
  if (code === 'HOOK_DENIED' || code.startsWith('PERMISSION')) return 'denied';
  return 'error';
}

export interface ToolTraceViewProps {
  entries: readonly ToolTraceEntry[];
  capabilities: TerminalCapabilities;
  /** 流式期间的实时视图：始终展开并显示进行中状态，不参与折叠/展开切换 */
  live?: boolean;
  /** 外部 Enter 切换折叠/展开的信号：自增变化即切换一次 */
  toggleSignal?: number;
}

/**
 * 工具调用折叠视图。折叠时显示一行摘要，展开时逐条列出工具名、参数与结果。
 * 展开状态由组件内部维护，外部可通过 toggleSignal（自增）触发切换。
 */
export function ToolTraceView({
  entries,
  capabilities,
  live = false,
  toggleSignal,
}: ToolTraceViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [lastSignal, setLastSignal] = useState(0);
  useEffect(() => {
    if (toggleSignal === undefined || toggleSignal === lastSignal) return;
    setLastSignal(toggleSignal);
    setExpanded(current => !current);
  }, [toggleSignal, lastSignal]);

  const isExpanded = live || expanded;
  const unicode = capabilities.unicode;
  const ellipsis = unicode ? '…' : '...';
  const appleTerminal = capabilities.appleTerminal === true;
  const contentWidth = Math.max(8, capabilities.columns - 2);
  const muted = capabilities.color ? BETTERCODE_THEME.muted : undefined;
  const accent = capabilities.color ? BETTERCODE_THEME.accent : undefined;
  const textColor = capabilities.color ? BETTERCODE_THEME.text : undefined;

  if (!isExpanded) {
    return (
      <Box marginBottom={1}>
        <Text dimColor color={muted}>
          {unicode ? '▶' : '>'} 工具调用 × {entries.length}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={live ? accent : muted}>
        {unicode ? (live ? '⚙ ' : '▼ ') : (live ? '> ' : 'v ')}
        工具调用{live ? '' : ` × ${entries.length}`}
      </Text>
      {entries.map(entry => {
        const symbol = statusSymbol(entry.status, unicode);
        const statusColor = !capabilities.color
          ? undefined
          : entry.status === 'error'
            ? BETTERCODE_THEME.danger
            : entry.status === 'denied'
              ? BETTERCODE_THEME.warning
              : entry.status === 'success'
                ? BETTERCODE_THEME.success
                : BETTERCODE_THEME.accent;
        const args = entry.args
          ? ` ${truncateDisplay(
              terminalSafeText(entry.args, appleTerminal),
              Math.max(16, Math.floor(contentWidth * 0.4)),
              ellipsis,
            )}`
          : '';
        const result = entry.result
          ? truncateDisplay(
              terminalSafeText(entry.result, appleTerminal),
              Math.max(20, contentWidth - 12),
              ellipsis,
            )
          : '';
        return (
          <Box key={entry.callId} paddingLeft={2}>
            <Text color={statusColor}>{symbol}</Text>
            <Text color={textColor}>
              {' '}{terminalSafeText(entry.toolName, appleTerminal)}{args}
            </Text>
            {result ? (
              <Text dimColor color={muted}> · {result}</Text>
            ) : undefined}
          </Box>
        );
      })}
    </Box>
  );
}
