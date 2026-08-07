import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import type { SkillMetadata } from '../skill/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { SkillDialog } from './skill-dialog.js';

const capabilities: TerminalCapabilities = {
  columns: 100,
  density: 'full',
  color: false,
  unicode: true,
  motion: false,
};

function skill(name: string, description: string, mode: SkillMetadata['mode'] = 'shared'): SkillMetadata {
  return { name, description, tools: [], mode, history: 0 };
}

async function flushInput(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('/skill 列出全部 Skill，名称左对齐、描述右对齐，Enter 运行', async () => {
  let selected: string | undefined;
  let cancelled = false;
  const view = render(React.createElement(SkillDialog, {
    skills: [
      skill('review', '审查代码', 'isolated'),
      skill('commit', '生成提交信息'),
    ],
    onSelect: name => { selected = name; },
    onCancel: () => { cancelled = true; },
    capabilities,
  }));
  await flushInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /\[SKILL\] 可用 Skill/u);
  assert.match(frame, /\/review/u);
  assert.match(frame, /\/commit/u);
  assert.match(frame, /独立 · 审查代码/u);
  assert.match(frame, /共享 · 生成提交信息/u);

  view.stdin.write('\r');
  await flushInput();
  assert.equal(selected, 'review');
  assert.equal(cancelled, false);
  view.unmount();
});

test('/skill 方向键切换选中项，Enter 运行目标 Skill，Esc 退出', async () => {
  let selected: string | undefined;
  let cancelled = false;
  const view = render(React.createElement(SkillDialog, {
    skills: [skill('review', '审查'), skill('commit', '提交'), skill('test', '测试')],
    onSelect: name => { selected = name; },
    onCancel: () => { cancelled = true; },
    capabilities,
  }));
  await flushInput();
  view.stdin.write('\u001B[B'); // 下移
  await flushInput();
  view.stdin.write('\u001B[B'); // 再下移
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  assert.equal(selected, 'test');

  view.stdin.write('\u001B'); // Esc
  await flushInput();
  assert.equal(cancelled, true);
  view.unmount();
});

test('/skill 空列表提示没有可用 Skill', async () => {
  let cancelled = false;
  const view = render(React.createElement(SkillDialog, {
    skills: [],
    onSelect: () => undefined,
    onCancel: () => { cancelled = true; },
    capabilities,
  }));
  await flushInput();
  assert.match(view.lastFrame() ?? '', /没有可用 Skill/u);
  view.stdin.write('\u001B');
  await flushInput();
  assert.equal(cancelled, true);
  view.unmount();
});
