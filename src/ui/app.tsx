import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { AgentEvent, AgentMode, AgentStopReason } from '../agent/types.js';
import {
  createDefaultCommandRegistry,
  formatCommandHelp,
} from '../command/builtins.js';
import { CommandDispatcher } from '../command/dispatcher.js';
import { createSkillCommandDefinitions } from '../command/skills.js';
import type { CommandUIController } from '../command/types.js';
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
  type ChatManager,
  type MemoryStatus,
} from '../chat/manager.js';
import type { SessionInfo } from '../session/session.js';
import type { McpStartupStatus } from '../mcp/types.js';
import type { SkillManager } from '../skill/manager.js';
import type { SkillDiagnostic } from '../skill/types.js';
import { InputBox } from './input-box.js';
import { MessageList, type DisplayMessage } from './message-list.js';
import { PermissionPrompt } from './permission-prompt.js';
import { RewindDialog, type RewindAction } from './rewind-dialog.js';

export const COMMAND_REGISTRY = createDefaultCommandRegistry();
export const HELP_TEXT = formatCommandHelp(COMMAND_REGISTRY);

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
  skillManager: SkillManager;
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
    '历史会话（使用 /session <ID> 恢复）:',
    ...sessions.slice(0, 10).map(session =>
      `  ${session.id} (${session.messageCount} 条) - ${session.firstMessage || '无标题'}`),
  ].join('\n');
}

export interface BetterCodeStatus {
  provider: Pick<LLMProvider, 'name' | 'model'>;
  agentMode: AgentMode;
  permissionMode: PermissionMode;
  sessionId: string;
  usage?: TokenUsage;
  memory: MemoryStatus;
  activeSkills?: readonly string[];
}

export function formatAgentMode(mode: AgentMode): '[DEFAULT]' | '[PLAN]' {
  return mode === 'plan' ? '[PLAN]' : '[DEFAULT]';
}

