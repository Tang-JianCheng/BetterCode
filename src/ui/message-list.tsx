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
  capabilities: TerminalCapabilities;
  /** 传给工具折叠视图的外部折叠/展开切换信号 */
  toggleSignal?: number;
}

/**
 * 消息列表组件——渲染对话历史和当前流式输出。
 */
export function MessageList({
  messages,
  currentStreaming,
  capabilities,
  toggleSignal,
}: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {messages.map(message => (
        <PresentationView
          key={message.id}
          item={message.item}
          capabilities={capabilities}
          toggleSignal={toggleSignal}
        />
      ))}
      {currentStreaming ? (
        <PresentationView
          item={{ kind: 'conversation', role: 'assistant', content: currentStreaming }}
          capabilities={capabilities}
        />
      ) : undefined}
    </Box>
  );
}
