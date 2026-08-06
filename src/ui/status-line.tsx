import React from 'react';
import { Box, Text } from 'ink';
import type { AgentMode } from '../agent/types.js';
import type { PermissionMode } from '../permission/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { truncateDisplay } from './capabilities.js';
import { BETTERCODE_THEME } from './theme.js';

export interface StatusLineProps {
  providerName: string;
  model: string;
  agentMode: AgentMode;
  permissionMode: PermissionMode;
  /** 当前上下文的真实估算占用（Token） */
  contextTokens: number;
  /** 上下文窗口容量（Token） */
  contextWindow: number;
  sessionId: string;
  capabilities: TerminalCapabilities;
}

/** 紧凑 Token 格式：>=1m 显示 m，>=1k 显示 k，否则原数。 */
function compactTokens(value: number): string {
  if (value >= 1_000_000) {
    const amount = value / 1_000_000;
    return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}m`;
  }
  if (value >= 1_000) {
    const amount = value / 1_000;
    return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}k`;
  }
  return String(value);
}

/**
 * 极简状态行——默认开启，通过 /statusline 切换显示在输入区底部。
 * 展示模型名、Agent 模式、权限模式、当前上下文真实占用与窗口容量、会话；
 * 数据由 App 每次渲染从当前状态取值（消息/模式变化即刷新）。
 */
export function StatusLine({
  providerName,
  model,
  agentMode,
  permissionMode,
  contextTokens,
  contextWindow,
  sessionId,
  capabilities,
}: StatusLineProps) {
  const mode = agentMode === 'plan' ? '[PLAN]' : '[DEFAULT]';
  const text = [
    `${providerName}/${model}`,
    mode,
    `权限 ${permissionMode}`,
    `上下文 ${compactTokens(contextTokens)}/${compactTokens(contextWindow)}`,
    `会话 ${sessionId}`,
  ].join(' · ');
  const content = truncateDisplay(
    text,
    Math.max(16, capabilities.columns - 2),
    capabilities.unicode ? '…' : '...',
  );
  return (
    <Box>
      <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
        {content}
      </Text>
    </Box>
  );
}
