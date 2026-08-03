import React from 'react';
import { Box, Text } from 'ink';
import type {
  NoticePresentation,
  PresentationBlock,
  PresentationDocument,
  PresentationItem,
} from '../presentation/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { displayWidth, padDisplay, truncateDisplay } from './capabilities.js';
import { MarkdownView } from './markdown-view.js';
import { MascotMark } from './mascot.js';
import { BETTERCODE_THEME, TONE_LABELS, toneColor } from './theme.js';

function dividerLine(capabilities: TerminalCapabilities, width: number): string {
  return (capabilities.unicode ? '─' : '-').repeat(Math.max(1, width));
}

function formatKeyValues(
  block: Extract<PresentationBlock, { type: 'key_value' }>,
  capabilities: TerminalCapabilities,
  width: number,
): string[] {
  if (block.columns !== 2 || capabilities.density !== 'full') {
    return block.entries.map(entry => `${entry.label}: ${truncateDisplay(entry.value, Math.max(8, width - displayWidth(entry.label) - 2))}`);
  }
  const cellWidth = Math.max(12, Math.floor((width - 3) / 2));
  const result: string[] = [];
  for (let index = 0; index < block.entries.length; index += 2) {
    const left = block.entries[index];
    const right = block.entries[index + 1];
    const leftText = padDisplay(`${left.label}: ${left.value}`, cellWidth);
    result.push(right
      ? `${leftText} │ ${truncateDisplay(`${right.label}: ${right.value}`, cellWidth)}`
      : leftText.trimEnd());
  }
  return result;
}

function formatTable(
  block: Extract<PresentationBlock, { type: 'table' }>,
  capabilities: TerminalCapabilities,
  width: number,
): string[] {
  if (capabilities.density === 'narrow') {
    return block.rows.flatMap((row, rowIndex) => [
      ...(rowIndex ? [''] : []),
      ...row.map((value, index) => `${block.columns[index].label}: ${truncateDisplay(value, Math.max(8, width - displayWidth(block.columns[index].label) - 2))}`),
    ]);
  }
  const separator = capabilities.unicode ? ' │ ' : ' | ';
  const separatorWidth = displayWidth(separator) * Math.max(0, block.columns.length - 1);
  const tableWidth = Math.min(88, Math.max(8, width));
  const columnCount = Math.max(1, block.columns.length);
  const available = Math.max(columnCount, tableWidth - separatorWidth);
  const maxCellWidth = Math.max(8, Math.floor(available / columnCount));
  const naturalWidths = block.columns.map((column, index) => {
    let cellWidth = displayWidth(column.label);
    for (const row of block.rows) {
      cellWidth = Math.max(cellWidth, displayWidth(row[index] ?? ''));
    }
    return Math.min(cellWidth, maxCellWidth);
  });
  const naturalTotal = naturalWidths.reduce((sum, item) => sum + item, 0);
  const columnWidths = naturalTotal <= available
    ? naturalWidths.map(item => Math.max(8, item))
    : naturalWidths.map(item => Math.max(8, Math.floor(item * available / naturalTotal)));
  if (naturalTotal > available) {
    let used = columnWidths.reduce((sum, item) => sum + item, 0);
    let remaining = available - used;
    const order = naturalWidths.map((item, index) => ({ item, index }))
      .sort((a, b) => b.item - a.item);
    let cursor = 0;
    while (remaining > 0 && cursor < order.length) {
      columnWidths[order[cursor].index] += 1;
      remaining -= 1;
      cursor += 1;
    }
  }
  const renderRow = (row: readonly string[]) => row
    .map((value, index) => padDisplay(value, columnWidths[index]))
    .join(separator)
    .trimEnd();
  const tableWidthUsed = columnWidths.reduce((sum, item) => sum + item, 0) + separatorWidth;
  return [
    renderRow(block.columns.map(column => column.label)),
    dividerLine(capabilities, Math.min(tableWidth, tableWidthUsed)),
    ...block.rows.map(renderRow),
  ];
}

