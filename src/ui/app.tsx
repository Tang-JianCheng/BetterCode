import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { AgentEvent, AgentMode, AgentStopReason } from '../agent/types.js';
import type { CcSwitchDiagnostic } from '../cc-switch/types.js';
import {
  createDefaultCommandRegistry,
  formatCommandHelp,
} from '../command/builtins.js';
import { CommandDispatcher } from '../command/dispatcher.js';
import { createSkillCommandDefinitions } from '../command/skills.js';
import type { CommandUIController } from '../command/types.js';
import {
  buildContextUsagePresentation,
  buildMemoryPresentation,
  buildPermissionPresentation,
  buildStatusPresentation,
  buildTextCommandPresentation,
} from '../command/presenters.js';
import type { ContextEvent } from '../context/types.js';
import type { ClaudeModelTier } from '../config/types.js';
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
import type { AgentDefinitionDiagnostic, SubAgentEvent } from '../subagent/types.js';
import { formatTaskDetail, formatTaskList } from '../subagent/format.js';
import { tryParseMarkdown } from '../markdown/parser.js';
import { createConversation, createNotice, createToolTrace } from '../presentation/builders.js';
import type { PresentationItem, PresentationTone } from '../presentation/types.js';
import { InputBox } from './input-box.js';
import { MessageList, type DisplayMessage } from './message-list.js';
import { PermissionPrompt } from './permission-prompt.js';
import { RewindDialog, type RewindAction } from './rewind-dialog.js';
import { SessionDialog } from './session-dialog.js';
import {
  MODEL_TIER_LABELS,
  ModelDialog,
  type ModelOption,
  type ModelTierOption,
} from './model-dialog.js';
import { detectTerminalCapabilities, terminalEnvironmentFromProcess } from './capabilities.js';
import { StartupBrand } from './mascot.js';
import type { ToolTraceEntry } from '../presentation/types.js';
import { StatusLine } from './status-line.js';
import {
  summarizeToolArguments,
  summarizeToolResult,
  toolResultStatus,
  ToolTraceView,
} from './tool-trace.js';
import { McpDialog } from './mcp-dialog.js';
import { SkillDialog } from './skill-dialog.js';
import type { McpServerToolListing } from '../mcp/types.js';
import type { SkillMetadata } from '../skill/types.js';
import {
  ActivityIndicator,
  type ActivityStage,
  type ActivityState,
} from './activity-indicator.js';
import { BETTERCODE_THEME } from './theme.js';

export const COMMAND_REGISTRY = createDefaultCommandRegistry();
export const HELP_TEXT = formatCommandHelp(COMMAND_REGISTRY);

let presentationSequence = 0;

// 流式输出按固定间隔合帧，避免每个 token 都触发一次整屏重绘；
// Apple Terminal 文本视图更脆弱，进一步放低重绘频率降低崩溃概率。
const STREAMING_FLUSH_INTERVAL_MS = 60;
const STREAMING_FLUSH_INTERVAL_APPLE_MS = 120;

function conversationText(value: string): string {
  try {
    return String(value);
  } catch {
    return '';
  }
}

function identifyPresentation(item: PresentationItem): DisplayMessage {
  presentationSequence += 1;
  return { id: `presentation-${presentationSequence}`, item };
}

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
  mcpServerTools?: readonly McpServerToolListing[];
  agentDiagnostics?: readonly AgentDefinitionDiagnostic[];
  ccSwitchStatus?: readonly CcSwitchDiagnostic[];
  providers: readonly ModelOption[];
  switchProvider(name: string): LLMProvider;
  switchModelTier(tier: ClaudeModelTier): LLMProvider;
}

export function formatContextWindowNotice(provider: LLMProvider): string | undefined {
  return provider.contextWindowIsDefault
    ? `当前 Provider 未配置 context_window，BetterCode 暂按 ${provider.contextWindow} Token 使用。`
    : undefined;
}

export function formatAppleTerminalStabilityNotice(appleTerminal: boolean): string | undefined {
  if (!appleTerminal) return undefined;
  return [
    '检测到 macOS 自带 Terminal。该终端在切换输入法等系统事件时存在 AppKit 菜单更新崩溃风险。',
    '建议改用 iTerm2、VS Code 终端或 Warp 运行 BetterCode。',
  ].join('\n');
}