export function formatStatus(status: BetterCodeStatus): string {
  const usage = status.usage
    ? `${status.usage.totalTokens}（输入 ${status.usage.inputTokens} / 输出 ${status.usage.outputTokens}）`
    : '暂无';
  return [
    `Provider: ${status.provider.name} (${status.provider.model})`,
    `Agent 模式: ${formatAgentMode(status.agentMode)}`,
    `权限模式: ${status.permissionMode}`,
    `当前会话: ${status.sessionId}`,
    `Token: ${usage}`,
    `长期记忆: 用户级 ${status.memory.userCount} 条 / 项目级 ${status.memory.projectCount} 条`,
    `已激活 Skill: ${status.activeSkills?.length ? status.activeSkills.join(', ') : '无'}`,
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

export function formatSkillStartupStatus(
  diagnostics: readonly SkillDiagnostic[],
): string | undefined {
  if (diagnostics.length === 0) return undefined;
  return [
    `Skill 启动: 跳过 ${diagnostics.length} 个无效定义。`,
    ...diagnostics.map(item => `- ${item.name ?? item.file}: ${item.message}`),
  ].join('\n');
}

export function App({ provider, chatManager, skillManager, mcpStatus }: Props) {
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
    const skillMessage = formatSkillStartupStatus(skillManager.getSnapshot().diagnostics);
    if (skillMessage) initial.push({ role: 'assistant', content: skillMessage });
    return initial;
  });
  const [currentStreaming, setCurrentStreaming] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [progress, setProgress] = useState('');
  const [usage, setUsage] = useState<TokenUsage | undefined>();
  const [permissionMode, setPermissionMode] = useState(initialPermissionStatus.mode);
  const [agentMode, setAgentModeState] = useState<AgentMode>('act');
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | undefined>();
  const [promptHistory, setPromptHistory] = useState(() => chatManager.getPromptHistory());
  const [rewindSnapshots, setRewindSnapshots] = useState(() => chatManager.getSnapshots());
  const [rewindDialogActive, setRewindDialogActive] = useState(false);
  const [, setStatusVersion] = useState(0);
  const [skillRevision, setSkillRevision] = useState(() => skillManager.getSnapshot().revision);

  const commandRegistry = useMemo(() => {
    void skillRevision;
    return createDefaultCommandRegistry(createSkillCommandDefinitions(skillManager.list()));
  }, [skillManager, skillRevision]);
  const commandDispatcher = useMemo(() => new CommandDispatcher(commandRegistry), [commandRegistry]);

  const textRef = useRef('');
  const thinkingRef = useRef('');
  const hasThinkingRef = useRef(false);
  const abortRef = useRef<AbortController | undefined>();
  const agentModeRef = useRef<AgentMode>('act');
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

  const setAgentMode = useCallback((mode: AgentMode) => {
    agentModeRef.current = mode;
    setAgentModeState(mode);
  }, []);

  useEffect(() => chatManager.subscribeMemorySaved(names => {
    appendAssistant(`长期记忆已保存: ${names.join(', ')}`);
  }), [appendAssistant, chatManager]);

  useEffect(() => skillManager.subscribe(snapshot => {
    setSkillRevision(snapshot.revision);
  }), [skillManager]);

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

  const consumeAgentStream = useCallback(async (
    eventStream: AsyncIterable<AgentEvent>,
    displayText: string,
    controller: AbortController,
  ) => {
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
    setMessages(previous => [...previous, { role: 'user', content: displayText }]);

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
  }, [updateProgress]);

  const sendAgentMessage = useCallback(async (content: string, displayText = content) => {
    const controller = new AbortController();
    await consumeAgentStream(chatManager.run(content, provider, {
      mode: agentModeRef.current,
      signal: controller.signal,
      permissionDecider,
    }), displayText, controller);
  }, [chatManager, consumeAgentStream, permissionDecider, provider]);

  const runSkill = useCallback(async (name: string, args: string, displayText: string) => {
    const controller = new AbortController();
    try {
      await consumeAgentStream(chatManager.runSkill(name, args, displayText, provider, {
        mode: agentModeRef.current,
        signal: controller.signal,
        permissionDecider,
      }), displayText, controller);
    } catch (error) {
      appendAssistant(error instanceof Error ? error.message : String(error));
    }
  }, [appendAssistant, chatManager, consumeAgentStream, permissionDecider, provider]);

  const clearConversation = useCallback(async () => {
    await chatManager.clear();
    setMessages([]);
    setUsage(undefined);
    setRewindSnapshots([]);
    setAgentMode('act');
  }, [chatManager, setAgentMode]);

  const compactConversation = useCallback(async () => {
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
    } finally {
      abortRef.current = undefined;
      setIsStreaming(false);
      setProgress('');
    }
  }, [appendAssistant, chatManager, provider]);

  const showOrResumeSession = useCallback(async (sessionId?: string) => {
    if (!sessionId) {
      appendAssistant([
        `当前会话: ${chatManager.getSessionId()}`,
        formatSessionList(chatManager.listSessions()),
      ].join('\n\n'));
      return;
    }
    const restored = await chatManager.resumeSession(sessionId);
    setMessages([
      ...restored.map(message => ({ ...message })),
      { role: 'assistant', content: `已恢复会话 ${sessionId}（${restored.length} 条消息）。` },
    ]);
    setUsage(undefined);
    setRewindSnapshots(chatManager.getSnapshots());
  }, [appendAssistant, chatManager]);

  const showMemoryStatus = useCallback(() => {
    appendAssistant(formatMemoryStatus(chatManager.getMemoryStatus()));
  }, [appendAssistant, chatManager]);

  const showOrSetPermission = useCallback((mode?: PermissionMode) => {
    if (!mode) {
      appendAssistant(formatPermissionStatus(chatManager.getPermissionStatus()));
      return;
    }
    chatManager.setPermissionMode(mode);
    setPermissionMode(mode);
    appendAssistant(`权限模式已切换为: ${mode}`);
  }, [appendAssistant, chatManager]);

  const showStatus = useCallback(() => {
    appendAssistant(formatStatus({
      provider,
      agentMode: agentModeRef.current,
      permissionMode: chatManager.getPermissionStatus().mode,
      sessionId: chatManager.getSessionId(),
      usage,
      memory: chatManager.getMemoryStatus(),
      activeSkills: skillManager.getActiveNames(),
    }));
  }, [appendAssistant, chatManager, provider, skillManager, usage]);

  const rewindConversation = useCallback(() => {
    const snapshots = chatManager.getSnapshots();
    if (snapshots.length === 0) {
      appendAssistant('当前会话没有可回滚的检查点。');
      return;
    }
    setRewindSnapshots(snapshots);
    setRewindDialogActive(true);
  }, [appendAssistant, chatManager]);

  const commandUi = useMemo<CommandUIController>(() => ({
    showMessage: appendAssistant,
    sendUserMessage: sendAgentMessage,
    runSkill,
    setAgentMode,
    getAgentMode: () => agentModeRef.current,
    getTokenUsage: () => usage,
    refreshStatus: () => setStatusVersion(version => version + 1),
    clearConversation,
    compactConversation,
    showOrResumeSession,
    showMemoryStatus,
    showOrSetPermission,
    showStatus,
    rewindConversation,
    exit,
  }), [
    appendAssistant,
    clearConversation,
    compactConversation,
    exit,
    rewindConversation,
    sendAgentMessage,
    runSkill,
    setAgentMode,
    showMemoryStatus,
    showOrResumeSession,
    showOrSetPermission,
    showStatus,
    usage,
  ]);

  const handleSubmit = useCallback(async (input: string) => {
    chatManager.recordPrompt(input);
    setPromptHistory(chatManager.getPromptHistory());
    const result = await commandDispatcher.dispatch(input, commandUi);
    if (result.status === 'not_command') await sendAgentMessage(input);
  }, [chatManager, commandDispatcher, commandUi, sendAgentMessage]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="magenta" bold>BetterCode</Text>
        <Text color="grey"> - </Text>
        <Text color="yellow">{provider.name}</Text>
        <Text color="grey"> ({provider.model})</Text>
        <Text color="grey"> · 模式 </Text>
        <Text color={agentMode === 'plan' ? 'cyan' : 'green'} bold>
          {formatAgentMode(agentMode)}
        </Text>
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
        <InputBox
          onSubmit={handleSubmit}
          disabled={false}
          history={promptHistory}
          complete={input => commandRegistry.complete(input)}
        />
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
