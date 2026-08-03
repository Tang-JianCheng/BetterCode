import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import type { CommandCompletion } from '../command/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { displayWidth } from './capabilities.js';
import {
  moveCompletionIndex,
  navigateHistory,
  resolveCompletion,
  InputBox,
} from './input-box.js';

test('输入历史支持上下移动并恢复未提交草稿', () => {
  const history = ['第一条', '第二条'];
  const start = { input: '草稿', cursor: undefined, draft: '' };
  const latest = navigateHistory(history, start, 'up');
  assert.deepEqual(latest, { input: '第二条', cursor: 1, draft: '草稿' });
  const oldest = navigateHistory(history, latest, 'up');
  assert.equal(oldest.input, '第一条');
  assert.equal(navigateHistory(history, oldest, 'down').input, '第二条');
  assert.deepEqual(navigateHistory(history, latest, 'down'), {
    input: '草稿', cursor: undefined, draft: '草稿',
  });
});

test('单个补全直接写回，多候选进入稳定选择菜单', () => {
  const session = {
    name: 'session', aliases: [], value: '/session ', label: '/session [会话 ID]', description: '会话',
  };
  const review = {
    name: 'review', aliases: [], value: '/review ', label: '/review [范围]', description: '审查',
  };
  assert.deepEqual(resolveCompletion('/ses', [session]), {
    input: '/session ', items: [], selectedIndex: 0,
  });
  assert.deepEqual(resolveCompletion('/r', [session, review]), {
    input: '/r', items: [session, review], selectedIndex: 0,
  });
  assert.equal(moveCompletionIndex(0, 2, 'up'), 1);
  assert.equal(moveCompletionIndex(1, 2, 'down'), 0);
});

function capabilities(columns: number, unicode = true): TerminalCapabilities {
  return {
    columns,
    density: columns >= 100 ? 'full' : columns >= 64 ? 'compact' : 'narrow',
    color: false,
    unicode,
    motion: false,
  };
}

const candidates: readonly CommandCompletion[] = [
  {
    name: 'help', aliases: ['h'], value: '/help ', label: '/help [命令]',
    description: '显示命令帮助',
  },
  {
    name: 'permission', aliases: ['perm'], value: '/permission ', label: '/permission [模式]',
    description: '查看或切换权限模式',
  },
  {
    name: 'mew-spec', aliases: [], value: '/mew-spec ', label: '/mew-spec [参数]',
    description: '启动功能、模块或系统性优化时先创建四份规格文档，适合任何需要先规划再动手的任务',
  },
];

function complete(input: string): readonly CommandCompletion[] {
  if (!input.startsWith('/') || /\s/u.test(input.slice(1))) return [];
  const token = input.slice(1).toLowerCase();
  return candidates.filter(item =>
    item.name.startsWith(token) || item.aliases.some(alias => alias.startsWith(token)));
}

async function flushInput(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('输入 / 自动打开面板并随输入实时过滤', async () => {
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    complete,
    capabilities: capabilities(120),
  }));
  await flushInput();
  view.stdin.write('/');
  await flushInput();
  let frame = view.lastFrame() ?? '';
  assert.match(frame, /\/help/u);
  assert.match(frame, /\/permission/u);
  view.stdin.write('pe');
  await flushInput();
  frame = view.lastFrame() ?? '';
  assert.match(frame, /\/permission/u);
  assert.doesNotMatch(frame, /\/help/u);
  view.unmount();
});

test('候选面板位于输入框下方，左命令右描述', async () => {
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    complete,
    capabilities: capabilities(90),
  }));
  await flushInput();
  view.stdin.write('/');
  await flushInput();
  const lines = (view.lastFrame() ?? '').split('\n');
  const borderIndexes = lines
    .map((line, index) => (/^[─-]+$/u.test(line) ? index : -1))
    .filter(index => index >= 0);
  assert.equal(borderIndexes.length, 2, '输入框应有且仅有上下两条边框');
  const promptIndex = lines.findIndex(line => line.includes('❯ /'));
  assert.ok(promptIndex > borderIndexes[0] && promptIndex < borderIndexes[1], '提示行应在输入框内部');
  const permissionLine = lines.slice(borderIndexes[1] + 1)
    .find(line => line.includes('/permission'));
  assert.ok(permissionLine, '候选应出现在输入框下方');
  const descriptionIndex = permissionLine?.indexOf('查看或切换权限模式') ?? -1;
  assert.ok(descriptionIndex >= 44, '描述应右对齐到面板右半区');
  assert.equal(displayWidth(permissionLine ?? '') <= 90, true);
  view.unmount();
});

test('未聚焦行短描述，聚焦行描述同行展开且右对齐', async () => {
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    complete,
    capabilities: capabilities(120),
  }));
  await flushInput();
  view.stdin.write('/');
  await flushInput();
  view.stdin.write('\u001B[B');
  await flushInput();
  view.stdin.write('\u001B[B');
  await flushInput();
  const frame = view.lastFrame() ?? '';
  const mewLine = frame.split('\n').find(line => line.includes('/mew-spec'));
  assert.ok(mewLine, '聚焦行应包含命令名');
  assert.match(mewLine ?? '', /启动功能、模块或系统性优化时先创建四份规格文档/u, '完整描述应在聚焦行内展开');
  assert.doesNotMatch(mewLine ?? '', /…/u, '能放下的描述不应被截断');
  const fullDescriptionLines = frame.split('\n')
    .filter(line => line.includes('启动功能、模块或系统性优化时先创建四份规格文档'));
  assert.equal(fullDescriptionLines.length, 1, '完整描述只出现在聚焦行，不再另起一行');
  for (const line of frame.split('\n')) {
    assert.equal(displayWidth(line) <= 120, true, `行超过 120 列: ${line}`);
  }
  view.unmount();
});

