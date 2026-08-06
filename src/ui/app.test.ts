import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import type { AgentEvent } from '../agent/types.js';
import type { ChatManager } from '../chat/manager.js';
import type { Snapshot } from '../filehistory/filehistory.js';
import type { LLMProvider, Message } from '../provider/types.js';
import type { SkillManager } from '../skill/manager.js';
import type { SessionInfo } from '../session/session.js';
import type { ModelOption } from './model-dialog.js';
import {
  App,
  formatContextEvent,
  formatContextWindowNotice,
  formatAgentMode,
  formatMemoryStatus,
  formatMcpStartupStatus,
  formatSkillStartupStatus,
  formatAgentStartupStatus,
  formatCcSwitchStartupStatus,
  formatAppleTerminalStabilityNotice,
  formatSubAgentEvent,
  formatSessionList,
  formatStatus,
  HELP_TEXT,
  } from './app.js';

function emptyAgentStream(): AsyncIterable<AgentEvent> {
  return (async function* emptyStream() {
    yield { type: 'stopped', reason: 'completed', iterations: 0, finalText: '' };
  })();
}

function createAppDependencies() {
  let clearCount = 0;
  let promptHistory: string[] = [];
  let agentStream: AsyncIterable<AgentEvent> = emptyAgentStream();
  let resumedMessages: Message[] = [];
  let snapshots: Snapshot[] = [];
  let sessionList: SessionInfo[] = [];
  let deletedSessionIds: string[] = [];
  let rewindResult: {
    snapshot: Snapshot;
    changedFiles: string[];
    history: Message[];
  } | undefined;
  const unsubscribe = () => undefined;
  let permissionMode: 'strict' | 'default' | 'allow' = 'default';
  const chatManager = {
    getPermissionStatus: () => ({
      mode: permissionMode,
      ruleCounts: { user: 0, project: 0, local: 0, session: 0 },
      diagnostics: [],
    }),
    setPermissionMode: (mode: 'strict' | 'default' | 'allow') => {
      permissionMode = mode;
    },
    getPromptHistory: () => [...promptHistory],
    listSessions: () => [...sessionList],
    deleteSession: (sessionId: string) => {
      if (sessionId === 'session-12345678') throw new Error('不能删除当前会话');
      if (!sessionList.some(item => item.id === sessionId)) throw new Error(`会话不存在: ${sessionId}`);
      deletedSessionIds = [...deletedSessionIds, sessionId];
      sessionList = sessionList.filter(item => item.id !== sessionId);
      return true;
    },
    getSnapshots: () => snapshots,
    subscribeMemorySaved: () => unsubscribe,
    subscribeSubAgent: () => unsubscribe,
    subscribeTeam: () => unsubscribe,
    listSubAgentTasks: () => [],
    getTeamStatus: () => ({ active: false }),
    getSessionId: () => 'session-12345678',
    getContextUsage: () => ({
      providerName: 'deepseek',
      model: 'deepseek-chat',
      contextWindow: 128_000,
      systemPromptTokens: 2_000,
      systemToolsTokens: 8_000,
      mcpToolsTokens: 0,
      skillsTokens: 0,
      messagesTokens: 10_000,
      systemToolCount: 6,
      mcpToolCount: 0,
      systemToolEntries: [],
      mcpToolEntries: [],
      skillEntries: [],
      messageCount: 0,
      usedTokens: 20_000,
    }),
    getMemoryStatus: () => ({
      userDirectory: '/home/.bettercode/memory',
      projectDirectory: '/repo/.bettercode/memory',
      userCount: 0,
      projectCount: 0,
    }),
    getMemoryGovernanceStatus: () => ({
      runCount: 0,
      indexOverflow: { overflow: false, droppedNames: [] },
    }),
    recordPrompt: (input: string) => {
      promptHistory = [...promptHistory, input];
    },
    clear: async () => {
      clearCount += 1;
      promptHistory = [];
    },
    run: () => agentStream,
    resumeSession: async () => resumedMessages,
    rewind: () => {
      if (!rewindResult) throw new Error('未配置回滚结果');
      return rewindResult;
    },
    hasForegroundSubAgent: () => false,
  } as unknown as ChatManager;
  const skillManager = {
    getSnapshot: () => ({
      revision: 0,
      skills: new Map(),
      disabledNames: new Set(),
      diagnostics: [],
      dedicatedToolNames: new Set(),
    }),
    list: () => [],
    subscribe: () => unsubscribe,
    getActiveNames: () => [],
  } as unknown as SkillManager;
  const provider: LLMProvider = {
    name: 'deepseek',
    model: 'deepseek-chat',
    contextWindow: 128_000,
    contextWindowIsDefault: false,
    async chat() {},
  };
  const providers: ModelOption[] = [
    { name: 'deepseek', model: 'deepseek-chat', base_url: 'https://api.deepseek.com' },
    { name: 'flash', model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com' },
  ];
  let switchProviderCalls: string[] = [];
  let switchTierCalls: string[] = [];
  const switchProvider = (name: string): LLMProvider => {
    switchProviderCalls = [...switchProviderCalls, name];
    const option = providers.find(item => item.name === name) ?? providers[0];
    return {
      name: option.name,
      model: option.model,
      contextWindow: 128_000,
      contextWindowIsDefault: false,
      async chat() {},
    };
  };
  const switchModelTier = (tier: string): LLMProvider => {
    switchTierCalls = [...switchTierCalls, tier];
    const option = providers.find(item => item.name === 'deepseek') ?? providers[0];
    const tierConfig = option.model_tiers?.[tier as keyof NonNullable<ModelOption['model_tiers']>];
    const model = tierConfig?.model ?? option.model;
    const contextWindow = tierConfig?.context_window ?? 128_000;
    return {
      name: option.name,
      model,
      contextWindow,
      contextWindowIsDefault: tierConfig?.context_window === undefined,
      async chat() {},
    };
  };
  return {
    chatManager,
    skillManager,
    provider,
    providers,
    switchProvider,
    switchModelTier,
    getClearCount: () => clearCount,
    getSwitchProviderCalls: () => switchProviderCalls,
    getSwitchTierCalls: () => switchTierCalls,
    setAgentStream: (stream: AsyncIterable<AgentEvent>) => {
      agentStream = stream;
    },
    setResumedMessages: (messages: Message[]) => {
      resumedMessages = messages;
    },
    setSessionList: (value: SessionInfo[]) => {
      sessionList = value;
    },
    getDeletedSessionIds: () => deletedSessionIds,
    setSnapshots: (value: Snapshot[]) => {
      snapshots = value;
    },
    setRewindResult: (value: { snapshot: Snapshot; changedFiles: string[]; history: Message[] }) => {
      rewindResult = value;
    },
  };
}

async function flushAppInput(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function waitForFrame(
  view: ReturnType<typeof render>,
  pattern: RegExp,
  timeoutMs = 400,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const frame = view.lastFrame() ?? '';
    if (pattern.test(frame)) return;
    if (Date.now() >= deadline) {
      assert.match(frame, pattern);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('MCP 启动状态成功或未配置时不增加聊天消息', () => {
  assert.equal(formatMcpStartupStatus({
    configuredServers: 0,
    connectedServers: 0,
    registeredTools: 0,
    diagnostics: [],
  }), undefined);
  assert.equal(formatMcpStartupStatus({
    configuredServers: 2,
    connectedServers: 2,
    registeredTools: 5,
    diagnostics: [],
  }), undefined);
});

test('Skill 启动诊断只展示名称和清晰错误', () => {
  assert.equal(formatSkillStartupStatus([]), undefined);
  const status = formatSkillStartupStatus([{
    scope: 'project',
    file: '/repo/.bettercode/skills/broken.md',
    name: 'broken',
    code: 'INVALID_SKILL',
    message: 'mode 必须是 shared 或 isolated',
  }]);
  assert.match(status ?? '', /跳过 1 个/u);
  assert.match(status ?? '', /broken.*mode/u);
  assert.doesNotMatch(status ?? '', /\.bettercode\/skills/u);
});

test('帮助文本和上下文事件提供简洁可行动信息', () => {
  assert.match(HELP_TEXT, /\/compact/);
  assert.match(HELP_TEXT, /\/session/);
  assert.match(HELP_TEXT, /\/memory/);
  assert.match(HELP_TEXT, /\/permission/);
  assert.match(HELP_TEXT, /\/status/);
  assert.doesNotMatch(HELP_TEXT, /\/review/u);
  assert.doesNotMatch(HELP_TEXT, /\/resume|\/rewind|\/exit/u);
  assert.equal(formatContextEvent({
    type: 'context_compacted',
    iteration: 0,
    trigger: 'manual',
    beforeTokens: 12_000,
    afterTokens: 4_000,
    summarizedMessages: 8,
    offloadedResults: 2,
    consecutiveFailures: 0,
    circuitOpen: false,
  }), '上下文已压缩：约 12000 -> 4000 Token，摘要覆盖 8 条消息，落盘 2 个工具结果，熔断未开启');
  assert.equal(formatContextEvent({
    type: 'context_progress',
    iteration: 1,
    trigger: 'automatic',
    stage: 'estimating',
    estimatedTokens: 5_000,
    contextWindow: 128_000,
  }), '正在估算上下文用量，当前约 5000 Token');
});

test('模式标记和综合状态包含命令需要的运行信息', () => {
  assert.equal(formatAgentMode('act'), '[DEFAULT]');
  assert.equal(formatAgentMode('plan'), '[PLAN]');
  const status = formatStatus({
    provider: { name: 'deepseek', model: 'deepseek-chat' },
    agentMode: 'plan',
    permissionMode: 'default',
    sessionId: 'abc-12345678',
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    memory: {
      userDirectory: '/home/.bettercode/memory',
      projectDirectory: '/repo/.bettercode/memory',
      userCount: 2,
      projectCount: 3,
    },
    activeSkills: ['commit'],
  });
  assert.match(status, /deepseek \(deepseek-chat\)/u);
  assert.match(status, /\[PLAN\]/u);
  assert.match(status, /default/u);
  assert.match(status, /abc-12345678/u);
  assert.match(status, /Token: 15/u);
  assert.match(status, /用户级 2 条 \/ 项目级 3 条/u);
  assert.match(status, /已激活 Skill: commit/u);
});

test('会话列表与记忆状态使用可执行的命令提示', () => {
  assert.equal(formatSessionList([]), '没有可恢复的历史会话。');
  assert.match(formatSessionList([{
    id: 'abc-12345678',
    summary: '修复解析器',
    messageCount: 4,
    size: 100,
    modTime: new Date(),
  }]), /abc-12345678 \(4 条\) - 修复解析器/);
  assert.match(formatMemoryStatus({
    userDirectory: '/home/.bettercode/memory',
    projectDirectory: '/repo/.bettercode/memory',
    userCount: 2,
    projectCount: 3,
  }), /用户级 2 条 \/ 项目级 3 条/);
});

test('只有默认上下文窗口会显示一次配置提示', () => {
  const base = {
    name: 'fake',
    model: 'model',
    contextWindow: 128_000,
    async chat() {},
  };
  assert.match(formatContextWindowNotice({
    ...base,
    contextWindowIsDefault: true,
  }) ?? '', /未配置 context_window.*128000/);
  assert.equal(formatContextWindowNotice({
    ...base,
    contextWindowIsDefault: false,
  }), undefined);
});

test('Apple Terminal 稳定性提示只在该终端展示', () => {
  assert.equal(formatAppleTerminalStabilityNotice(false), undefined);
  assert.match(formatAppleTerminalStabilityNotice(true) ?? '', /iTerm2|VS Code 终端|Warp/u);
});

test('Apple Terminal 下启动出现终端稳定性提示', async () => {
  const previous = process.env.TERM_PROGRAM;
  process.env.TERM_PROGRAM = 'Apple_Terminal';
  try {
    const dependencies = createAppDependencies();
    const view = render(React.createElement(App, dependencies));
    await flushAppInput();
    const frame = view.lastFrame() ?? '';
    assert.match(frame, /终端稳定性提示/u);
    assert.match(frame, /AppKit 菜单更新崩溃风险/u);
    view.unmount();
  } finally {
    if (previous === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = previous;
  }
});

test('子 Agent 诊断与后台事件只展示必要通知', () => {
  assert.equal(formatAgentStartupStatus([]), undefined);
  assert.match(formatAgentStartupStatus([{
    scope: 'project', file: '/repo/.bettercode/agents/bad.md', name: 'bad',
    code: 'INVALID_DEFINITION', message: '定义损坏',
  }]) ?? '', /bad.*定义损坏/);
  const base = {
    id: 'sa-1', kind: 'defined' as const, role: 'general', task: '检查', origin: 'tool' as const,
    sessionId: 's1', executionMode: 'background' as const, backgroundReason: 'manual' as const,
    state: 'running' as const, createdAt: '', iterations: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  };
  assert.match(formatSubAgentEvent({ type: 'task_backgrounded', task: base, reason: 'manual' }) ?? '', /sa-1.*manual/);
  assert.equal(formatSubAgentEvent({ type: 'task_started', task: { ...base, executionMode: 'foreground' } }), undefined);
  assert.match(formatSubAgentEvent({
    type: 'task_finished', task: { ...base, state: 'completed', stopReason: 'completed', result: '完成' },
  }) ?? '', /已完成.*sa-1/);
});

test('MCP 启动状态只展示脱敏诊断字段和准确安全边界', () => {
  const message = formatMcpStartupStatus({
    configuredServers: 2,
    connectedServers: 1,
    registeredTools: 3,
    diagnostics: [{
      code: 'TRANSPORT_ERROR',
      serverName: 'broken',
      message: '连接失败: [REDACTED]',
    }],
  });

  assert.match(message ?? '', /已连接 1\/2 个 Server，注册 3 个工具/);
  assert.match(message ?? '', /broken: 连接失败: \[REDACTED\]/);
  assert.match(message ?? '', /外部 MCP Server 不受 BetterCode 文件沙箱或危险命令黑名单强制保护/);
});

test('cc-switch 启动状态按来源展示诊断且空诊断不展示', () => {
  const message = formatCcSwitchStartupStatus([
    { line: 'claude', severity: 'warning', message: '缺少 ANTHROPIC_MODEL，跳过导入' },
    { line: 'config', severity: 'info', message: 'settings.json 未找到' },
  ]);
  assert.match(message ?? '', /cc-switch 导入/u);
  assert.match(message ?? '', /claude: 缺少 ANTHROPIC_MODEL/u);
  assert.match(message ?? '', /config: settings\.json 未找到/u);
  assert.equal(formatCcSwitchStartupStatus([]), undefined);
});

test('cc-switch 启动诊断渲染为启动提示', async () => {
  const dependencies = createAppDependencies();
  const view = render(React.createElement(App, {
    ...dependencies,
    ccSwitchStatus: [
      { line: 'claude', severity: 'warning', message: '缺少 ANTHROPIC_MODEL，跳过导入' },
    ],
  }));
  await flushAppInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /cc-switch 诊断/u);
  assert.match(frame, /缺少 ANTHROPIC_MODEL/u);
  view.unmount();
});

test('主布局保持单一品牌和干净输入区，命令使用结构化展示', async () => {
  const dependencies = createAppDependencies();
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();

  const startupFrame = view.lastFrame() ?? '';
  assert.equal(startupFrame.match(/BetterCode Agent v0\.1\.0/gu)?.length, 1);
  assert.doesNotMatch(startupFrame, /M deepseek\/deepseek-chat/u);
  assert.doesNotMatch(startupFrame, /MD DEFAULT/u);
  assert.doesNotMatch(startupFrame, /PM DEFAULT/u);
  assert.doesNotMatch(startupFrame, /SESSION/u);

  view.stdin.write('/help');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /\[HELP\] 命令目录/u);

  view.stdin.write('/clear');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  const clearedFrame = view.lastFrame() ?? '';
  assert.equal(dependencies.getClearCount(), 1);
  assert.doesNotMatch(clearedFrame, /\[HELP\] 命令目录/u);
  assert.equal(clearedFrame.match(/BetterCode Agent v0\.1\.0/gu)?.length, 1);
  assert.doesNotMatch(clearedFrame, /M deepseek\/deepseek-chat/u);
  assert.doesNotMatch(clearedFrame, /MD DEFAULT/u);
  assert.doesNotMatch(clearedFrame, /PM DEFAULT/u);
  assert.doesNotMatch(clearedFrame, /SESSION/u);
  view.unmount();
});

test('流式期间保持纯文本，流结束后最终回复渲染 Markdown', async () => {
  let releaseStream = () => {};
  const dependencies = createAppDependencies();
  dependencies.setAgentStream((async function* controlledStream() {
    yield { type: 'text_delta', iteration: 0, content: '[链接](https://example.com)' };
    await new Promise<void>(resolve => {
      releaseStream = resolve;
    });
    yield {
      type: 'stopped',
      reason: 'completed',
      iterations: 0,
      finalText: '# 标题\n\n[链接](https://example.com)\n\n- 项目',
    };
  })());

  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdin.write('你好');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();

  await waitForFrame(view, /\[链接\]\(https:\/\/example\.com\)/u);
  const streamingFrame = view.lastFrame() ?? '';
  assert.doesNotMatch(streamingFrame, /链接 \(https:\/\/example\.com\)/u);

  releaseStream();
  await flushAppInput();
  await flushAppInput();
  const finalFrame = view.lastFrame() ?? '';
  assert.match(finalFrame, /标题/u);
  assert.doesNotMatch(finalFrame, /# 标题/u);
  assert.match(finalFrame, /链接 \(https:\/\/example\.com\)/u);
  assert.match(finalFrame, /- 项目/u);
  assert.doesNotMatch(finalFrame, /\[链接\]\(https:\/\/example\.com\)/u);
  view.unmount();
});

test('Markdown 解析失败时保留原文并显示受控提示', async () => {
  let parseCalls = 0;
  const brokenText = {
    toString() {
      parseCalls += 1;
      if (parseCalls === 1) throw new Error('解析失败');
      return '# 标题';
    },
  } as unknown as string;
  const dependencies = createAppDependencies();
  dependencies.setAgentStream((async function* brokenStream() {
    yield { type: 'stopped', reason: 'completed', iterations: 0, finalText: brokenText };
  })());

  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdin.write('任务');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();

  const frame = view.lastFrame() ?? '';
  assert.match(frame, /Markdown 解析失败/u);
  assert.match(frame, /# 标题/u);
  view.unmount();
});

test('恢复会话时助手消息渲染 Markdown，用户消息保持纯文本', async () => {
  const dependencies = createAppDependencies();
  dependencies.setResumedMessages([
    { role: 'user', content: '[链接](https://example.com)' },
    { role: 'assistant', content: '# 标题\n\n[链接](https://example.com)' },
  ]);
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdin.write('/session abc-12345678');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();

  const frame = view.lastFrame() ?? '';
  assert.match(frame, /标题/u);
  assert.doesNotMatch(frame, /# 标题/u);
  assert.match(frame, /链接 \(https:\/\/example\.com\)/u);
  assert.match(frame, /\[链接\]\(https:\/\/example\.com\)/u);
  assert.match(frame, /会话已恢复/u);
  view.unmount();
});

test('/session 打开交互选择器，方向键选择并恢复选中会话', async () => {
  const dependencies = createAppDependencies();
  dependencies.setSessionList([
    { id: 'aaa-11111111', summary: '修复解析器', messageCount: 4, size: 100, modTime: new Date('2026-08-03T10:00:00Z') },
    { id: 'bbb-22222222', summary: '优化 UI 面板', messageCount: 8, size: 200, modTime: new Date('2026-08-04T10:00:00Z') },
  ]);
  dependencies.setResumedMessages([
    { role: 'user', content: '优化 UI 面板' },
    { role: 'assistant', content: '已完成' },
  ]);
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdin.write('/session');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();

  let frame = view.lastFrame() ?? '';
  assert.match(frame, /历史会话/u);
  assert.match(frame, /修复解析器/u);
  assert.match(frame, /优化 UI 面板/u);
  assert.doesNotMatch(frame, /首条任务/u);

  view.stdin.write('\u001B[B');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  frame = view.lastFrame() ?? '';
  assert.match(frame, /会话已恢复/u);
  assert.match(frame, /优化 UI 面板/u);
  view.unmount();
});

test('/session 选择器 Esc 退出，Delete 删除非当前会话并刷新列表', async () => {
  const dependencies = createAppDependencies();
  dependencies.setSessionList([
    { id: 'aaa-11111111', summary: '修复解析器', messageCount: 4, size: 100, modTime: new Date('2026-08-03T10:00:00Z') },
    { id: 'bbb-22222222', summary: '优化 UI 面板', messageCount: 8, size: 200, modTime: new Date('2026-08-04T10:00:00Z') },
  ]);
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdin.write('/session');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /历史会话/u);

  view.stdin.write('\u001B[B');
  await flushAppInput();
  view.stdin.write('\u007F');
  await flushAppInput();
  await flushAppInput();
  let frame = view.lastFrame() ?? '';
  assert.match(frame, /会话已删除/u);
  assert.doesNotMatch(frame, /优化 UI 面板/u);
  assert.deepEqual(dependencies.getDeletedSessionIds(), ['bbb-22222222']);

  view.stdin.write('\u001B');
  await flushAppInput();
  await flushAppInput();
  frame = view.lastFrame() ?? '';
  assert.doesNotMatch(frame, /历史会话/u);
  assert.match(frame, /❯ |> /u);
  view.unmount();
});

test('/session 选择器拒绝删除当前会话', async () => {
  const dependencies = createAppDependencies();
  dependencies.setSessionList([
    { id: 'session-12345678', summary: '当前会话', messageCount: 2, size: 50, modTime: new Date('2026-08-04T10:00:00Z') },
  ]);
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdin.write('/session');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /\[当前\]/u);

  view.stdin.write('\u007F');
  await flushAppInput();
  await flushAppInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /不能删除当前会话/u);
  assert.match(frame, /历史会话/u);
  view.unmount();
});

test('/model 打开交互选择器，方向键选择并切换 Provider', async () => {
  const dependencies = createAppDependencies();
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdin.write('/model');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();

  let frame = view.lastFrame() ?? '';
  assert.match(frame, /\[MODEL\] 切换模型/u);
  assert.match(frame, /deepseek-chat/u);
  assert.match(frame, /\[当前\]/u);
  assert.match(frame, /deepseek-v4-flash/u);

  view.stdin.write('\u001B[B');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  frame = view.lastFrame() ?? '';
  assert.match(frame, /模型已切换/u);
  assert.match(frame, /flash/u);
  assert.deepEqual(dependencies.getSwitchProviderCalls(), ['flash']);

  view.stdin.write('/status');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  frame = view.lastFrame() ?? '';
  assert.match(frame, /Provider: flash/u);
  assert.match(frame, /模型: deepseek-v4-flash/u);
  view.unmount();
});

test('/model 只有一个 Provider 时提示而不是打开面板', async () => {
  const dependencies = createAppDependencies();
  const view = render(React.createElement(App, {
    ...dependencies,
    providers: [dependencies.providers[0]],
  }));
  await flushAppInput();
  view.stdin.write('/model');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();

  const frame = view.lastFrame() ?? '';
  assert.match(frame, /无法切换/u);
  assert.match(frame, /只有一个 Provider/u);
  assert.doesNotMatch(frame, /\[MODEL\] 切换模型/u);
  view.unmount();
});

test('/context 渲染上下文占用视图', async () => {
  const dependencies = createAppDependencies();
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdin.write('/context');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();

  const frame = view.lastFrame() ?? '';
  assert.match(frame, /\[CONTEXT\] 上下文使用/u);
  assert.match(frame, /deepseek-chat\[128k\]/u);
  assert.match(frame, /System prompt/u);
  assert.match(frame, /Free space/u);
  view.unmount();
});

test('/model 对 cc-switch Provider 展示档位模型并可切换', async () => {
  const dependencies = createAppDependencies();
  const provider: LLMProvider = {
    name: 'PackyCode-Deepseek',
    model: 'deepseek-v4-flash',
    contextWindow: 1_000_000,
    contextWindowIsDefault: false,
    async chat() {},
  };
  const providers: ModelOption[] = [{
    name: 'PackyCode-Deepseek',
    model: 'deepseek-v4-flash',
    base_url: 'https://www.packyapi.ai',
    active_tier: 'sonnet',
    model_tiers: {
      sonnet: { model: 'deepseek-v4-flash', context_window: 1_000_000 },
      opus: { model: 'deepseek-v4-flash', context_window: 1_000_000 },
      fable: { model: 'deepseek-v4-flash', context_window: 1_000_000 },
      haiku: { model: 'deepseek-v4-flash' },
    },
  }];
  const view = render(React.createElement(App, {
    ...dependencies,
    provider,
    providers,
  }));
  await flushAppInput();
  // 状态行默认开启会显示“权限 default”，先关闭再验证档位面板本身不含 default 标记
  view.stdin.write('/statusline');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  view.stdin.write('/model');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();

  let frame = view.lastFrame() ?? '';
  assert.match(frame, /\[MODEL\] 切换模型/u);
  assert.match(frame, /Sonnet/u);
  assert.match(frame, /Opus/u);
  assert.match(frame, /Fable/u);
  assert.match(frame, /Haiku/u);
  assert.match(frame, /deepseek-v4-flash/u);
  assert.match(frame, /1M/u);
  assert.match(frame, /\[当前\]/u);
  assert.doesNotMatch(frame, /PackyCode-CC/u);
  assert.doesNotMatch(frame, /default/u);

  view.stdin.write('\u001B[B');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  frame = view.lastFrame() ?? '';
  assert.match(frame, /模型已切换/u);
  assert.deepEqual(dependencies.getSwitchTierCalls(), ['opus']);
  view.unmount();
});

test('回滚恢复的助手消息渲染 Markdown', async () => {
  const dependencies = createAppDependencies();
  const snapshot: Snapshot = {
    messageIndex: 1,
    userText: '第一次修改',
    backups: {},
    timestamp: '2026-08-02T08:00:00.000Z',
  };
  dependencies.setSnapshots([snapshot]);
  dependencies.setRewindResult({
    snapshot,
    changedFiles: [],
    history: [
      { role: 'user', content: '任务' },
      { role: 'assistant', content: '# 标题\n\n[链接](https://example.com)' },
    ],
  });
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdin.write('/rewind');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /选择回滚检查点/u);
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /选择恢复范围/u);
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();

  const frame = view.lastFrame() ?? '';
  assert.match(frame, /标题/u);
  assert.doesNotMatch(frame, /# 标题/u);
  assert.match(frame, /链接 \(https:\/\/example\.com\)/u);
  assert.match(frame, /已回滚到/u);
  view.unmount();
});

test('工具调用轨迹折叠保留，空 Enter 展开收起', async () => {
  const dependencies = createAppDependencies();
  dependencies.setAgentStream((async function* toolStream() {
    yield { type: 'tool_call', iteration: 0, call: { id: 'r1', name: 'read_file', arguments: { path: 'src/a.ts' } } };
    yield {
      type: 'tool_result',
      iteration: 0,
      call: { id: 'r1', name: 'read_file', arguments: { path: 'src/a.ts' } },
      result: { ok: true, output: '文件内容', metadata: {} },
    };
    yield { type: 'tool_call', iteration: 1, call: { id: 'r2', name: 'run_command', arguments: { command: 'pnpm test' } } };
    yield {
      type: 'tool_result',
      iteration: 1,
      call: { id: 'r2', name: 'run_command', arguments: { command: 'pnpm test' } },
      result: { ok: false, output: '', metadata: {}, error: { code: 'EXECUTION_ERROR', message: '失败' } },
    };
    yield { type: 'stopped', reason: 'completed', iterations: 2, finalText: '' };
  })());

  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdin.write('分析一下');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();

  await waitForFrame(view, /▶ 工具调用 × 2/u);
  const folded = view.lastFrame() ?? '';
  assert.doesNotMatch(folded, /read_file/u, '折叠时不显示工具明细');

  // 输入为空按 Enter 展开
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  await waitForFrame(view, /read_file/u);
  assert.match(view.lastFrame() ?? '', /run_command/u);

  // 再按一次 Enter 收起
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  await waitForFrame(view, /▶ 工具调用 × 2/u);
  assert.doesNotMatch(view.lastFrame() ?? '', /read_file/u);
  view.unmount();
});

test('/statusline 默认开启并可切换关闭', async () => {
  const dependencies = createAppDependencies();
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /deepseek\/deepseek-chat · \[DEFAULT\]/u, '默认显示状态行');
  assert.match(view.lastFrame() ?? '', /上下文 20k\/128k/u, '状态行显示真实上下文占用与窗口容量');
  assert.match(view.lastFrame() ?? '', /会话 session-12345678/u);

  // /plan 切换后状态行模式实时更新为 [PLAN]
  view.stdin.write('/plan');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /\[PLAN\]/u);

  // /do 恢复执行模式
  view.stdin.write('/do');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /\[DEFAULT\]/u);

  // /statusline 关闭后不再显示
  view.stdin.write('/statusline');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  assert.doesNotMatch(view.lastFrame() ?? '', /deepseek\/deepseek-chat · \[DEFAULT\]/u, '关闭后隐藏状态行');

  // 再切换恢复显示
  view.stdin.write('/statusline');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /deepseek\/deepseek-chat/u);
  view.unmount();
});