export function formatBlockLines(
  block: PresentationBlock,
  capabilities: TerminalCapabilities,
  width: number,
): string[] {
  if (block.type === 'text') return block.content.split('\n');
  if (block.type === 'divider') return [dividerLine(capabilities, width)];
  if (block.type === 'key_value') return formatKeyValues(block, capabilities, width);
  if (block.type === 'table') return formatTable(block, capabilities, width);
  return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : capabilities.unicode ? '•' : '-'} ${item}`);
}

function ConversationView({
  item,
  capabilities,
}: {
  item: Extract<PresentationItem, { kind: 'conversation' }>;
  capabilities: TerminalCapabilities;
}) {
  if (item.role === 'assistant' && item.markdown) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <MarkdownView ast={item.markdown} capabilities={capabilities} thinking={item.thinking} />
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {item.thinking ? (
        <Box>
          <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
            {capabilities.unicode ? '┊ ' : ': '}
          </Text>
          <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
            {item.thinking}
          </Text>
        </Box>
      ) : undefined}
      <Box>
        {item.role === 'user' ? (
          <Text bold color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
            {capabilities.unicode ? '❯ ' : '> '}
          </Text>
        ) : undefined}
        <Text>{item.content}</Text>
      </Box>
    </Box>
  );
}

function DocumentView({
  item,
  capabilities,
}: {
  item: PresentationDocument;
  capabilities: TerminalCapabilities;
}) {
  const width = Math.max(20, capabilities.columns - 4);
  const top = capabilities.unicode ? '╭─' : '+-';
  const bottom = capabilities.unicode ? '╰' : '+';
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={capabilities.color ? toneColor(item.tone) : undefined}>{top} </Text>
        {item.badge ? (
          <Text bold color={capabilities.color ? toneColor(item.tone) : undefined}>[{item.badge}] </Text>
        ) : undefined}
        <Text bold>{item.title}</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {item.blocks.flatMap((block, blockIndex) => formatBlockLines(block, capabilities, width)
          .map((line, lineIndex) => (
            <Text
              key={`${blockIndex}-${lineIndex}`}
              dimColor={block.type === 'text' && block.muted}
              color={block.type === 'divider' && capabilities.color ? BETTERCODE_THEME.border : undefined}
            >
              {line || ' '}
            </Text>
          )))}
      </Box>
      {item.footer ? (
        <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>  {item.footer}</Text>
      ) : undefined}
      <Text color={capabilities.color ? toneColor(item.tone) : undefined}>
        {bottom}{dividerLine(capabilities, Math.min(capabilities.columns - 1, 12))}
      </Text>
    </Box>
  );
}

function NoticeView({
  item,
  capabilities,
}: {
  item: NoticePresentation;
  capabilities: TerminalCapabilities;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <MascotMark tone={item.tone} capabilities={capabilities} />
        <Text bold color={capabilities.color ? toneColor(item.tone) : undefined}>
          {' '}{TONE_LABELS[item.tone]} · {item.title}
        </Text>
      </Box>
      {item.message ? <Text>  {item.message}</Text> : undefined}
      {item.details?.map((detail, index) => (
        <Text key={`${index}-${detail}`} dimColor>  {capabilities.unicode ? '┊' : '|'} {detail}</Text>
      ))}
    </Box>
  );
}

export interface PresentationViewProps {
  item: PresentationItem;
  capabilities: TerminalCapabilities;
}

export function PresentationView({ item, capabilities }: PresentationViewProps) {
  if (item.kind === 'conversation') {
    return <ConversationView item={item} capabilities={capabilities} />;
  }
  if (item.kind === 'document') {
    return <DocumentView item={item} capabilities={capabilities} />;
  }
  return <NoticeView item={item} capabilities={capabilities} />;
}
