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
import { loadInstructions } from './memory/instructions.js';
import { MemoryManager } from './memory/manager.js';
import { SkillManager } from './skill/manager.js';
import { SkillRunner } from './skill/runner.js';
import { createDefaultCommandRegistry } from './command/builtins.js';
import type { LLMProvider } from './provider/types.js';
import { HookConfigLoader } from './hook/config-loader.js';
import { compileHooks } from './hook/compiler.js';
import { DefaultHookActionExecutor } from './hook/action-executor.js';
import { JsonlHookLogger } from './hook/logger.js';
import { HookManager } from './hook/manager.js';

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
  let chatManager: ChatManager | undefined;
  let skillManager: SkillManager | undefined;
  let hookManager: HookManager | undefined;
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
    const providerCache = new Map<string, LLMProvider>([[selectedConfig.name, provider]]);
    const providerResolver = {
      has: (name: string) => appConfig.providers.some(item => item.name === name),
      resolve: (name: string) => {
        const cached = providerCache.get(name);
        if (cached) return cached;
        const config = appConfig.providers.find(item => item.name === name);
        if (!config) throw new Error(`未找到 Skill 指定的 Provider 配置: ${name}`);
        const created = createProvider(config);
        providerCache.set(name, created);
        return created;
      },
    };

    // 5. 创建内置工具并发现 MCP 工具
    const rootDir = process.cwd();
    const toolRegistry = createCoreToolRegistry(rootDir);
    mcpManager = createMcpManager(rootDir);
    const mcpStatus = await mcpManager.initialize(toolRegistry);

    // 6. 发现 Skill 并注册按需工具
    const commandTokens = createDefaultCommandRegistry()
      .list({ includeHidden: true })
      .flatMap(command => [command.name, ...command.aliases]);
    skillManager = new SkillManager(toolRegistry, rootDir, {
      providerNames: appConfig.providers.map(item => item.name),
      reservedCommandNames: commandTokens,
    });
    skillManager.initialize();
    skillManager.startWatching();

    // 7. 基于完整工具列表创建权限与 Hook 运行时
    const permissionManager = createPermissionManager(toolRegistry, permissionMode);
    const loadedHooks = new HookConfigLoader(rootDir).load();
    const compiledHooks = compileHooks(loadedHooks);
    hookManager = new HookManager(
      rootDir,
      compiledHooks,
      new DefaultHookActionExecutor(rootDir),
      new JsonlHookLogger(rootDir, loadedHooks.secretValues),
    );
    const customInstructions = loadInstructions(rootDir);
    const longTermMemory = new MemoryManager(rootDir).buildSystemReminder();
    const supplemental = { customInstructions, longTermMemory };
    const skillRunner = new SkillRunner(
      toolRegistry,
      permissionManager,
      skillManager,
      providerResolver,
      { supplemental, hooks: hookManager },
    );
    chatManager = new ChatManager(
      toolRegistry,
      permissionManager,
      {},
      supplemental,
      {},
      { autoExtract: true },
      { manager: skillManager, runner: skillRunner },
      hookManager,
    );

    await hookManager.startSystem(chatManager.getSessionId(), 'startup');
    await hookManager.startSession(chatManager.getSessionId(), 'startup');

    // 8. 启动 TUI
    const { waitUntilExit } = render(
      React.createElement(App, { provider, chatManager, skillManager, mcpStatus }),
      { exitOnCtrlC: false },
    );

    await waitUntilExit();
  } catch (err) {
    console.error(`\n❌ 启动失败: ${(err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    try {
      await chatManager?.close();
    } catch (error) {
      console.error(`[上下文清理] ${error instanceof Error ? error.message : String(error)}`);
    }
    await hookManager?.close();
    await skillManager?.close();
    const diagnostics = await mcpManager?.close() ?? [];
    for (const diagnostic of diagnostics) {
      const source = diagnostic.serverName ? ` ${diagnostic.serverName}` : '';
      console.error(`[MCP${source}] ${diagnostic.message}`);
    }
  }
}

main();