test('聚焦行超长描述右对齐展开且不越界', async () => {
  const longComplete = (input: string): readonly CommandCompletion[] => {
    if (!input.startsWith('/')) return [];
    return [{
      name: 'long', aliases: [], value: '/long ', label: '/long [超长参数]',
      description: '这是一个非常长的描述文字，用来验证选中之后描述会在右侧展开并保持右对齐，不能把命令名挤掉也不能超出终端宽度',
    }];
  };
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    complete: longComplete,
    capabilities: capabilities(55),
  }));
  await flushInput();
  view.stdin.write('/');
  await flushInput();
  const frame = view.lastFrame() ?? '';
  const longLine = frame.split('\n').find(line => line.includes('/long'));
  assert.ok(longLine, '聚焦行应包含命令名');
  assert.match(longLine ?? '', /…/u, '超长描述应从左侧截断并保留省略号');
  assert.match(longLine ?? '', /终端宽度$/u, '展开应保留右缘描述');
  assert.ok(displayWidth(longLine ?? '') <= 55, '展开后不能越界');
  view.unmount();
});

test('候选超过一页时方向键动态翻页渲染', async () => {
  const many = (input: string): readonly CommandCompletion[] => {
    if (!input.startsWith('/')) return [];
    return Array.from({ length: 10 }, (_, i) => ({
      name: `cmd${i}`, aliases: [], value: `/cmd${i} `, label: `/cmd${i}`,
      description: `第 ${i + 1} 个候选`,
    }));
  };
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    complete: many,
    capabilities: capabilities(55),
  }));
  await flushInput();
  view.stdin.write('/');
  await flushInput();
  let frame = view.lastFrame() ?? '';
  assert.match(frame, /\/cmd0/u);
  assert.match(frame, /\/cmd3/u);
  assert.doesNotMatch(frame, /\/cmd4/u);
  assert.match(frame, /还有 6 个候选/u);

  for (let i = 0; i < 4; i += 1) {
    view.stdin.write('\u001B[B');
    await flushInput();
  }
  frame = view.lastFrame() ?? '';
  assert.doesNotMatch(frame, /\/cmd0/u);
  assert.match(frame, /\/cmd4/u);
  assert.match(frame, /\/cmd7/u);
  assert.match(frame, /还有 2 个候选/u);

  for (let i = 0; i < 4; i += 1) {
    view.stdin.write('\u001B[B');
    await flushInput();
  }
  frame = view.lastFrame() ?? '';
  assert.doesNotMatch(frame, /\/cmd4/u);
  assert.match(frame, /\/cmd8/u);
  assert.match(frame, /\/cmd9/u);
  assert.doesNotMatch(frame, /还有/u);
  view.unmount();
});

test('Enter 对完整命令直接执行，对部分输入选中候选', async () => {
  const submitted: string[] = [];
  const view = render(React.createElement(InputBox, {
    onSubmit: value => submitted.push(value),
    disabled: false,
    complete,
    capabilities: capabilities(80),
  }));
  await flushInput();
  view.stdin.write('/help');
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(submitted, ['/help']);
  assert.doesNotMatch(view.lastFrame() ?? '', /\/help/u);

  view.stdin.write('/pe');
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(submitted, ['/help']);
  assert.match(view.lastFrame() ?? '', /❯ \/permission/u);
  assert.doesNotMatch(view.lastFrame() ?? '', /查看或切换权限模式/u);
  view.unmount();
});

test('Tab 单候选补全，Esc 收起面板保留输入', async () => {
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    complete,
    capabilities: capabilities(80),
  }));
  await flushInput();
  view.stdin.write('/he');
  await flushInput();
  view.stdin.write('\t');
  await flushInput();
  assert.match(view.lastFrame() ?? '', /❯ \/help/u);

  view.stdin.write('\u001B');
  await flushInput();
  assert.doesNotMatch(view.lastFrame() ?? '', /\/permission/u);
  assert.match(view.lastFrame() ?? '', /❯ \/help/u);
  view.unmount();
});

test('ASCII 模式不输出 Unicode 装饰', async () => {
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    complete,
    capabilities: capabilities(80, false),
  }));
  await flushInput();
  view.stdin.write('/');
  await flushInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /\/help/u);
  assert.doesNotMatch(frame, /[❯─…•◆▲]/u);
  for (const line of frame.split('\n')) {
    assert.equal(displayWidth(line) <= 80, true, `行超过 80 列: ${line}`);
  }
  view.unmount();
});

test('输入框聚焦时显示光标，禁用时隐藏', async () => {
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    focused: true,
    capabilities: capabilities(80),
  }));
  await flushInput();
  assert.match(view.lastFrame() ?? '', /❯ █/u);
  view.unmount();

  const disabledView = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: true,
    focused: true,
    capabilities: capabilities(80),
  }));
  await flushInput();
  assert.doesNotMatch(disabledView.lastFrame() ?? '', /█/u);
  assert.match(disabledView.lastFrame() ?? '', /等待当前操作完成/u);
  disabledView.unmount();
});

test('ASCII 模式光标使用下划线', async () => {
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    focused: true,
    capabilities: capabilities(80, false),
  }));
  await flushInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /> _/u);
  assert.doesNotMatch(frame, /█/u);
  view.unmount();
});
