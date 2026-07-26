import { parseArgs } from 'node:util';
import React from 'react';
import { render } from 'ink';
import { loadConfig } from './config/loader.js';
import { resolveProvider } from './config/resolver.js';
import { createProvider } from './provider/factory.js';
import { createCoreToolRegistry } from './tool/factory.js';
import { ChatManager } from './chat/manager.js';
import { App } from './ui/app.js';
import { createPermissionManager } from './permission/factory.js';
import type { PermissionMode } from './permission/types.js';
import { createMcpManager } from './mcp/factory.js';
import type { McpManager } from './mcp/manager.js';

function isPermissionMode(value: string | undefined): value is PermissionMode {
  return value === 'strict' || value === 'default' || value === 'allow';
}

async function main() {
  // 1. 解析 CLI 参数
  const { values } = parseArgs({
    options: {
      provider: {
        type: 'string',
        short: 'p',
      },
      config: {
        type: 'string',
        short: 'c',
        default: './config.yaml',
      },
      'permission-mode': {
        type: 'string',
        default: 'default',
      },
    },
    allowPositionals: false,
  });

  let mcpManager: McpManager | undefined;
  try {
    const permissionMode = values['permission-mode'];
    if (!isPermissionMode(permissionMode)) {
      throw new Error('permission-mode 必须是 strict、default 或 allow');
    }

    // 2. 加载配置
    const configPath = values.config as string;
    const appConfig = loadConfig(configPath);

    // 3. 选出供应商
    const selectedConfig = await resolveProvider(
      appConfig,
      values.provider as string | undefined,
    );

    // 4. 创建 Provider 实例
    const provider = createProvider(selectedConfig);

    // 5. 创建内置工具并发现 MCP 工具
    const rootDir = process.cwd();
    const toolRegistry = createCoreToolRegistry(rootDir);
    mcpManager = createMcpManager(rootDir);
    const mcpStatus = await mcpManager.initialize(toolRegistry);

    // 6. 基于完整工具列表创建权限与对话管理器
    const permissionManager = createPermissionManager(toolRegistry, permissionMode);
    const chatManager = new ChatManager(toolRegistry, permissionManager);

    // 7. 启动 TUI
    const { waitUntilExit } = render(
      React.createElement(App, { provider, chatManager, mcpStatus }),
      { exitOnCtrlC: false },
    );

    await waitUntilExit();
  } catch (err) {
    console.error(`\n❌ 启动失败: ${(err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    const diagnostics = await mcpManager?.close() ?? [];
    for (const diagnostic of diagnostics) {
      const source = diagnostic.serverName ? ` ${diagnostic.serverName}` : '';
      console.error(`[MCP${source}] ${diagnostic.message}`);
    }
  }
}

main();
