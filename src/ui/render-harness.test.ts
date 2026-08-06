import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { detectTerminalCapabilities, displayWidth } from './capabilities.js';
import { InputBox } from './input-box.js';
import { StartupBrand } from './mascot.js';

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
    React.createElement(StartupBrand, { capabilities, version: '0.1.0', modelName: 'deepseek' }),
    React.createElement(InputBox, {
      capabilities,
      disabled: false,
      onSubmit: () => undefined,
    }),
  ));
  const frame = view.lastFrame() ?? '';
  assertFrameWidth(frame, 55);
  assert.doesNotMatch(frame, /[╭╰─❯●◇◆▲]/u);
  view.unmount();
});
