import React, { useCallback, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { AgentEvent, AgentStopReason } from '../agent/types.js';
import type { LLMProvider, TokenUsage } from '../provider/types.js';
import { NoPlanError, type ChatManager } from '../chat/manager.js';
import { InputBox } from './input-box.js';
import { MessageList, type DisplayMessage } from './message-list.js';

const HELP_TEXT = `可用命令:
  /help          - 显示帮助信息
  /clear         - 清空对话历史和计划
  /plan <任务>   - 只读分析项目并生成计划
  /do            - 执行最近成功生成的计划
  /exit, /quit   - 退出 BetterCode
  Ctrl+C         - 运行中取消任务，空闲时退出`;

const PROGRESS_LABELS = {
  requesting_model: '正在请求模型',
  model_complete: '模型响应完成',
  executing_tools: '正在执行工具',
  tools_complete: '工具执行完成',
} as const;

const STOP_MESSAGES: Partial<Record<AgentStopReason, string>> = {
  max_iterations: '已达到最大迭代次数，Agent 已停止。',
  cancelled: '当前任务已取消。',
  unknown_tool_limit: '连续调用未知或不可用工具，Agent 已停止。',
  stream_error: '模型响应流发生错误，Agent 已停止。',
};

interface Props {
  provider: LLMProvider;
  chatManager: ChatManager;
}

export function App({ provider, chatManager }: Props) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [currentStreaming, setCurrentStreaming] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [progress, setProgress] = useState('');
  const [usage, setUsage] = useState<TokenUsage | undefined>();

  const textRef = useRef('');
  const thinkingRef = useRef('');
  const hasThinkingRef = useRef(false);
  const abortRef = useRef<AbortController | undefined>();

  useInput((input, key) => {
    if (!key.ctrl || input.toLowerCase() !== 'c') return;
    if (isStreaming) abortRef.current?.abort();
    else exit();
  });

  const appendAssistant = useCallback((content: string) => {
    setMessages(previous => [...previous, { role: 'assistant', content }]);
  }, []);

  const updateProgress = useCallback((event: Extract<AgentEvent, { type: 'progress' }>) => {
    const tool = event.toolName ? `: ${event.toolName}` : '';
    setProgress(`第 ${event.iteration}/${event.maxIterations} 轮 - ${PROGRESS_LABELS[event.stage]}${tool}`);
  }, []);

  const sendMessage = useCallback(async (input: string) => {
    if (input === '/exit' || input === '/quit') {
      exit();
      return;
    }
    if (input === '/help') {
      appendAssistant(HELP_TEXT);
      return;
    }
    if (input === '/clear') {
      chatManager.clear();
      setMessages([]);
      return;
    }
    if (input === '/plan') {
      appendAssistant('用法: /plan <任务>');
      return;
    }

    const isPlan = input.startsWith('/plan ');
    const isDo = input === '/do';
    const task = isPlan ? input.slice('/plan '.length).trim() : input;
    if (isPlan && !task) {
      appendAssistant('用法: /plan <任务>');
      return;
    }

    let eventStream: AsyncIterable<AgentEvent>;
    const controller = new AbortController();
    try {
      eventStream = isDo
        ? chatManager.executeLatestPlan(provider, controller.signal)
        : chatManager.run(task, provider, {
            mode: isPlan ? 'plan' : 'act',
            signal: controller.signal,
          });
    } catch (error) {
      if (error instanceof NoPlanError) appendAssistant(error.message);
      else appendAssistant(error instanceof Error ? error.message : String(error));
      return;
    }

    textRef.current = '';
    thinkingRef.current = '';
    hasThinkingRef.current = false;
    abortRef.current = controller;
    setIsStreaming(true);
    setCurrentStreaming('');
    setCurrentThinking('');
    setIsThinking(false);
    setProgress('准备运行 Agent');
    setUsage(undefined);
    setMessages(previous => [...previous, { role: 'user', content: input }]);

    let terminal: Extract<AgentEvent, { type: 'stopped' }> | undefined;
    let lastError = '';
    try {
      for await (const event of eventStream) {
        switch (event.type) {
          case 'text_delta':
            textRef.current += event.content;
            hasThinkingRef.current = false;
            setIsThinking(false);
            setCurrentStreaming(previous => previous + event.content);
            break;
          case 'thinking_delta':
            thinkingRef.current += event.content;
            hasThinkingRef.current = true;
            setIsThinking(true);
            setCurrentThinking(previous => previous + event.content);
            break;
          case 'tool_call':
            setProgress(`第 ${event.iteration} 轮 - 模型调用工具: ${event.call.name}`);
            break;
          case 'tool_result':
            setProgress(`第 ${event.iteration} 轮 - 工具返回: ${event.call.name}`);
            break;
          case 'usage':
            setUsage(event.cumulative);
            break;
          case 'progress':
            updateProgress(event);
            break;
          case 'error':
            lastError = event.message;
            break;
          case 'stopped':
            terminal = event;
            break;
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      const finalText = terminal?.finalText ?? '';
      const finalThinking = thinkingRef.current;
      const completedMessages: DisplayMessage[] = [];
      if (finalText) {
        completedMessages.push({
          role: 'assistant',
          content: finalText,
          ...(finalThinking ? { thinking: finalThinking } : {}),
        });
      }
      const stopMessage = terminal ? STOP_MESSAGES[terminal.reason] : undefined;
      const errorMessage = lastError || stopMessage;
      if (errorMessage) completedMessages.push({ role: 'assistant', content: errorMessage });
      if (completedMessages.length > 0) {
        setMessages(previous => [...previous, ...completedMessages]);
      }

      abortRef.current = undefined;
      textRef.current = '';
      thinkingRef.current = '';
      hasThinkingRef.current = false;
      setCurrentStreaming('');
      setCurrentThinking('');
      setIsThinking(false);
      setIsStreaming(false);
      setProgress('');
      setUsage(undefined);
    }
  }, [appendAssistant, chatManager, exit, provider, updateProgress]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="magenta" bold>BetterCode</Text>
        <Text color="grey"> - </Text>
        <Text color="yellow">{provider.name}</Text>
        <Text color="grey"> ({provider.model})</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="grey">{'-'.repeat(process.stdout.columns || 80)}</Text>
      </Box>

      <MessageList
        messages={messages}
        currentStreaming={currentStreaming}
        currentThinking={currentThinking}
        isThinking={isThinking}
      />

      {isStreaming ? (
        <Box flexDirection="column">
          <Text color="grey">{progress || 'Agent 正在运行'}</Text>
          {usage ? (
            <Text color="grey">
              Token: 输入 {usage.inputTokens} / 输出 {usage.outputTokens} / 总计 {usage.totalTokens}
            </Text>
          ) : undefined}
          <Text color="grey">Ctrl+C 取消当前任务</Text>
        </Box>
      ) : (
        <InputBox onSubmit={sendMessage} disabled={false} />
      )}
    </Box>
  );
}
