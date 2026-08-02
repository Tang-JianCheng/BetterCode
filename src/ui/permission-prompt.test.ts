import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import type { PermissionChoice, PermissionRequest } from '../permission/types.js';
import { PermissionPrompt } from './permission-prompt.js';

const capabilities = {
  columns: 80,
  density: 'compact' as const,
  color: false,
  unicode: false,
  motion: false,
};

const request: PermissionRequest = {
  id: 'permission-1',
  toolCallId: 'tool-call-1',
  toolName: 'run_command',
  target: 'pnpm check',
  proposedRule: 'run_command(pnpm check)',
  risk: 'execute',
  projectRoot: '/repo',
};

async function flushInput(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

test('权限快捷键分别提交四种决定', async () => {
  const cases: Array<{ key: string; choice: PermissionChoice }> = [
    { key: 'd', choice: 'deny' },
    { key: 'o', choice: 'allow_once' },
    { key: 's', choice: 'allow_session' },
    { key: 'p', choice: 'allow_permanent' },
  ];

  for (const item of cases) {
    const selected: PermissionChoice[] = [];
    const view = render(React.createElement(PermissionPrompt, {
      request,
      capabilities,
      onSelect: (choice: PermissionChoice) => selected.push(choice),
    }));
    await flushInput();
    view.stdin.write(item.key);
    await flushInput();
    assert.deepEqual(selected, [item.choice]);
    view.unmount();
  }
});

test('方向键改变焦点且 Enter 提交当前项', async () => {
  const selected: PermissionChoice[] = [];
  const view = render(React.createElement(PermissionPrompt, {
    request,
    capabilities,
    onSelect: (choice: PermissionChoice) => selected.push(choice),
  }));

  await flushInput();
  assert.match(view.lastFrame() ?? '', /> \[o\] 仅本次允许/u);
  view.stdin.write('\u001B[B');
  await flushInput();
  assert.match(view.lastFrame() ?? '', /> \[s\] 本会话允许/u);
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(selected, ['allow_session']);
  view.unmount();
});

test('Esc 拒绝且连续输入只提交一次', async () => {
  const selected: PermissionChoice[] = [];
  const view = render(React.createElement(PermissionPrompt, {
    request,
    capabilities,
    onSelect: (choice: PermissionChoice) => selected.push(choice),
  }));

  await flushInput();
  view.stdin.write('\u001B');
  view.stdin.write('p');
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(selected, ['deny']);
  view.unmount();
});

test('执行命令风险在窄屏 ASCII 面板中保持可见', () => {
  const view = render(React.createElement(PermissionPrompt, {
    request,
    capabilities: { ...capabilities, columns: 55, density: 'narrow' },
    onSelect: () => undefined,
  }));
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /执行命令/u);
  assert.match(frame, /继承 BetterCode 进程的系统权限/u);
  view.unmount();
});