export function formatSessionList(sessions: readonly SessionInfo[]): string {
  if (sessions.length === 0) return '没有可恢复的历史会话。';
  return [
    '历史会话（使用 /session <ID> 恢复）:',
    ...sessions.slice(0, 10).map(session =>
      `  ${session.id} (${session.messageCount} 条) - ${session.summary || '无摘要'}`),
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
  subAgentTasks?: { total: number; running: number; background: number };
  team?: {
    name: string;
    coordinator: boolean;
    members: number;
    tasks: number;
    pendingApprovals: number;
    unreadMessages: number;
  };
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
    `子 Agent 任务: ${status.subAgentTasks?.total ?? 0} 个（运行中 ${status.subAgentTasks?.running ?? 0} / ` +
      `后台 ${status.subAgentTasks?.background ?? 0}）`,
    ...(status.team ? [
      `团队: ${status.team.name}${status.team.coordinator ? ' [COORDINATOR]' : ''}`,
      `团队状态: 成员 ${status.team.members} / 任务 ${status.team.tasks} / ` +
        `待审批 ${status.team.pendingApprovals} / 未读 ${status.team.unreadMessages}`,
    ] : ['团队: 未激活']),
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

export function formatAgentStartupStatus(
  diagnostics: readonly AgentDefinitionDiagnostic[],
): string | undefined {
  if (diagnostics.length === 0) return undefined;
  return [
    `子 Agent 角色启动: 跳过 ${diagnostics.length} 个无效定义。`,
    ...diagnostics.map(item => `- ${item.name ?? item.file}: ${item.message}`),
  ].join('\n');
}

export function formatCcSwitchStartupStatus(
  diagnostics: readonly CcSwitchDiagnostic[],
): string | undefined {
  if (diagnostics.length === 0) return undefined;
  return [
    'cc-switch 导入: 读取外部 Claude 配置时产生以下诊断。',
    ...diagnostics.map(item => `- ${item.line}: ${item.message}`),
  ].join('\n');
}

export function formatSubAgentEvent(event: SubAgentEvent): string | undefined {
  if (event.type === 'task_backgrounded') {
    return `子 Agent 已转后台: ${event.task.id}（${event.reason}）`;
  }
  if (event.type !== 'task_finished' || event.task.executionMode !== 'background') return undefined;
  if (event.task.state === 'completed') return `后台子 Agent 已完成: ${event.task.id}`;
  if (event.task.state === 'cancelled') return `后台子 Agent 已取消: ${event.task.id}`;
  return `后台子 Agent 执行失败: ${event.task.id} - ${event.task.error?.message ?? '未知错误'}`;
}

export function App({
  provider,
  chatManager,
  skillManager,
  mcpStatus,
  mcpServerTools = [],
  agentDiagnostics = [],
  ccSwitchStatus = [],
  providers,
  switchProvider,
  switchModelTier,
}: Props) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  // 终端窗口缩放时重新渲染：capabilities 每次渲染都用 stdout.columns 重算，
  // resize 事件只负责触发一次重渲染，让折行宽度、面板与边框按新列宽布局。
  const [, setResizeTick] = useState(0);
  useEffect(() => {
    const onResize = () => setResizeTick(tick => tick + 1);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  const capabilities = detectTerminalCapabilities({
    ...terminalEnvironmentFromProcess(),
    columns: Math.max(20, (stdout.columns ?? 80) - 2),
  });
  const initialPermissionStatus = chatManager.getPermissionStatus();
  const [messages, setMessages] = useState<DisplayMessage[]>(() => {
    const initial: DisplayMessage[] = [];
    const windowNotice = formatContextWindowNotice(provider);
    if (windowNotice) initial.push(identifyPresentation(createNotice({
      tone: 'info', title: '上下文窗口', message: windowNotice, source: 'system',
    })));
    const terminalNotice = formatAppleTerminalStabilityNotice(capabilities.appleTerminal === true);
    if (terminalNotice) initial.push(identifyPresentation(createNotice({
      tone: 'warning', title: '终端稳定性提示', message: terminalNotice, source: 'system',
    })));
    if (initialPermissionStatus.diagnostics.length > 0) {
      initial.push(identifyPresentation(buildPermissionPresentation(initialPermissionStatus)));
    }
    const mcpMessage = mcpStatus ? formatMcpStartupStatus(mcpStatus) : undefined;
    if (mcpMessage) initial.push(identifyPresentation(createNotice({
      tone: 'warning', title: 'MCP 启动诊断', message: mcpMessage, source: 'system',
    })));
    const skillMessage = formatSkillStartupStatus(skillManager.getSnapshot().diagnostics);
    if (skillMessage) initial.push(identifyPresentation(createNotice({
      tone: 'warning', title: 'Skill 启动诊断', message: skillMessage, source: 'system',
    })));
    const agentMessage = formatAgentStartupStatus(agentDiagnostics);
    if (agentMessage) initial.push(identifyPresentation(createNotice({
      tone: 'warning', title: '子 Agent 启动诊断', message: agentMessage, source: 'system',
    })));
    const ccSwitchMessage = formatCcSwitchStartupStatus(ccSwitchStatus);
    if (ccSwitchMessage) {
      const worstSeverity = ccSwitchStatus.some(item => item.severity === 'error')
        ? 'danger'
        : ccSwitchStatus.some(item => item.severity === 'warning')
          ? 'warning'
          : 'info';
      initial.push(identifyPresentation(createNotice({
        tone: worstSeverity,
        title: 'cc-switch 诊断',
        message: `cc-switch 导入: 共 ${ccSwitchStatus.length} 条诊断，未成功导入时回退原配置。`,
        details: ccSwitchStatus.slice(0, 20).map(item => `${item.line}: ${item.message}`),
        source: 'system',
      })));
    }
    return initial;
  });
  const [currentStreaming, setCurrentStreaming] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activity, setActivity] = useState<ActivityState | undefined>();
  const [usage, setUsage] = useState<TokenUsage | undefined>();
  // 状态行默认开启，可随时用 /statusline 关闭
  const [statusLineVisible, setStatusLineVisible] = useState(true);
  const [traceEntries, setTraceEntries] = useState<ToolTraceEntry[]>([]);
  const [traceToggle, setTraceToggle] = useState(0);
  // 工具轨迹在异步事件流里累积，用 ref 同步读取，避免 finally 里读到旧 state。
  const traceRef = useRef<ToolTraceEntry[]>([]);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | undefined>();
  const [promptHistory, setPromptHistory] = useState(() => chatManager.getPromptHistory());
  const [rewindSnapshots, setRewindSnapshots] = useState(() => chatManager.getSnapshots());
  const [rewindDialogActive, setRewindDialogActive] = useState(false);
  const [sessionDialogActive, setSessionDialogActive] = useState(false);
  const [sessionDialogSessions, setSessionDialogSessions] = useState<SessionInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState(provider);
  const [modelDialogActive, setModelDialogActive] = useState(false);
  const [modelTiers, setModelTiers] = useState<ModelTierOption[]>([]);
  const [mcpDialogActive, setMcpDialogActive] = useState(false);
  const [skillDialogActive, setSkillDialogActive] = useState(false);
  const [skillDialogSkills, setSkillDialogSkills] = useState<SkillMetadata[]>([]);
  const [skillRevision, setSkillRevision] = useState(() => skillManager.getSnapshot().revision);

  const commandRegistry = useMemo(() => {
    void skillRevision;
    return createDefaultCommandRegistry(createSkillCommandDefinitions(skillManager.list()));
  }, [skillManager, skillRevision]);
  const commandDispatcher = useMemo(() => new CommandDispatcher(commandRegistry), [commandRegistry]);

  const textRef = useRef('');
  const streamingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const streamingFlushIntervalRef = useRef(
    capabilities.appleTerminal === true
      ? STREAMING_FLUSH_INTERVAL_APPLE_MS
      : STREAMING_FLUSH_INTERVAL_MS,
  );
  const abortRef = useRef<AbortController | undefined>();
  // agentMode 同时用 state 和 ref：state 保证 /plan /do 等切换触发重渲染，
  // ref 供事件流回调在重渲染前读到最新值。
  const [agentMode, setAgentModeState] = useState<AgentMode>('act');
  const agentModeRef = useRef<AgentMode>('act');
  agentModeRef.current = agentMode;
  const permissionResolverRef = useRef<{
    requestId: string;
    resolve: (choice: PermissionChoice) => void;
  }>();

  const scheduleStreamingFlush = useCallback(() => {
    if (streamingFlushTimerRef.current !== undefined) return;
    streamingFlushTimerRef.current = setTimeout(() => {
      streamingFlushTimerRef.current = undefined;
      setCurrentStreaming(textRef.current);
    }, streamingFlushIntervalRef.current);
  }, []);

  useInput((input, key) => {
    if (!key.ctrl) return;
    if (input.toLowerCase() === 'b' && isStreaming) {
      chatManager.backgroundCurrentSubAgent();
      return;
    }
    if (input.toLowerCase() === 'c') {
      if (isStreaming) abortRef.current?.abort();
      else exit();
    }
  });

  const appendPresentation = useCallback((item: PresentationItem) => {
    setMessages(previous => [...previous, identifyPresentation(item)]);
  }, []);

  const appendAssistant = useCallback((content: string) => {
    appendPresentation(createConversation({ role: 'assistant', content }));
  }, [appendPresentation]);

  const appendNotice = useCallback((
    title: string,
    message: string,
    tone: PresentationTone = 'info',
  ) => {
    appendPresentation(createNotice({ tone, title, message, source: 'system' }));
  }, [appendPresentation]);

  const setAgentMode = useCallback((mode: AgentMode) => {
    setAgentModeState(mode);
  }, []);

  useEffect(() => chatManager.subscribeMemorySaved(names => {
    appendNotice('长期记忆已保存', names.join(', '), 'success');
  }), [appendNotice, chatManager]);

  useEffect(() => chatManager.subscribeSubAgent(event => {
    const message = formatSubAgentEvent(event);
    if (message) appendNotice('子 Agent', message, event.type === 'task_finished' ? 'success' : 'info');
  }), [appendNotice, chatManager]);

  useEffect(() => chatManager.subscribeTeam(event => {
    appendNotice('团队动态', event.summary, 'info');
  }), [appendNotice, chatManager]);

  useEffect(() => skillManager.subscribe(snapshot => {
    setSkillRevision(snapshot.revision);
  }), [skillManager]);

  const updateProgress = useCallback((event: Extract<AgentEvent, { type: 'progress' }>) => {
    const stageByProgress: Record<typeof event.stage, ActivityStage> = {
      requesting_model: 'requesting_model',
      model_complete: 'thinking',
      checking_permissions: 'checking_permissions',
      waiting_permission: 'waiting_permission',
      executing_tools: 'executing_tool',
      tools_complete: 'executing_tool',
    };
    setActivity({
      stage: stageByProgress[event.stage],
      label: PROGRESS_LABELS[event.stage],
      iteration: event.iteration,
      maxIterations: event.maxIterations,
      ...(event.toolName ? { toolName: event.toolName } : {}),
      startedAt: Date.now(),
    });
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
        const restoredEntries = result.history.flatMap(message => {
          if (message.role !== 'user' && message.role !== 'assistant') return [];
          if (message.role === 'user') {
            return [{
              item: identifyPresentation(createConversation({
                role: 'user',
                content: message.content,
              })),
              recovered: false,
            }];
          }
          const parsed = tryParseMarkdown(message.content);
          return [{
            item: identifyPresentation(createConversation({
              role: 'assistant',
              content: parsed.recovered ? conversationText(message.content) : message.content,
              ...(parsed.recovered ? {} : { markdown: parsed.ast }),
            })),
            recovered: parsed.recovered,
          }];
        });
        setMessages(restoredEntries.map(entry => entry.item));
        const recoveredCount = restoredEntries.filter(entry => entry.recovered).length;
        if (recoveredCount > 0) {
          appendNotice(
            'Markdown 解析失败',
            `回滚恢复的助手消息中有 ${recoveredCount} 条按纯文本展示原文。`,
            'warning',
          );
        }
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
  }, [appendAssistant, appendNotice, chatManager]);

  const consumeAgentStream = useCallback(async (
    eventStream: AsyncIterable<AgentEvent>,
    displayText: string,
    controller: AbortController,
  ) => {
    textRef.current = '';
    if (streamingFlushTimerRef.current !== undefined) {
      clearTimeout(streamingFlushTimerRef.current);
      streamingFlushTimerRef.current = undefined;
    }
    abortRef.current = controller;
    setIsStreaming(true);
    setCurrentStreaming('');
    setActivity({ stage: 'preparing', label: '准备运行 Agent', startedAt: Date.now() });
    setUsage(undefined);
    setMessages(previous => [...previous, identifyPresentation(createConversation({
      role: 'user', content: displayText,
    }))]);

    let terminal: Extract<AgentEvent, { type: 'stopped' }> | undefined;
    let lastError = '';
    try {
      for await (const event of eventStream) {
        switch (event.type) {
          case 'text_delta':
            textRef.current += event.content;
            scheduleStreamingFlush();
            break;
          case 'tool_call':
            setActivity({
              stage: 'executing_tool', label: '准备调用工具', iteration: event.iteration,
              toolName: event.call.name, startedAt: Date.now(),
            });
            {
              const entry: ToolTraceEntry = {
                callId: event.call.id,
                toolName: event.call.name,
                status: 'running',
                args: summarizeToolArguments(event.call.arguments),
              };
              traceRef.current = [...traceRef.current, entry];
              setTraceEntries([...traceRef.current]);
            }
            break;
          case 'tool_result':
            setActivity({
              stage: 'executing_tool', label: '工具已返回', iteration: event.iteration,
              toolName: event.call.name, startedAt: Date.now(),
            });
            traceRef.current = traceRef.current.map(entry => (
              entry.callId === event.call.id
                ? {
                    ...entry,
                    status: toolResultStatus(event.result),
                    result: summarizeToolResult(event.result.output),
                  }
                : entry
            ));
            setTraceEntries([...traceRef.current]);
            break;
          case 'permission_request':
            setActivity({
              stage: 'waiting_permission', label: '等待权限确认', iteration: event.iteration,
              toolName: event.request.toolName, startedAt: Date.now(),
            });
            break;
          case 'permission_decision':
            setActivity({
              stage: 'checking_permissions',
              label: event.allowed ? '权限已允许' : '权限已拒绝',
              iteration: event.iteration,
              toolName: event.toolName,
              startedAt: Date.now(),
            });
            break;
          case 'usage':
            setUsage(event.cumulative);
            break;
          case 'context_progress':
          case 'context_offloaded':
          case 'context_compacted':
            setActivity({
              stage: 'compacting_context',
              label: formatContextEvent(event),
              iteration: event.iteration,
              startedAt: Date.now(),
            });
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
      const completedMessages: DisplayMessage[] = [];
      if (finalText) {
        const parsed = tryParseMarkdown(finalText);
        const content = parsed.recovered ? conversationText(finalText) : finalText;
        completedMessages.push(identifyPresentation(createConversation({
          role: 'assistant',
          content,
          ...(parsed.recovered ? {} : { markdown: parsed.ast }),
        })));
        if (parsed.recovered) {
          completedMessages.push(identifyPresentation(createNotice({
            tone: 'warning',
            title: 'Markdown 解析失败',
            message: '该条回复已按纯文本展示原文。',
            source: 'agent',
          })));
        }
      }
      const stopMessage = terminal ? STOP_MESSAGES[terminal.reason] : undefined;
      const errorMessage = lastError || stopMessage;
      if (errorMessage) completedMessages.push(identifyPresentation(createNotice({
        tone: lastError ? 'danger' : 'warning',
        title: lastError ? 'Agent 执行失败' : 'Agent 已停止',
        message: errorMessage,
        source: 'agent',
      })));
      if (traceRef.current.length > 0) {
        // 本次任务的工具调用轨迹以折叠展示项保留在消息列表，按 Enter 展开/收起
        completedMessages.push(identifyPresentation(createToolTrace({
          title: '工具调用',
          source: 'agent',
          entries: [...traceRef.current],
        })));
      }
      traceRef.current = [];
      setTraceEntries([]);
      if (completedMessages.length > 0) {
        setMessages(previous => [...previous, ...completedMessages]);
      }

      if (streamingFlushTimerRef.current !== undefined) {
        clearTimeout(streamingFlushTimerRef.current);
        streamingFlushTimerRef.current = undefined;
      }

      abortRef.current = undefined;
      permissionResolverRef.current = undefined;
      setPermissionRequest(undefined);
      textRef.current = '';
      setCurrentStreaming('');
      setIsStreaming(false);
      setActivity(undefined);
    }
  }, [scheduleStreamingFlush, updateProgress]);

  const sendAgentMessage = useCallback(async (content: string, displayText = content) => {
    const controller = new AbortController();
    await consumeAgentStream(chatManager.run(content, activeProvider, {
      mode: agentModeRef.current,
      signal: controller.signal,
      permissionDecider,
    }), displayText, controller);
  }, [activeProvider, chatManager, consumeAgentStream, permissionDecider]);

  const runSkill = useCallback(async (name: string, args: string, displayText: string) => {
    const controller = new AbortController();
    try {
      await consumeAgentStream(chatManager.runSkill(name, args, displayText, activeProvider, {
        mode: agentModeRef.current,
        signal: controller.signal,
        permissionDecider,
      }), displayText, controller);
    } catch (error) {
      appendAssistant(error instanceof Error ? error.message : String(error));
    }
  }, [activeProvider, appendAssistant, chatManager, consumeAgentStream, permissionDecider]);

  const clearConversation = useCallback(async () => {
    await chatManager.clear();
    setMessages([]);
    setUsage(undefined);
    setActivity(undefined);
    setRewindSnapshots([]);
    setAgentMode('act');
  }, [chatManager, setAgentMode]);

  const compactConversation = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);
    setActivity({ stage: 'compacting_context', label: '准备压缩上下文', startedAt: Date.now() });
    try {
      for await (const event of chatManager.compact(activeProvider, controller.signal)) {
        if (event.type === 'context_progress' || event.type === 'context_offloaded') {
          setActivity({
            stage: 'compacting_context',
            label: formatContextEvent(event),
            iteration: event.iteration,
            startedAt: Date.now(),
          });
        } else if (event.type === 'context_compacted' || event.type === 'context_failed') {
          appendNotice(
            event.type === 'context_compacted' ? '上下文已压缩' : '上下文管理失败',
            formatContextEvent(event),
            event.type === 'context_compacted' ? 'success' : 'danger',
          );
        } else if (event.type === 'error') {
          appendNotice('上下文管理失败', event.message, 'danger');
        }
      }
    } finally {
      abortRef.current = undefined;
      setIsStreaming(false);
      setActivity(undefined);
    }
  }, [activeProvider, appendNotice, chatManager]);

  const resumeSessionAndRender = useCallback(async (sessionId: string) => {
    try {
      const restored = await chatManager.resumeSession(sessionId);
      const visible = restored.filter((message): message is Extract<typeof message, { role: 'user' | 'assistant' }> =>
        message.role === 'user' || message.role === 'assistant');
      const restoredEntries = visible.map(message => {
        if (message.role === 'user') {
          return {
            item: identifyPresentation(createConversation({ role: 'user', content: message.content })),
            recovered: false,
          };
        }
        const parsed = tryParseMarkdown(message.content);
        return {
          item: identifyPresentation(createConversation({
            role: 'assistant',
            content: parsed.recovered ? conversationText(message.content) : message.content,
            ...(parsed.recovered ? {} : { markdown: parsed.ast }),
          })),
          recovered: parsed.recovered,
        };
      });
      const recoveredCount = restoredEntries.filter(entry => entry.recovered).length;
      setMessages([
        ...restoredEntries.map(entry => entry.item),
        ...(recoveredCount > 0 ? [identifyPresentation(createNotice({
          tone: 'warning',
          title: 'Markdown 解析失败',
          message: `恢复的助手消息中有 ${recoveredCount} 条按纯文本展示原文。`,
          source: 'system',
        }))] : []),
        identifyPresentation(createNotice({
          tone: 'success',
          title: '会话已恢复',
          message: `${sessionId}（${restored.length} 条消息）`,
          source: 'command',
        })),
      ]);
      setUsage(undefined);
      setRewindSnapshots(chatManager.getSnapshots());
    } catch (error) {
      appendNotice(
        '会话恢复失败',
        error instanceof Error ? error.message : String(error),
        'danger',
      );
    }
  }, [appendNotice, chatManager]);

  const showOrResumeSession = useCallback(async (sessionId?: string) => {
    if (!sessionId) {
      const sessions = chatManager.listSessions();
      if (sessions.length === 0) {
        appendNotice('无法恢复', '没有可恢复的历史会话。', 'warning');
        return;
      }
      setSessionDialogSessions(sessions);
      setSessionDialogActive(true);
      return;
    }
    await resumeSessionAndRender(sessionId);
  }, [appendNotice, chatManager, resumeSessionAndRender]);

  const handleSessionSelect = useCallback((sessionId: string) => {
    setSessionDialogActive(false);
    void resumeSessionAndRender(sessionId);
  }, [resumeSessionAndRender]);

  const handleSessionDelete = useCallback((sessionId: string) => {
    try {
      chatManager.deleteSession(sessionId);
      const remaining = chatManager.listSessions();
      setSessionDialogSessions(remaining);
      if (remaining.length === 0) setSessionDialogActive(false);
      appendNotice('会话已删除', sessionId, 'success');
    } catch (error) {
      appendNotice(
        '删除失败',
        error instanceof Error ? error.message : String(error),
        'danger',
      );
    }
  }, [appendNotice, chatManager]);

  const showMemoryStatus = useCallback(() => {
    appendPresentation(buildMemoryPresentation(
      chatManager.getMemoryStatus(),
      chatManager.getMemoryGovernanceStatus(),
    ));
  }, [appendPresentation, chatManager]);

  const showOrSetPermission = useCallback((mode?: PermissionMode) => {
    if (!mode) {
      appendPresentation(buildPermissionPresentation(chatManager.getPermissionStatus()));
      return;
    }
    chatManager.setPermissionMode(mode);
    appendNotice('权限模式已切换', mode, 'success');
  }, [appendNotice, appendPresentation, chatManager]);

  // Shift+Tab 循环切换权限模式：strict → default → allow → strict
  const cyclePermissionMode = useCallback(() => {
    const order: readonly PermissionMode[] = ['strict', 'default', 'allow'];
    const current = chatManager.getPermissionStatus().mode;
    const next = order[(order.indexOf(current) + 1 + order.length) % order.length];
    chatManager.setPermissionMode(next);
    appendNotice('权限模式已切换', next, 'success');
  }, [appendNotice, chatManager]);

  const showOrSwitchModel = useCallback(() => {
    const active = providers.find(item => item.name === activeProvider.name);
    const tierEntries = active?.model_tiers;
    const tierList: ModelTierOption[] = tierEntries
      ? (Object.entries(tierEntries) as [ClaudeModelTier, { model: string; context_window?: number }][])
        .filter(([, config]) => Boolean(config.model))
        .map(([tier, config]) => ({
          tier,
          model: config.model,
          context_window: config.context_window,
        }))
      : [];
    if (tierList.length > 0) {
      setModelTiers(tierList);
      setModelDialogActive(true);
      return;
    }
    if (providers.length <= 1) {
      appendNotice('无法切换', '当前只有一个 Provider，无需切换模型。', 'warning');
      return;
    }
    setModelTiers([]);
    setModelDialogActive(true);
  }, [activeProvider.name, appendNotice, providers]);

  const handleTierSelect = useCallback((tier: ClaudeModelTier) => {
    setModelDialogActive(false);
    try {
      const next = switchModelTier(tier);
      setActiveProvider(next);
      appendNotice('模型已切换', `${MODEL_TIER_LABELS[tier]}（${next.model}）`, 'success');
    } catch (error) {
      appendNotice(
        '切换失败',
        error instanceof Error ? error.message : String(error),
        'danger',
      );
    }
  }, [appendNotice, switchModelTier]);

  const handleModelSelect = useCallback((name: string) => {
    setModelDialogActive(false);
    try {
      const next = switchProvider(name);
      setActiveProvider(next);
      appendNotice('模型已切换', `${next.name}（${next.model}）`, 'success');
    } catch (error) {
      appendNotice(
        '切换失败',
        error instanceof Error ? error.message : String(error),
        'danger',
      );
    }
  }, [appendNotice, switchProvider]);

  const showStatus = useCallback(() => {
    const tasks = chatManager.listSubAgentTasks();
    const teamStatus = chatManager.getTeamStatus();
    const teamRecord = teamStatus.team as { name?: string } | undefined;
    const coordinator = teamStatus.coordinator as { active?: boolean } | undefined;
    appendPresentation(buildStatusPresentation({
      provider: activeProvider,
      agentMode: agentModeRef.current,
      permissionMode: chatManager.getPermissionStatus().mode,
      sessionId: chatManager.getSessionId(),
      usage,
      memory: chatManager.getMemoryStatus(),
      activeSkills: skillManager.getActiveNames(),
      subAgentTasks: {
        total: tasks.length,
        running: tasks.filter(task => task.state === 'waiting' || task.state === 'running').length,
        background: tasks.filter(task => task.executionMode === 'background' &&
          (task.state === 'waiting' || task.state === 'running')).length,
      },
      ...(teamStatus.active === true && teamRecord?.name ? {
        team: {
          name: teamRecord.name,
          coordinator: coordinator?.active === true,
          members: Array.isArray(teamStatus.members) ? teamStatus.members.length : 0,
          tasks: Array.isArray(teamStatus.tasks) ? teamStatus.tasks.length : 0,
          pendingApprovals: Number(teamStatus.pendingApprovals ?? 0),
          unreadMessages: Number(teamStatus.unreadMessages ?? 0),
        },
      } : {}),
    }));
  }, [activeProvider, appendPresentation, chatManager, skillManager, usage]);

  const showContextUsage = useCallback(() => {
    const snapshot = chatManager.getContextUsage(activeProvider, agentModeRef.current);
    appendPresentation(buildContextUsagePresentation(snapshot, {
      unicode: capabilities.unicode,
      columns: capabilities.columns,
    }));
  }, [activeProvider, appendPresentation, capabilities.columns, capabilities.unicode, chatManager]);

  const showMcpTools = useCallback(() => {
    if (mcpServerTools.length === 0) {
      appendNotice('无法展示', '当前没有配置任何 MCP Server。', 'warning');
      return;
    }
    setMcpDialogActive(true);
  }, [appendNotice, mcpServerTools.length]);

  const showSkillList = useCallback(() => {
    const skills = skillManager.list();
    if (skills.length === 0) {
      appendNotice('无法展示', '当前没有可用 Skill。', 'warning');
      return;
    }
    setSkillDialogSkills(skills);
    setSkillDialogActive(true);
  }, [appendNotice, skillManager]);

  const runSkillFromDialog = useCallback((name: string) => {
    setSkillDialogActive(false);
    void runSkill(name, '', `/${name}`);
  }, [runSkill]);

  const rewindConversation = useCallback(() => {
    const snapshots = chatManager.getSnapshots();
    if (snapshots.length === 0) {
      appendNotice('无法回滚', '当前会话没有可回滚的检查点。', 'warning');
      return;
    }
    setRewindSnapshots(snapshots);
    setRewindDialogActive(true);
  }, [appendNotice, chatManager]);

  const showSubAgentTasks = useCallback((taskId?: string) => {
    appendPresentation(buildTextCommandPresentation(
      taskId ? `子 Agent 任务 ${taskId}` : '子 Agent 任务',
      taskId
        ? formatTaskDetail(chatManager.getSubAgentTask(taskId), taskId)
        : formatTaskList(chatManager.listSubAgentTasks()),
      'TASKS',
    ));
  }, [appendPresentation, chatManager]);

  const manageTeam = useCallback(async (args: string) => {
    appendPresentation(buildTextCommandPresentation(
      '团队管理', await chatManager.manageTeam(args), 'TEAM',
    ));
  }, [appendPresentation, chatManager]);

  const commandUi = useMemo<CommandUIController>(() => ({
    showMessage: appendAssistant,
    showPresentation: appendPresentation,
    sendUserMessage: sendAgentMessage,
    runSkill,
    setAgentMode,
    getAgentMode: () => agentModeRef.current,
    getTokenUsage: () => usage,
    refreshStatus: () => undefined,
    clearConversation,
    compactConversation,
    showOrResumeSession,
    showOrSwitchModel,
    showMemoryStatus,
    showOrSetPermission,
    showStatus,
    showContextUsage,
    toggleStatusLine: () => setStatusLineVisible(visible => !visible),
    showMcpTools,
    showSkillList,
    showSubAgentTasks,
    manageTeam,
    rewindConversation,
    exit,
  }), [
    appendAssistant,
    appendPresentation,
    clearConversation,
    compactConversation,
    exit,
    rewindConversation,
    sendAgentMessage,
    runSkill,
    setAgentMode,
    showMemoryStatus,
    showOrResumeSession,
    showOrSwitchModel,
    showOrSetPermission,
    showStatus,
    showContextUsage,
    showMcpTools,
    showSkillList,
    showSubAgentTasks,
    manageTeam,
    usage,
  ]);

  const handleSubmit = useCallback(async (input: string) => {
    chatManager.recordPrompt(input);
    setPromptHistory(chatManager.getPromptHistory());
    const result = await commandDispatcher.dispatch(input, commandUi);
    if (result.status === 'not_command') await sendAgentMessage(input);
  }, [chatManager, commandDispatcher, commandUi, sendAgentMessage]);

  // 输入为空按 Enter 时切换最近的工具调用折叠视图；无工具轨迹时不做任何事。
  const handleToggleTrace = useCallback(() => {
    if (!messages.some(message => message.item.kind === 'tool_trace')) return;
    setTraceToggle(tick => tick + 1);
  }, [messages]);

  // 状态栏的上下文占用快照：消息或模式变化时重算一次，流式合帧期间不重复全量估算。
  const contextSnapshot = useMemo(
    () => chatManager.getContextUsage(activeProvider, agentMode),
    [activeProvider, agentMode, chatManager, messages],
  );

  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1}>
      <StartupBrand capabilities={capabilities} version="0.1.0" modelName={activeProvider.name} />

      <MessageList
        messages={messages}
        currentStreaming={currentStreaming}
        capabilities={capabilities}
        toggleSignal={traceToggle}
      />

      {modelDialogActive ? (
        <ModelDialog
          providers={providers}
          currentProviderName={activeProvider.name}
          onSelect={handleModelSelect}
          tiers={modelTiers}
          currentTier={providers.find(item => item.name === activeProvider.name)?.active_tier ?? 'sonnet'}
          onSelectTier={handleTierSelect}
          onCancel={() => setModelDialogActive(false)}
          capabilities={capabilities}
        />
      ) : sessionDialogActive ? (
        <SessionDialog
          sessions={sessionDialogSessions}
          currentSessionId={chatManager.getSessionId()}
          onSelect={handleSessionSelect}
          onDelete={handleSessionDelete}
          onCancel={() => setSessionDialogActive(false)}
          capabilities={capabilities}
        />
      ) : rewindDialogActive ? (
        <RewindDialog
          snapshots={rewindSnapshots}
          onSelect={handleRewind}
          onCancel={() => setRewindDialogActive(false)}
          capabilities={capabilities}
        />
      ) : mcpDialogActive ? (
        <McpDialog
          servers={mcpServerTools}
          onCancel={() => setMcpDialogActive(false)}
          capabilities={capabilities}
        />
      ) : skillDialogActive ? (
        <SkillDialog
          skills={skillDialogSkills}
          onSelect={runSkillFromDialog}
          onCancel={() => setSkillDialogActive(false)}
          capabilities={capabilities}
        />
      ) : isStreaming ? (
        <Box flexDirection="column">
          {permissionRequest ? (
            <PermissionPrompt
              key={permissionRequest.id}
              request={permissionRequest}
              onSelect={submitPermission}
              capabilities={capabilities}
            />
          ) : undefined}
          {activity ? (
            <ActivityIndicator activity={activity} capabilities={capabilities} />
          ) : <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>Agent 正在运行</Text>}
          {traceEntries.length > 0 ? (
            <ToolTraceView entries={traceEntries} capabilities={capabilities} live />
          ) : undefined}
          <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>Ctrl+C 取消当前任务</Text>
          {chatManager.hasForegroundSubAgent() ? (
            <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
              Ctrl+B 将当前子 Agent 转到后台
            </Text>
          ) : undefined}
        </Box>
      ) : (
        <Box flexDirection="column">
          <InputBox
            onSubmit={handleSubmit}
            disabled={false}
            history={promptHistory}
            complete={input => commandRegistry.complete(input)}
            capabilities={capabilities}
            focused={!rewindDialogActive && !permissionRequest}
            onEmptyEnter={handleToggleTrace}
            onShiftTab={cyclePermissionMode}
          />
        </Box>
      )}
      {statusLineVisible ? (
        // 状态行固定在输入区底部，流式期间也常驻，展示当前上下文的真实占用与窗口容量
        <StatusLine
          providerName={activeProvider.name}
          model={activeProvider.model}
          agentMode={agentMode}
          permissionMode={chatManager.getPermissionStatus().mode}
          contextTokens={contextSnapshot.usedTokens}
          contextWindow={contextSnapshot.contextWindow}
          sessionId={chatManager.getSessionId()}
          capabilities={capabilities}
        />
      ) : undefined}
    </Box>
  );
}
