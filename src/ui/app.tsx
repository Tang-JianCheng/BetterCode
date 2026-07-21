import React, { useState, useCallback, useRef } from 'react';
import { Box, Text } from 'ink';
import { useApp } from 'ink';
import type { LLMProvider } from '../provider/types.js';
import type { ChatManager } from '../chat/manager.js';
import { MessageList } from './message-list.js';
import type { DisplayMessage } from './message-list.js';
import { InputBox } from './input-box.js';

const HELP_TEXT = `可用命令:
  /help    - 显示帮助信息
  /clear   - 清空对话历史
  /exit    - 退出 BetterCode
  /quit    - 退出 BetterCode
  Ctrl+C   - 退出 BetterCode`;

interface Props {
  provider: LLMProvider;
  chatManager: ChatManager;
}

/**
 * App 主组件——管理对话状态，编排用户输入 → AI 流式回复的完整流程。
 */
export function App({ provider, chatManager }: Props) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [currentStreaming, setCurrentStreaming] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // 用 ref 追踪 streaming 期间的累积值，避免闭包过期问题
  const thinkingRef = useRef('');
  const hasThinkingRef = useRef(false);

  const sendMessage = useCallback(
    async (input: string) => {
      // 命令处理
      if (input === '/exit' || input === '/quit') {
        exit();
        return;
      }

      if (input === '/help') {
        setMessages(prev => [
          ...prev,
          { role: 'assistant' as const, content: HELP_TEXT },
        ]);
        return;
      }

      if (input === '/clear') {
        chatManager.clear();
        setMessages([]);
        return;
      }

      // 普通消息——开始流式对话
      thinkingRef.current = '';
      hasThinkingRef.current = false;
      setIsStreaming(true);
      setCurrentStreaming('');
      setCurrentThinking('');
      setIsThinking(false);

      // 先追加用户消息
      setMessages(prev => [
        ...prev,
        { role: 'user', content: input },
      ]);

      await chatManager.send(
        input,
        provider,
        (thinkingToken) => {
          hasThinkingRef.current = true;
          thinkingRef.current += thinkingToken;
          setIsThinking(true);
          setCurrentThinking(prev => prev + thinkingToken);
        },
        (_textToken) => {
          // 收到第一个文本 token 时隐去 thinking 标记
          if (hasThinkingRef.current) {
            hasThinkingRef.current = false;
            setIsThinking(false);
          }
          setCurrentStreaming(prev => prev + _textToken);
        },
        (err) => {
          // 错误追加为 assistant 消息
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: `❌ ${err}` },
          ]);
          setIsStreaming(false);
        },
      );

      // 流式结束——将当前流式内容固化到 messages
      const thinkingContent = thinkingRef.current;
      setCurrentStreaming(prev => {
        if (prev) {
          setMessages(msgs => [
            ...msgs,
            {
              role: 'assistant',
              content: prev,
              ...(thinkingContent ? { thinking: thinkingContent } : {}),
            },
          ]);
        }
        return '';
      });
      setCurrentThinking('');
      setIsThinking(false);
      setIsStreaming(false);
    },
    [provider, chatManager, exit],
  );

  return (
    <Box flexDirection="column" padding={1}>
      {/* 顶部状态栏 */}
      <Box marginBottom={1}>
        <Text color="magenta" bold>
          BetterCode
        </Text>
        <Text color="grey"> — </Text>
        <Text color="yellow">{provider.name}</Text>
        <Text color="grey"> ({provider.model})</Text>
      </Box>

      {/* 分割线 */}
      <Box marginBottom={1}>
        <Text color="grey">{'─'.repeat(process.stdout.columns || 80)}</Text>
      </Box>

      {/* 消息列表 */}
      <MessageList
        messages={messages}
        currentStreaming={currentStreaming}
        currentThinking={currentThinking}
        isThinking={isThinking}
      />

      {/* 输入框（流式输出中禁用） */}
      {!isStreaming ? (
        <InputBox onSubmit={sendMessage} disabled={false} />
      ) : (
        <Box>
          <Text color="grey">⏳ 正在生成回复...</Text>
        </Box>
      )}
    </Box>
  );
}
