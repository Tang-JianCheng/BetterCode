import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { AgentEvent, AgentStopReason } from '../agent/types.js';
import type { ContextEvent } from '../context/types.js';
import type {
  PermissionChoice,
  PermissionDecider,
  PermissionMode,
  PermissionRequest,
  PermissionStatus,
} from '../permission/types.js';
import type { LLMProvider, TokenUsage } from '../provider/types.js';
import {
  NoPlanError,
  type ChatManager,
  type MemoryStatus,
} from '../chat/manager.js';
import type { SessionInfo } from '../session/session.js';
import type { McpStartupStatus } from '../mcp/types.js';
import { InputBox } from './input-box.js';
import { MessageList, type DisplayMessage } from './message-list.js';
import { PermissionPrompt } from './permission-prompt.js';
import { RewindDialog, type RewindAction } from './rewind-dialog.js';

export const HELP_TEXT = `可用命令:
  /help          - 显示帮助信息
  /clear         - 清空对话历史和计划
  /compact       - 手动压缩较早对话上下文
  /resume [ID]   - 列出或恢复历史会话
  /memory        - 查看长期记忆状态
  /rewind        - 回滚到文件修改前的检查点
  /plan <任务>   - 只读分析项目并生成计划
  /do            - 执行最近成功生成的计划
  /permissions   - 查看权限模式、规则和配置诊断
  /permissions <strict|default|allow> - 切换权限模式
  /exit, /quit   - 退出 BetterCode
  Ctrl+C         - 运行中取消任务，空闲时退出

安全边界: 专用文件工具限制在项目目录内；获准的 Shell 命令仍继承 BetterCode 进程权限。`;

const PROGRESS_LABELS = {
  requesting_model: '正在请求模型',
  model_complete: '模型响应完成',
  checking_permissions: '正在检查权限',
  waiting_permission: '等待权限确认',
  executing_tools: '正在执行工具',
  tools_complete: '工具执行完成',
} as const;

const STOP_MESSAGES: Partial<Record<AgentStopReason, string>> = {
  max_iterations: '已达到最大迭代次数，Agent 已停止。',
  cancelled: '当前任务已取消。',
  unknown_tool_limit: '连续调用未知或不可用工具，Agent 已停止。',
  context_error: '上下文管理失败，Agent 已停止。',
  stream_error: '模型响应流发生错误，Agent 已停止。',
};

const CONTEXT_PROGRESS_LABELS = {
  lightweight: '正在检查工具结果体积',
  estimating: '正在估算上下文用量',
  summarizing: '正在摘要较早历史',
  validating: '正在校验压缩结果',
} as const;

export function formatContextEvent(event: ContextEvent): string {
  switch (event.type) {
    case 'context_progress':
      return event.estimatedTokens === undefined
        ? CONTEXT_PROGRESS_LABELS[event.stage]
        : `${CONTEXT_PROGRESS_LABELS[event.stage]}，当前约 ${event.estimatedTokens} Token`;
    case 'context_offloaded':
      return `已将 ${event.count} 个大型工具结果保存到项目上下文目录`;
    case 'context_compacted':
      return `上下文已压缩：约 ${event.beforeTokens} -> ${event.afterTokens} Token，` +
        `摘要覆盖 ${event.summarizedMessages} 条消息，落盘 ${event.offloadedResults} 个工具结果，` +
        `熔断${event.circuitOpen ? '已开启' : '未开启'}`;
    case 'context_failed':
      return event.message;
  }
}

interface Props {
  provider: LLMProvider;
  chatManager: ChatManager;
  mcpStatus?: McpStartupStatus;
}

export function formatContextWindowNotice(provider: LLMProvider): string | undefined {
  return provider.contextWindowIsDefault
    ? `当前 Provider 未配置 context_window，BetterCode 暂按 ${provider.contextWindow} Token 使用。`
    : undefined;
}

