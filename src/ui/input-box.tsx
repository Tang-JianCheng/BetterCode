import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useInput } from 'ink';
import type { CommandCompletion } from '../command/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { detectTerminalCapabilities, displayWidth, padDisplay, truncateDisplay, truncateStart } from './capabilities.js';
import { BETTERCODE_THEME } from './theme.js';

interface Props {
  /** 用户按下 Enter 提交输入时的回调 */
  onSubmit: (input: string) => void;
  /** 是否禁用输入（等待 AI 回复时） */
  disabled: boolean;
  /** 按时间顺序排列的历史输入 */
  history?: readonly string[];
  /** 返回当前输入对应的命令补全候选 */
  complete?: (input: string) => readonly CommandCompletion[];
  capabilities?: TerminalCapabilities;
  focused?: boolean;
}

export interface HistoryNavigationState {
  input: string;
  cursor?: number;
  draft: string;
}

export function navigateHistory(
  history: readonly string[],
  state: HistoryNavigationState,
  direction: 'up' | 'down',
): HistoryNavigationState {
  if (history.length === 0) return state;
  if (direction === 'up') {
    const cursor = state.cursor === undefined
      ? history.length - 1
      : Math.max(0, state.cursor - 1);
    return {
      input: history[cursor],
      cursor,
      draft: state.cursor === undefined ? state.input : state.draft,
    };
  }
  if (state.cursor === undefined) return state;
  if (state.cursor >= history.length - 1) {
    return { input: state.draft, cursor: undefined, draft: state.draft };
  }
  const cursor = state.cursor + 1;
  return { input: history[cursor], cursor, draft: state.draft };
}

export interface CompletionResolution {
  input: string;
  items: readonly CommandCompletion[];
  selectedIndex: number;
}

export function resolveCompletion(
  input: string,
  items: readonly CommandCompletion[],
): CompletionResolution {
  if (items.length === 1) {
    return { input: items[0].value, items: [], selectedIndex: 0 };
  }
  return { input, items, selectedIndex: 0 };
}

export function moveCompletionIndex(
  current: number,
  itemCount: number,
  direction: 'up' | 'down',
): number {
  if (itemCount <= 0) return 0;
  return direction === 'up'
    ? (current - 1 + itemCount) % itemCount
    : (current + 1) % itemCount;
}

function exactCommandMatch(input: string, item: CommandCompletion): boolean {
  const token = input.trim();
  if (!token.startsWith('/') || /\s/u.test(token)) return false;
  const name = token.slice(1).toLowerCase();
  return name === item.name || item.aliases.some(alias => alias === name);
}

/**
 * 输入框组件——捕获用户键盘输入。
 * 支持：Backspace 删除、Enter 提交、普通字符输入。
 */
