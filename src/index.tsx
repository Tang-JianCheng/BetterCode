import { parseArgs } from 'node:util';
import React from 'react';
import { render } from 'ink';
import { loadConfig } from './config/loader.js';
import { resolveProvider } from './config/resolver.js';
import { createProvider } from './provider/factory.js';
import { createCoreToolRegistry } from './tool/factory.js';
import { ChatManager } from './chat/manager.js';
import { App } from './ui/app.js';

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
    },
    allowPositionals: false,
  });

  try {
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

    // 5. 创建对话管理器
    const toolRegistry = createCoreToolRegistry(process.cwd());
    const chatManager = new ChatManager(toolRegistry);

    // 6. 启动 TUI
    const { waitUntilExit } = render(
      React.createElement(App, { provider, chatManager }),
    );

    await waitUntilExit();
  } catch (err) {
    console.error(`\n❌ 启动失败: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

main();
