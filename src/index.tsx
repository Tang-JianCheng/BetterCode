import React from 'react';
import { render } from 'ink';
import { App } from './ui/app.js';
import { createApplication, parseApplicationArguments } from './bootstrap/application.js';

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
