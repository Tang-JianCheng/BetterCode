import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import type { Snapshot } from '../filehistory/filehistory.js';
import type { RewindAction } from './rewind-dialog.js';
import { RewindDialog } from './rewind-dialog.js';

const capabilities = {
  columns: 80,
  density: 'compact' as const,
  color: false,
  unicode: false,
  motion: false,
};

const snapshots: Snapshot[] = [
  { messageIndex: 0, userText: '第一次修改', backups: {}, timestamp: '2026-08-02T08:00:00.000Z' },
  { messageIndex: 2, userText: '第二次修改', backups: {}, timestamp: '2026-08-02T09:00:00.000Z' },
];

async function flushInput(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('回滚支持检查点、恢复范围和方向键确认', async () => {
  const selected: RewindAction[] = [];
  const view = render(React.createElement(RewindDialog, {
    snapshots,
    capabilities,
    onSelect: (action: RewindAction) => selected.push(action),
    onCancel: () => undefined,
  }));
  await flushInput();
  assert.match(view.lastFrame() ?? '', /> .*第二次修改/u);

  view.stdin.write('\r');
  await flushInput();
  assert.match(view.lastFrame() ?? '', /选择恢复范围/u);
  view.stdin.write('\u001B[B');
  await flushInput();
  assert.match(view.lastFrame() ?? '', /> 仅恢复对话/u);
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(selected, [{ snapshotIndex: 1, mode: 'conversation_only' }]);
  view.unmount();
});

test('Esc 从恢复范围返回并在检查点页取消', async () => {
  let cancelCount = 0;
  const view = render(React.createElement(RewindDialog, {
    snapshots,
    capabilities,
    onSelect: () => undefined,
    onCancel: () => {
      cancelCount += 1;
    },
  }));
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  view.stdin.write('\u001B');
  await flushInput();
  assert.match(view.lastFrame() ?? '', /选择回滚检查点/u);
  assert.equal(cancelCount, 0);
  view.stdin.write('\u001B');
  await flushInput();
  assert.equal(cancelCount, 1);
  view.unmount();
});

test('恢复范围中的取消项可到达且不会越界', async () => {
  let cancelCount = 0;
  const view = render(React.createElement(RewindDialog, {
    snapshots,
    capabilities,
    onSelect: () => undefined,
    onCancel: () => {
      cancelCount += 1;
    },
  }));
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  for (let index = 0; index < 5; index += 1) {
    view.stdin.write('\u001B[B');
    await flushInput();
  }
  assert.match(view.lastFrame() ?? '', /> 取消/u);
  view.stdin.write('\r');
  await flushInput();
  assert.equal(cancelCount, 1);
  view.unmount();
});
