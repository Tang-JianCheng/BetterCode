import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import type { TerminalCapabilities } from './capabilities.js';
import { ModelDialog, type ModelOption } from './model-dialog.js';

const capabilities: TerminalCapabilities = {
  columns: 100,
  density: 'full',
  color: false,
  unicode: true,
  motion: false,
};

function provider(name: string, model: string, baseUrl = 'https://api.deepseek.com'): ModelOption {
  return { name, model, base_url: baseUrl };
}

async function flushInput(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('模型选择器展示 Provider、当前标记并支持 Enter 切换', async () => {
  let selected: string | undefined;
  let cancelled = false;
  const view = render(React.createElement(ModelDialog, {
    providers: [
      provider('deepseek', 'deepseek-chat'),
      provider('flash', 'deepseek-v4-flash'),
    ],
    currentProviderName: 'deepseek',
    onSelect: name => { selected = name; },
    onCancel: () => { cancelled = true; },
    capabilities,
  }));
  await flushInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /\[MODEL\] 切换模型/u);
  assert.match(frame, /deepseek/u);
  assert.match(frame, /deepseek-chat/u);
  assert.match(frame, /\[当前\]/u);
  assert.match(frame, /api\.deepseek\.com/u);

  view.stdin.write('\r');
  await flushInput();
  assert.equal(selected, 'deepseek');
  assert.equal(cancelled, false);
  view.unmount();
});

test('方向键移动选择，Enter 切换第二项，Esc 退出', async () => {
  const selected: string[] = [];
  let cancelled = false;
  const view = render(React.createElement(ModelDialog, {
    providers: [
      provider('deepseek', 'deepseek-chat'),
      provider('flash', 'deepseek-v4-flash'),
    ],
    currentProviderName: 'deepseek',
    onSelect: name => selected.push(name),
    onCancel: () => { cancelled = true; },
    capabilities,
  }));
  await flushInput();
  view.stdin.write('\u001B[B');
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(selected, ['flash']);

  view.stdin.write('\u001B');
  await flushInput();
  assert.equal(cancelled, true);
  view.unmount();
});

test('超过一页时显示剩余候选并可滚动窗口', async () => {
  const providers = Array.from({ length: 12 }, (_, index) =>
    provider(`p${index + 1}`, `model-${index + 1}`));
  const view = render(React.createElement(ModelDialog, {
    providers,
    currentProviderName: 'none',
    onSelect: () => undefined,
    onCancel: () => undefined,
    capabilities,
  }));
  await flushInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /还有 3 个候选/u);
  assert.match(frame, /p1/u);
  assert.doesNotMatch(frame, /p12/u);

  for (let index = 0; index < 11; index += 1) {
    view.stdin.write('\u001B[B');
    await flushInput();
  }
  const scrolled = view.lastFrame() ?? '';
  assert.match(scrolled, /p12/u);
  view.unmount();
});
