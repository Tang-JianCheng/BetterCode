import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import type { AgentEvent } from '../agent/types.js';
import type { ChatManager } from '../chat/manager.js';
import type { Snapshot } from '../filehistory/filehistory.js';
import type { LLMProvider, Message } from '../provider/types.js';
import type { SkillManager } from '../skill/manager.js';
import {
  App,
  formatContextEvent,
  formatContextWindowNotice,
  formatAgentMode,
  formatMemoryStatus,
  formatMcpStartupStatus,
  formatSkillStartupStatus,
  formatAgentStartupStatus,
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
  let rewindResult: {
    snapshot: Snapshot;
    changedFiles: string[];
    history: Message[];
  } | undefined;
  const unsubscribe = () => undefined;
  const chatManager = {
    getPermissionStatus: () => ({
      mode: 'default',
      ruleCounts: { user: 0, project: 0, local: 0, session: 0 },
      diagnostics: [],
    }),
    getPromptHistory: () => [...promptHistory],
    getSnapshots: () => snapshots,
    subscribeMemorySaved: () => unsubscribe,
    subscribeSubAgent: () => unsubscribe,
    subscribeTeam: () => unsubscribe,
    listSubAgentTasks: () => [],
    getTeamStatus: () => ({ active: false }),
    getSessionId: () => 'session-12345678',
    getMemoryStatus: () => ({
      userDirectory: '/home/.bettercode/memory',
      projectDirectory: '/repo/.bettercode/memory',
      userCount: 0,
      projectCount: 0,
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
  return {
    chatManager,
    skillManager,
    provider,
    getClearCount: () => clearCount,
    setAgentStream: (stream: AsyncIterable<AgentEvent>) => {
      agentStream = stream;
    },
    setResumedMessages: (messages: Message[]) => {
      resumedMessages = messages;
    },
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
    firstMessage: '修复解析器',
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

test('主布局保持单一品牌和核心底栏，命令使用结构化展示', async () => {
  const dependencies = createAppDependencies();
  const view = render(React.createElement(App, dependencies));
  await flushAppInput();

  const startupFrame = view.lastFrame() ?? '';
  assert.equal(startupFrame.match(/BetterCode v0\.1\.0/gu)?.length, 1);
  assert.match(startupFrame, /M deepseek\/deepseek-chat/u);
  assert.match(startupFrame, /MD DEFAULT/u);
  assert.match(startupFrame, /PM DEFAULT/u);

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
  assert.equal(clearedFrame.match(/BetterCode v0\.1\.0/gu)?.length, 1);
  assert.match(clearedFrame, /M deepseek\/deepseek-chat/u);
  assert.match(clearedFrame, /MD DEFAULT/u);
  assert.match(clearedFrame, /PM DEFAULT/u);
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

  const streamingFrame = view.lastFrame() ?? '';
  assert.match(streamingFrame, /\[链接\]\(https:\/\/example\.com\)/u);
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