export function formatSessionList(sessions: readonly SessionInfo[]): string {
  if (sessions.length === 0) return '没有可恢复的历史会话。';
  return [
    '历史会话（使用 /resume <ID> 恢复）:',
    ...sessions.slice(0, 10).map(session =>
      `  ${session.id} (${session.messageCount} 条) - ${session.firstMessage || '无标题'}`),
  ].join('\n');
}

export function formatMemoryStatus(status: MemoryStatus): string {
  return [
    `长期记忆: 用户级 ${status.userCount} 条 / 项目级 ${status.projectCount} 条`,
    `用户目录: ${status.userDirectory}`,
    `项目目录: ${status.projectDirectory}`,
  ].join('\n');
}

function formatPermissionStatus(status: PermissionStatus): string {
  const counts = status.ruleCounts;
  const lines = [
    `权限模式: ${status.mode}`,
    `规则数量: 会话 ${counts.session} / 项目本地 ${counts.local} / 项目共享 ${counts.project} / 用户全局 ${counts.user}`,
  ];
  if (status.diagnostics.length > 0) {
    lines.push('配置诊断:');
    for (const diagnostic of status.diagnostics) {
      lines.push(`- ${diagnostic.file}: ${diagnostic.message}`);
    }
  }
  return lines.join('\n');
}

function isPermissionMode(value: string): value is PermissionMode {
  return value === 'strict' || value === 'default' || value === 'allow';
}

export function formatMcpStartupStatus(status: McpStartupStatus): string | undefined {
  if (status.diagnostics.length === 0) return undefined;
  const lines = [
    `MCP 启动: 已连接 ${status.connectedServers}/${status.configuredServers} 个 Server，注册 ${status.registeredTools} 个工具。`,
    'MCP 诊断:',
  ];
  for (const diagnostic of status.diagnostics) {
    const source = [diagnostic.serverName, diagnostic.toolName].filter(Boolean).join('/');
    lines.push(`- ${source ? `${source}: ` : ''}${diagnostic.message}`);
  }
  lines.push('安全边界: 外部 MCP Server 不受 BetterCode 文件沙箱或危险命令黑名单强制保护。');
  return lines.join('\n');
}

