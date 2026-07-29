import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatContextEvent,
  formatContextWindowNotice,
  formatMemoryStatus,
  formatMcpStartupStatus,
  formatSessionList,
  HELP_TEXT,
} from './app.js';

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

test('帮助文本和上下文事件提供简洁可行动信息', () => {
  assert.match(HELP_TEXT, /\/compact/);
  assert.match(HELP_TEXT, /\/resume/);
  assert.match(HELP_TEXT, /\/memory/);
  assert.match(HELP_TEXT, /\/rewind/);
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
