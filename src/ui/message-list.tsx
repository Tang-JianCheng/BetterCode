import React from 'react';
import { Box, Text } from 'ink';

/** 展示用的消息条目 */
export interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
}

interface Props {
  messages: DisplayMessage[];
  /** 当前正在流式输出的文本 */
  currentStreaming: string;
  /** 当前正在流式输出的 thinking 内容 */
  currentThinking: string;
  /** 是否正在展示 thinking */
  isThinking: boolean;
}

/**
 * 消息列表组件——渲染对话历史和当前流式输出。
 */
export function MessageList({ messages, currentStreaming, currentThinking, isThinking }: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* 历史消息 */}
      {messages.map((msg, i) => (
        <Box key={i} flexDirection="column" marginBottom={1}>
          {msg.thinking ? (
            <Text color="grey" dimColor>
              🤔 {msg.thinking}
            </Text>
          ) : undefined}
          <Text color={msg.role === 'user' ? 'cyan' : undefined}>
            {msg.role === 'user' ? '> ' : ''}
            {msg.content}
          </Text>
        </Box>
      ))}

      {/* 当前正在流式输出的 thinking */}
      {isThinking && currentThinking ? (
        <Box marginBottom={1}>
          <Text color="grey" dimColor>
            🤔 {currentThinking}
          </Text>
        </Box>
      ) : undefined}

      {/* 当前正在流式输出的文本 */}
      {currentStreaming ? (
        <Box marginBottom={1}>
          <Text>{currentStreaming}</Text>
        </Box>
      ) : undefined}
    </Box>
  );
}