export function InputBox({
  onSubmit,
  disabled,
  history = [],
  complete,
  capabilities = detectTerminalCapabilities(),
  focused = true,
}: Props) {
  const [input, setInput] = useState('');
  const [historyCursor, setHistoryCursor] = useState<number | undefined>();
  const [draft, setDraft] = useState('');
  const [completionItems, setCompletionItems] = useState<readonly CommandCompletion[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);

  const clearCompletion = () => {
    setCompletionItems([]);
    setCompletionIndex(0);
  };

  useInput(
    (inputChar, key) => {
      if (disabled) return;
      if (key.ctrl) return;

      if (key.escape && completionItems.length > 0) {
        clearCompletion();
        return;
      } else if (key.tab && complete) {
        const resolution = resolveCompletion(input, complete(input));
        setInput(resolution.input);
        setCompletionItems(resolution.items);
        setCompletionIndex(resolution.selectedIndex);
        setHistoryCursor(undefined);
        return;
      } else if (key.return && completionItems.length > 0) {
        const selected = completionItems[completionIndex];
        if (exactCommandMatch(input, selected)) {
          const trimmed = input.trim();
          if (trimmed) {
            onSubmit(trimmed);
            setInput('');
            setDraft('');
            setHistoryCursor(undefined);
            clearCompletion();
          }
        } else {
          setInput(selected.value);
          clearCompletion();
          setHistoryCursor(undefined);
        }
        return;
      } else if (key.return) {
        const trimmed = input.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setInput('');
          setDraft('');
          setHistoryCursor(undefined);
          clearCompletion();
        }
        return;
      } else if (key.upArrow || key.downArrow) {
        if (completionItems.length > 0) {
          setCompletionIndex(index => moveCompletionIndex(
            index,
            completionItems.length,
            key.upArrow ? 'up' : 'down',
          ));
          return;
        }
        const next = navigateHistory(history, {
          input,
          cursor: historyCursor,
          draft,
        }, key.upArrow ? 'up' : 'down');
        setInput(next.input);
        setHistoryCursor(next.cursor);
        setDraft(next.draft);
        const items = complete ? complete(next.input) : [];
        setCompletionItems(items);
        setCompletionIndex(0);
        return;
      } else if (key.backspace || key.delete) {
        const next = input.slice(0, -1);
        setInput(next);
        setHistoryCursor(undefined);
        const items = complete ? complete(next) : [];
        setCompletionItems(items);
        setCompletionIndex(0);
        return;
      } else if (inputChar && !/[\u0000-\u001f\u007f]/.test(inputChar)) {
        // 过滤控制字符（方向键等不会产生 inputChar）
        const next = input + inputChar;
        setInput(next);
        setHistoryCursor(undefined);
        const items = complete ? complete(next) : [];
        setCompletionItems(items);
        setCompletionIndex(0);
      }
    },
    { isActive: !disabled && focused },
  );

  const pageSize = capabilities.density === 'narrow' ? 4 : 8;
  const pageCount = Math.max(1, Math.ceil(completionItems.length / pageSize));
  const pageIndex = completionItems.length === 0
    ? 0
    : Math.min(Math.floor(completionIndex / pageSize), pageCount - 1);
  const pageStart = pageIndex * pageSize;
  const visibleCompletionItems = completionItems.slice(pageStart, pageStart + pageSize);
  // 应用层会在左右各留 1 列内边距，边框与面板按实际内容宽度排版
  const contentWidth = Math.max(8, capabilities.columns - 2);
  const border = capabilities.unicode ? '─' : '-';
  const marker = capabilities.unicode ? '❯ ' : '> ';
  const ellipsis = capabilities.unicode ? '…' : '...';
  const markerWidth = displayWidth(marker);
  const maxLabelWidth = completionItems.reduce(
    (max, item) => Math.max(max, displayWidth(item.label)),
    0,
  );
  const labelColumnWidth = Math.min(
    maxLabelWidth,
    Math.max(8, Math.floor((contentWidth - markerWidth) * 0.45)),
  );
  const commandGap = 4;
  const descriptionColumnWidth = Math.max(
    8,
    contentWidth - markerWidth - labelColumnWidth - commandGap,
  );
  const cursorChar = capabilities.unicode ? '█' : '_';
  const showCursor = !disabled && focused;
  return (
    <Box flexDirection="column">
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {border.repeat(contentWidth)}
      </Text>
      <Box>
        <Text bold color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
          {capabilities.unicode ? '❯' : '>'}{' '}
        </Text>
        <Text dimColor={disabled}>{disabled ? '等待当前操作完成…' : input}</Text>
        {showCursor ? (
          <Text bold color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
            {cursorChar}
          </Text>
        ) : undefined}
      </Box>
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {border.repeat(contentWidth)}
      </Text>
      {visibleCompletionItems.map((item, index) => {
        const selected = completionIndex - pageStart === index;
        // 聚焦行让描述在右侧原地展开；超长时保留右缘并从左侧截断，避免挤掉命令名。
        const description = selected
          ? truncateStart(item.description, descriptionColumnWidth, ellipsis)
          : truncateDisplay(item.description, descriptionColumnWidth, ellipsis);
        const paddedDescription = `${' '.repeat(
          Math.max(0, descriptionColumnWidth - displayWidth(description)),
        )}${description}`;
        const rowText = [
          selected ? marker : '  ',
          padDisplay(item.label, labelColumnWidth, ellipsis),
          ' '.repeat(commandGap),
          paddedDescription,
        ].join('');
        return (
          <Box key={item.name} width={contentWidth}>
            <Text
              bold={selected}
              inverse={selected}
              color={capabilities.color
                ? selected ? BETTERCODE_THEME.selected : BETTERCODE_THEME.text
                : undefined}
            >
              {rowText}
            </Text>
          </Box>
        );
      })}
      {pageStart + visibleCompletionItems.length < completionItems.length ? (
        <Text dimColor>  还有 {completionItems.length - pageStart - visibleCompletionItems.length} 个候选</Text>
      ) : undefined}
    </Box>
  );
}
