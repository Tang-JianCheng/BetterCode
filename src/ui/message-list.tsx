import React from 'react';
import { Box } from 'ink';
import type { IdentifiedPresentation } from '../presentation/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { PresentationView } from './presentation-view.js';

export type DisplayMessage = IdentifiedPresentation;

interface Props {
  messages: DisplayMessage[];
  /** 当前正在流式输出的文本 */
  currentStreaming: string;
  /** 当前正在流式输出的 thinking 内容 */
  currentThinking: string;
  /** 是否正在展示 thinking */
  isThinking: boolean;
  capabilities: TerminalCapabilities;
}

/**
 * 消息列表组件——渲染对话历史和当前流式输出。
 */
export function MessageList({
  messages,
  currentStreaming,
  currentThinking,
  isThinking,
  capabilities,
}: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {messages.map(message => (
        <PresentationView key={message.id} item={message.item} capabilities={capabilities} />
      ))}
      {isThinking && currentThinking ? (
        <PresentationView
          item={{ kind: 'conversation', role: 'assistant', content: '', thinking: currentThinking }}
          capabilities={capabilities}
        />
      ) : undefined}
      {currentStreaming ? (
        <PresentationView
          item={{ kind: 'conversation', role: 'assistant', content: currentStreaming }}
          capabilities={capabilities}
        />
      ) : undefined}
    </Box>
  );
}
