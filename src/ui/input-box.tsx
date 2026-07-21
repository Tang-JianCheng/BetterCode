import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useInput } from 'ink';

interface Props {
  /** 用户按下 Enter 提交输入时的回调 */
  onSubmit: (input: string) => void;
  /** 是否禁用输入（等待 AI 回复时） */
  disabled: boolean;
}

/**
 * 输入框组件——捕获用户键盘输入。
 * 支持：Backspace 删除、Enter 提交、普通字符输入。
 */
export function InputBox({ onSubmit, disabled }: Props) {
  const [input, setInput] = useState('');

  useInput(
    (inputChar, key) => {
      if (disabled) return;
      if (key.ctrl) return;

      if (key.return) {
        const trimmed = input.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setInput('');
        }
      } else if (key.backspace || key.delete) {
        setInput(prev => prev.slice(0, -1));
      } else if (inputChar && !/[\u0000-\u001f\u007f]/.test(inputChar)) {
        // 过滤控制字符（方向键等不会产生 inputChar）
        setInput(prev => prev + inputChar);
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
