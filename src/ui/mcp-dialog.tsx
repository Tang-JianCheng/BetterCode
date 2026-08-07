import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { McpServerToolListing } from '../mcp/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import {
  displayWidth,
  padDisplay,
  terminalSafeText,
  truncateDisplay,
} from './capabilities.js';
import { BETTERCODE_THEME } from './theme.js';

const VISIBLE_COUNT = 9;

export interface McpDialogProps {
  servers: readonly McpServerToolListing[];
  onCancel: () => void;
  capabilities: TerminalCapabilities;
}

function transportLabel(transport: 'stdio' | 'http'): string {
  return transport === 'stdio' ? 'stdio' : 'http';
}

/**
 * /mcp 动态命令面板：第一级列出所有 Server（名称左对齐、传输/工具数/状态右对齐），
 * Enter 进入选中 Server 的工具列表，第二级列出该 Server 的全部工具，Esc 返回上一级。
 * 支持方向键选择、整行高亮、超一页滚动与剩余数量提示。
 */
export function McpDialog({ servers, onCancel, capabilities }: McpDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [drillServer, setDrillServer] = useState<string | undefined>();
  const appleTerminal = capabilities.appleTerminal === true;
  const safeText = (value: string) => terminalSafeText(value, appleTerminal);

  const activeServer = drillServer
    ? servers.find(server => server.name === drillServer)
    : undefined;
  const tools = activeServer?.tools ?? [];
  const itemCount = drillServer ? tools.length : servers.length;
  const selected = selectedIndex % Math.max(1, itemCount);

  const visible = useMemo(() => {
    if (itemCount === 0) return { start: 0, items: [] as string[] };
    const start = Math.max(0, Math.min(
      selected - Math.floor(VISIBLE_COUNT / 2),
      Math.max(0, itemCount - VISIBLE_COUNT),
    ));
    const names = drillServer
      ? tools.map(tool => tool.name)
      : servers.map(server => server.name);
    return { start, items: names.slice(start, start + VISIBLE_COUNT) };
  }, [drillServer, itemCount, selected, servers, tools]);

  useInput((_input, key) => {
    if (itemCount === 0) return;
    if (key.upArrow) {
      setSelectedIndex(index => (index - 1 + itemCount) % itemCount);
    } else if (key.downArrow) {
      setSelectedIndex(index => (index + 1) % itemCount);
    } else if (key.return) {
      if (drillServer === undefined) {
        const server = servers[selected];
        if (server?.tools.length) setDrillServer(server.name);
        else onCancel();
      }
    } else if (key.escape) {
      if (drillServer !== undefined) {
        setDrillServer(undefined);
        setSelectedIndex(0);
      } else {
        onCancel();
      }
    }
  });

  const border = capabilities.unicode ? '─' : '-';
  const marker = capabilities.unicode ? '❯' : '>';
  const contentWidth = Math.max(8, capabilities.columns - 2);
  const markerWidth = 2;
  const gap = 2;

  const metaFor = (server: McpServerToolListing): string => {
    const state = server.connected ? '已连接' : '失败';
    return `${transportLabel(server.transport)} · ${server.tools.length} 工具 · ${state}`;
  };
  const metaText = (item: string): string => {
    if (drillServer === undefined) {
      const server = servers.find(candidate => candidate.name === item);
      return server ? metaFor(server) : '';
    }
    const tool = tools.find(candidate => candidate.name === item);
    return tool ? (safeText(tool.description ?? '') || '') : '';
  };
  const maxMetaWidth = visible.items.reduce(
    (max, item) => Math.max(max, displayWidth(metaText(item))),
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
          {drillServer ? ` [MCP] ${drillServer} 工具` : ' [MCP] MCP 服务器'}
        </Text>
        <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {' '}{itemCount} 个
        </Text>
      </Box>
      {visible.items.length === 0 ? (
        <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {'  '}没有可用项
        </Text>
      ) : visible.items.map((item, index) => {
        const absoluteIndex = visible.start + index;
        const isSelected = absoluteIndex === selected;
        const meta = metaText(item);
        const name = padDisplay(
          safeText(item),
          nameWidth,
          capabilities.unicode ? '…' : '...',
        );
        const paddedMeta = padDisplay(
          truncateDisplay(meta, metaWidth, capabilities.unicode ? '…' : '...'),
          metaWidth,
        );
        const rowText = `${isSelected ? `${marker} ` : '  '}${name}${' '.repeat(gap)}${paddedMeta}`;
        return (
          <Box key={item} width={contentWidth}>
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
      {visible.start + visible.items.length < itemCount ? (
        <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {'  '}还有 {itemCount - visible.start - visible.items.length} 个候选
        </Text>
      ) : undefined}
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {border.repeat(contentWidth)}
      </Text>
      <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
        {'  '}{drillServer
          ? '↑↓ 选择 · Esc 返回服务器列表'
          : '↑↓ 选择 · Enter 查看工具 · Esc 退出'}
      </Text>
    </Box>
  );
}
