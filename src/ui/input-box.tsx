import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useInput } from 'ink';
import type { CommandCompletion } from '../command/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { detectTerminalCapabilities } from './capabilities.js';
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
      } else if (key.tab && complete) {
        const resolution = resolveCompletion(input, complete(input));
        setInput(resolution.input);
        setCompletionItems(resolution.items);
        setCompletionIndex(resolution.selectedIndex);
        setHistoryCursor(undefined);
      } else if (key.return && completionItems.length > 0) {
        setInput(completionItems[completionIndex].value);
        clearCompletion();
        setHistoryCursor(undefined);
      } else if (key.return) {
        const trimmed = input.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setInput('');
          setDraft('');
          setHistoryCursor(undefined);
          clearCompletion();
        }
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
      } else if (key.backspace || key.delete) {
        setInput(prev => prev.slice(0, -1));
        setHistoryCursor(undefined);
        clearCompletion();
      } else if (inputChar && !/[\u0000-\u001f\u007f]/.test(inputChar)) {
        // 过滤控制字符（方向键等不会产生 inputChar）
        setInput(prev => prev + inputChar);
        setHistoryCursor(undefined);
        clearCompletion();
      }
    },
    { isActive: !disabled && focused },
  );

  const visibleCompletionItems = completionItems.slice(0, capabilities.density === 'narrow' ? 4 : 6);
  const border = capabilities.unicode ? '─' : '-';
  return (
    <Box flexDirection="column">
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {border.repeat(Math.max(8, capabilities.columns))}
      </Text>
      <Box>
        <Text bold color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
          {capabilities.unicode ? '❯' : '>'}{' '}
        </Text>
        <Text dimColor={disabled}>{disabled ? '等待当前操作完成…' : input}</Text>
      </Box>
      {visibleCompletionItems.map((item, index) => (
        <Text
          key={item.name}
          bold={index === completionIndex}
          inverse={index === completionIndex && capabilities.color}
          color={capabilities.color
            ? index === completionIndex ? BETTERCODE_THEME.selected : BETTERCODE_THEME.muted
            : undefined}
        >
          {index === completionIndex ? capabilities.unicode ? '❯ ' : '> ' : '  '}
          {item.label} · {item.description}
        </Text>
      ))}
      {completionItems.length > visibleCompletionItems.length ? (
        <Text dimColor>  还有 {completionItems.length - visibleCompletionItems.length} 个候选</Text>
      ) : undefined}
    </Box>
  );
}