export function App({ provider, chatManager, mcpStatus }: Props) {
  const { exit } = useApp();
  const initialPermissionStatus = chatManager.getPermissionStatus();
  const [messages, setMessages] = useState<DisplayMessage[]>(() => {
    const initial: DisplayMessage[] = [];
    const windowNotice = formatContextWindowNotice(provider);
    if (windowNotice) initial.push({ role: 'assistant', content: windowNotice });
    if (initialPermissionStatus.diagnostics.length > 0) {
      initial.push({ role: 'assistant', content: formatPermissionStatus(initialPermissionStatus) });
    }
    const mcpMessage = mcpStatus ? formatMcpStartupStatus(mcpStatus) : undefined;
    if (mcpMessage) initial.push({ role: 'assistant', content: mcpMessage });
    return initial;
  });
  const [currentStreaming, setCurrentStreaming] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [progress, setProgress] = useState('');
  const [usage, setUsage] = useState<TokenUsage | undefined>();
  const [permissionMode, setPermissionMode] = useState(initialPermissionStatus.mode);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | undefined>();
  const [promptHistory, setPromptHistory] = useState(() => chatManager.getPromptHistory());
  const [rewindSnapshots, setRewindSnapshots] = useState(() => chatManager.getSnapshots());
  const [rewindDialogActive, setRewindDialogActive] = useState(false);

  const textRef = useRef('');
  const thinkingRef = useRef('');
  const hasThinkingRef = useRef(false);
  const abortRef = useRef<AbortController | undefined>();
  const permissionResolverRef = useRef<{
    requestId: string;
    resolve: (choice: PermissionChoice) => void;
  }>();

  useInput((input, key) => {
    if (!key.ctrl || input.toLowerCase() !== 'c') return;
    if (isStreaming) abortRef.current?.abort();
    else exit();
  });

  const appendAssistant = useCallback((content: string) => {
    setMessages(previous => [...previous, { role: 'assistant', content }]);
  }, []);

  useEffect(() => chatManager.subscribeMemorySaved(names => {
    appendAssistant(`长期记忆已保存: ${names.join(', ')}`);
  }), [appendAssistant, chatManager]);

  const updateProgress = useCallback((event: Extract<AgentEvent, { type: 'progress' }>) => {
    const tool = event.toolName ? `: ${event.toolName}` : '';
    setProgress(`第 ${event.iteration}/${event.maxIterations} 轮 - ${PROGRESS_LABELS[event.stage]}${tool}`);
  }, []);

  const permissionDecider = useCallback<PermissionDecider>((request, signal) => (
    new Promise(resolve => {
      const finish = (choice: PermissionChoice) => {
        signal.removeEventListener('abort', onAbort);
        resolve(choice);
      };
      const onAbort = () => {
        if (permissionResolverRef.current?.requestId === request.id) {
          permissionResolverRef.current = undefined;
          setPermissionRequest(undefined);
        }
      };
      permissionResolverRef.current = { requestId: request.id, resolve: finish };
      setPermissionRequest(request);
      signal.addEventListener('abort', onAbort, { once: true });
    })
  ), []);

  const submitPermission = useCallback((choice: PermissionChoice) => {
    const pending = permissionResolverRef.current;
    if (!pending || pending.requestId !== permissionRequest?.id) return;
    permissionResolverRef.current = undefined;
    setPermissionRequest(undefined);
    pending.resolve(choice);
  }, [permissionRequest]);

  const handleRewind = useCallback((action: RewindAction) => {
    try {
      const result = chatManager.rewind(action.snapshotIndex, action.mode);
      if (action.mode !== 'code_only') {
        const restored = result.history.flatMap(message => {
          if (message.role !== 'user' && message.role !== 'assistant') return [];
          return [{ role: message.role, content: message.content } satisfies DisplayMessage];
        });
        setMessages(restored);
      }
      const detail = result.changedFiles.length > 0
        ? `，恢复文件 ${result.changedFiles.length} 个: ${result.changedFiles.join(', ')}`
        : '';
      appendAssistant(`已回滚到检查点“${result.snapshot.userText}”${detail}。`);
      setRewindSnapshots(chatManager.getSnapshots());
    } catch (error) {
      appendAssistant(error instanceof Error ? error.message : String(error));
    } finally {
      setRewindDialogActive(false);
    }
  }, [appendAssistant, chatManager]);

  const sendMessage = useCallback(async (input: string) => {
    chatManager.recordPrompt(input);
    setPromptHistory(chatManager.getPromptHistory());
    if (input === '/exit' || input === '/quit') {
      exit();
      return;
    }
    if (input === '/help') {
      appendAssistant(HELP_TEXT);
      return;
    }
    if (input === '/clear') {
      try {
        await chatManager.clear();
        setMessages([]);
        setUsage(undefined);
        setRewindSnapshots([]);
      } catch (error) {
        appendAssistant(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (input === '/resume' || input === '/r') {
      appendAssistant(formatSessionList(chatManager.listSessions()));
      return;
    }
    if (input.startsWith('/resume ') || input.startsWith('/r ')) {
      const command = input.startsWith('/resume ') ? '/resume ' : '/r ';
      const sessionId = input.slice(command.length).trim();
      if (!sessionId) {
        appendAssistant(formatSessionList(chatManager.listSessions()));
        return;
      }
      try {
        const restored = await chatManager.resumeSession(sessionId);
        setMessages([
          ...restored.map(message => ({ ...message })),
          { role: 'assistant', content: `已恢复会话 ${sessionId}（${restored.length} 条消息）。` },
        ]);
        setUsage(undefined);
        setRewindSnapshots(chatManager.getSnapshots());
      } catch (error) {
        appendAssistant(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (input === '/memory') {
      appendAssistant(formatMemoryStatus(chatManager.getMemoryStatus()));
      return;
    }
    if (input === '/rewind') {
      const snapshots = chatManager.getSnapshots();
      if (snapshots.length === 0) {
        appendAssistant('当前会话没有可回滚的检查点。');
      } else {
        setRewindSnapshots(snapshots);
        setRewindDialogActive(true);
      }
      return;
    }
    if (input === '/compact') {
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setProgress('准备压缩上下文');
      try {
        for await (const event of chatManager.compact(provider, controller.signal)) {
          if (event.type === 'context_progress' || event.type === 'context_offloaded') {
            setProgress(formatContextEvent(event));
          } else if (event.type === 'context_compacted' || event.type === 'context_failed') {
            appendAssistant(formatContextEvent(event));
          } else if (event.type === 'error') {
            appendAssistant(event.message);
          }
        }
      } catch (error) {
        appendAssistant(error instanceof Error ? error.message : String(error));
      } finally {
        abortRef.current = undefined;
        setIsStreaming(false);
        setProgress('');
      }
      return;
    }
    if (input === '/permissions') {
      appendAssistant(formatPermissionStatus(chatManager.getPermissionStatus()));
      return;
    }
    if (input.startsWith('/permissions ')) {
      const mode = input.slice('/permissions '.length).trim();
      if (!isPermissionMode(mode)) {
        appendAssistant('用法: /permissions <strict|default|allow>');
        return;
      }
      try {
        chatManager.setPermissionMode(mode);
        setPermissionMode(mode);
        appendAssistant(`权限模式已切换为: ${mode}`);
      } catch (error) {
        appendAssistant(error instanceof Error ? error.message : String(error));
      }
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
        ? chatManager.executeLatestPlan(provider, controller.signal, permissionDecider)
        : chatManager.run(task, provider, {
            mode: isPlan ? 'plan' : 'act',
            signal: controller.signal,
            permissionDecider,
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
          case 'permission_request':
            setProgress(`第 ${event.iteration} 轮 - 等待权限确认: ${event.request.toolName}`);
            break;
          case 'permission_decision':
            setProgress(
              `第 ${event.iteration} 轮 - 权限${event.allowed ? '允许' : '拒绝'}: ${event.toolName}`,
            );
            break;
          case 'usage':
            setUsage(event.cumulative);
            break;
          case 'context_progress':
          case 'context_offloaded':
          case 'context_compacted':
            setProgress(formatContextEvent(event));
            break;
          case 'context_failed':
            lastError = formatContextEvent(event);
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
      permissionResolverRef.current = undefined;
      setPermissionRequest(undefined);
      textRef.current = '';
      thinkingRef.current = '';
      hasThinkingRef.current = false;
      setCurrentStreaming('');
      setCurrentThinking('');
      setIsThinking(false);
      setIsStreaming(false);
      setProgress('');
    }
  }, [appendAssistant, chatManager, exit, permissionDecider, provider, updateProgress]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="magenta" bold>BetterCode</Text>
        <Text color="grey"> - </Text>
        <Text color="yellow">{provider.name}</Text>
        <Text color="grey"> ({provider.model})</Text>
        <Text color="grey"> · 权限 </Text>
        <Text color="yellow">{permissionMode}</Text>
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

      {rewindDialogActive ? (
        <RewindDialog
          snapshots={rewindSnapshots}
          onSelect={handleRewind}
          onCancel={() => setRewindDialogActive(false)}
        />
      ) : isStreaming ? (
        <Box flexDirection="column">
          {permissionRequest ? (
            <PermissionPrompt
              key={permissionRequest.id}
              request={permissionRequest}
              onSelect={submitPermission}
            />
          ) : undefined}
          <Text color="grey">{progress || 'Agent 正在运行'}</Text>
          <Text color="grey">Ctrl+C 取消当前任务</Text>
        </Box>
      ) : (
        <InputBox onSubmit={sendMessage} disabled={false} history={promptHistory} />
      )}

      {usage ? (
        <Text color="grey">
          Token: 输入 {usage.inputTokens} / 输出 {usage.outputTokens} / 缓存创建{' '}
          {usage.cacheCreationInputTokens} / 缓存命中 {usage.cacheReadInputTokens} / 总计{' '}
          {usage.totalTokens}
        </Text>
      ) : undefined}
    </Box>
  );
}
