import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { detectTerminalCapabilities, displayWidth } from './capabilities.js';
import { InputBox } from './input-box.js';
import { StartupBrand } from './mascot.js';
import { StatusBar } from './status-bar.js';

function assertFrameWidth(frame: string, columns: number): void {
  for (const line of frame.split('\n')) {
    assert.equal(displayWidth(line) <= columns, true, `渲染行超过 ${columns} 列: ${line}`);
  }
}

test('受控终端帧可注入宽度和降级环境并安全卸载', () => {
  const capabilities = detectTerminalCapabilities({
    columns: 55,
    isTTY: true,
    noColor: true,
    forceAscii: true,
    reduceMotion: true,
  });
  const view = render(React.createElement(Box, { flexDirection: 'column' },
    React.createElement(StartupBrand, { capabilities, version: '0.1.0' }),
    React.createElement(InputBox, {
      capabilities,
      disabled: false,
      onSubmit: () => undefined,
    }),
    React.createElement(StatusBar, {
      capabilities,
      state: {
        providerName: 'deepseek',
        model: '中文模型-with-a-long-name',
        agentMode: 'plan',
        permissionMode: 'strict',
        sessionId: 'session-12345678',
        activeSkills: [],
        backgroundTasks: 0,
      },
    }),
  ));
  const frame = view.lastFrame() ?? '';
  assertFrameWidth(frame, 55);
  assert.doesNotMatch(frame, /[╭╰─❯●◇◆▲]/u);
  assert.match(frame, /M deepseek/u);
  assert.match(frame, /MD PLAN/u);
  assert.match(frame, /PM STRICT/u);
  view.unmount();
});
