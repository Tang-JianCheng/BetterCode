import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMcpStartupStatus } from './app.js';

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
