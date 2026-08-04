import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render } from 'ink';
import { App } from './ui/app.js';
import { createApplication, parseApplicationArguments } from './bootstrap/application.js';

function reportRuntimeError(kind: string, value: unknown): void {
  const detail = value instanceof Error
    ? `${value.message}\n${value.stack ?? ''}`
    : String(value);
  console.error(`\n[BetterCode] ${kind}: ${detail}\n`);
  try {
    const directory = path.join(process.cwd(), '.bettercode', 'logs');
    mkdirSync(directory, { recursive: true });
    appendFileSync(
      path.join(directory, 'runtime-errors.log'),
      `${new Date().toISOString()} [${kind}] ${detail.replace(/[\r\n]+/gu, ' ')}\n`,
      'utf8',
    );
  } catch {
    // 日志写入失败不影响进程退出。
  }
}

// 未处理的 Promise 拒绝默认会让 Node 直接崩溃退出；这里记录后继续运行，
// 避免终端里一次后台异步错误就把整个 Agent 会话关掉。
process.on('unhandledRejection', reason => {
  reportRuntimeError('未处理的 Promise 拒绝', reason);
});

process.on('uncaughtException', error => {
  reportRuntimeError('未捕获的异常', error);
  process.exit(1);
});

async function main(): Promise<void> {
  const arguments_ = parseApplicationArguments(process.argv.slice(2));
  const application = await createApplication(arguments_);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (application.workerHost) {
      await application.workerHost.start(controller.signal);
      return;
    }
    if (!application.chatManager) throw new Error('普通模式缺少 ChatManager');
    const { waitUntilExit } = render(
      React.createElement(App, {
        provider: application.provider,
        chatManager: application.chatManager,
        skillManager: application.skillManager,
        mcpStatus: application.mcpStatus,
        agentDiagnostics: application.agentDiagnostics,
      }),
      { exitOnCtrlC: false },
    );
    await waitUntilExit();
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    controller.abort();
    await application.close();
  }
}

main().catch(error => {
  console.error(`\n启动失败: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
