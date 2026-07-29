import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useInput } from 'ink';

interface Props {
  /** 用户按下 Enter 提交输入时的回调 */
  onSubmit: (input: string) => void;
  /** 是否禁用输入（等待 AI 回复时） */
  disabled: boolean;
  /** 按时间顺序排列的历史输入 */
  history?: readonly string[];
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

/**
 * 输入框组件——捕获用户键盘输入。
 * 支持：Backspace 删除、Enter 提交、普通字符输入。
 */
export function InputBox({ onSubmit, disabled, history = [] }: Props) {
  const [input, setInput] = useState('');
  const [historyCursor, setHistoryCursor] = useState<number | undefined>();
  const [draft, setDraft] = useState('');

  useInput(
    (inputChar, key) => {
      if (disabled) return;
      if (key.ctrl) return;

      if (key.return) {
        const trimmed = input.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setInput('');
          setDraft('');
          setHistoryCursor(undefined);
        }
      } else if (key.upArrow || key.downArrow) {
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
      } else if (inputChar && !/[\u0000-\u001f\u007f]/.test(inputChar)) {
        // 过滤控制字符（方向键等不会产生 inputChar）
        setInput(prev => prev + inputChar);
        setHistoryCursor(undefined);
      }
    },
    { isActive: !disabled },
  );

  return (
    <Box>
      <Text color="green">{'>'} </Text>
      <Text>{input}</Text>
    </Box>
  );
}