test('流式期间状态行常驻并展示上下文真实占用', async () => {
  let releaseStream = () => {};
  const dependencies = createAppDependencies();
  dependencies.setAgentStream((async function* streamingWithUsage(): AsyncGenerator<AgentEvent> {
    yield { type: 'progress', iteration: 0, stage: 'requesting_model' };
    yield { type: 'usage', iteration: 0, current: { totalTokens: 1500, inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, cumulative: { totalTokens: 1500, inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } };
    await new Promise<void>(resolve => {
      releaseStream = resolve;
    });
    yield { type: 'stopped', reason: 'completed', iterations: 0, finalText: '' };
  })());

  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdin.write('你好');
  await flushAppInput();
  view.stdin.write('\r');
  await flushAppInput();
  await flushAppInput();

  // 流式期间状态行常驻，展示当前上下文的真实估算占用与窗口容量
  assert.match(view.lastFrame() ?? '', /上下文 20k\/128k/u);
  assert.match(view.lastFrame() ?? '', /deepseek\/deepseek-chat/u);

  releaseStream();
  await flushAppInput();
  await flushAppInput();
  // 结束后状态行继续显示上下文占用
  assert.match(view.lastFrame() ?? '', /上下文 20k\/128k/u);
  view.unmount();
});

test('终端 resize 事件触发重渲染不崩溃', async () => {
  const dependencies = createAppDependencies();
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  view.stdout.emit('resize');
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /BetterCode Agent v0\.1\.0/u);
  view.stdout.emit('resize');
  await flushAppInput();
  view.unmount();
});

test('Shift+Tab 循环切换权限模式并实时刷新状态行', async () => {
  const dependencies = createAppDependencies();
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();
  // 初始 default
  assert.match(view.lastFrame() ?? '', /权限 default/u);

  // Shift+Tab → allow
  view.stdin.write('\u001B[Z');
  await flushAppInput();
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /权限 allow/u);

  // → strict
  view.stdin.write('\u001B[Z');
  await flushAppInput();
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /权限 strict/u);

  // → default（循环回起点）
  view.stdin.write('\u001B[Z');
  await flushAppInput();
  await flushAppInput();
  assert.match(view.lastFrame() ?? '', /权限 default/u);
  view.unmount();
});
