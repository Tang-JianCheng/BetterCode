import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import type { CommandCompletion } from '../command/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { displayWidth } from './capabilities.js';
import {
  buildInputLayout,
  cursorLocation,
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

test('Apple Terminal 下输入内容与候选描述中的破折号以 ASCII 展示', async () => {
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    complete,
    capabilities: { ...capabilities(120), appleTerminal: true },
  }));
  await flushInput();
  view.stdin.write('你好—世界');
  await flushInput();
  let frame = view.lastFrame() ?? '';
  assert.doesNotMatch(frame, /—/u);
  assert.match(frame, /你好--世界/u);
  view.unmount();

  const dashCandidate: CommandCompletion = {
    name: 'dash', aliases: [], value: '/dash ', label: '/dash 测试',
    description: '包含—破折号的说明',
  };
  const panel = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    complete: input => input.startsWith('/d') ? [dashCandidate] : [],
    capabilities: { ...capabilities(120), appleTerminal: true },
  }));
  await flushInput();
  panel.stdin.write('/d');
  await flushInput();
  frame = panel.lastFrame() ?? '';
  assert.doesNotMatch(frame, /—/u);
  assert.match(frame, /包含--破折号的说明/u);
  panel.unmount();
});

test('Shift+Enter 插入换行而不提交', async () => {
  const submitted: string[] = [];
  const view = render(React.createElement(InputBox, {
    onSubmit: value => submitted.push(value),
    disabled: false,
    capabilities: capabilities(80),
  }));
  await flushInput();
  view.stdin.write('第一行');
  await flushInput();
  view.stdin.write('\u001B[13;2u');
  await flushInput();
  view.stdin.write('第二行');
  await flushInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /第一行/u);
  assert.match(frame, /第二行/u);
  assert.deepEqual(submitted, [], 'Shift+Enter 不应提交');
  view.unmount();
});

test('括号粘贴保留换行并原样插入，不触发提交', async () => {
  const submitted: string[] = [];
  const view = render(React.createElement(InputBox, {
    onSubmit: value => submitted.push(value),
    disabled: false,
    capabilities: capabilities(80),
  }));
  await flushInput();
  view.stdin.write('\u001B[200~第一行\r\n第二行\r\u001B[201~');
  await flushInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /第一行/u);
  assert.match(frame, /第二行/u);
  assert.deepEqual(submitted, [], '粘贴内容不应触发提交');
  view.unmount();
});

test('粘贴后按回车才提交完整内容', async () => {
  const submitted: string[] = [];
  const view = render(React.createElement(InputBox, {
    onSubmit: value => submitted.push(value),
    disabled: false,
    capabilities: capabilities(80),
  }));
  await flushInput();
  view.stdin.write('\u001B[200~function demo() {}\u001B[201~');
  await flushInput();
  assert.deepEqual(submitted, [], '粘贴本身不应提交');
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(submitted, ['function demo() {}']);
  view.unmount();
});

test('未使用括号粘贴的纯文本粘贴也能插入', async () => {
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    capabilities: capabilities(80),
  }));
  await flushInput();
  view.stdin.write('import assert from "node:assert/strict";');
  await flushInput();
  assert.match(view.lastFrame() ?? '', /import assert/u);
  view.unmount();
});

test('buildInputLayout 按显示宽度折行并保留字符起点', () => {
  const layout = buildInputLayout('ab中文', 2);
  assert.deepEqual(layout, [
    { start: 0, text: 'ab' },
    { start: 2, text: '中' },
    { start: 3, text: '文' },
  ]);
  assert.equal(cursorLocation(layout, 3).lineIndex, 1);
  assert.equal(cursorLocation(layout, 3).offset, 1);
  assert.equal(cursorLocation(layout, 4).lineIndex, 2);
  assert.equal(cursorLocation(layout, 4).offset, 1);
});

test('buildInputLayout 保留空行与逻辑行边界', () => {
  const layout = buildInputLayout('第一行\n\n第三行', 80);
  assert.deepEqual(layout, [
    { start: 0, text: '第一行' },
    { start: 4, text: '' },
    { start: 5, text: '第三行' },
  ]);
  assert.equal(cursorLocation(layout, 4).lineIndex, 1);
  assert.equal(cursorLocation(layout, 4).offset, 0);
});

test('左右方向键移动光标并在光标处插入', async () => {
  const submitted: string[] = [];
  const view = render(React.createElement(InputBox, {
    onSubmit: value => submitted.push(value),
    disabled: false,
    capabilities: capabilities(80),
  }));
  await flushInput();
  view.stdin.write('abc');
  await flushInput();
  view.stdin.write('\u001B[D'); // 光标移到 b、c 之间
  await flushInput();
  view.stdin.write('X');
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(submitted, ['abXc']);
  view.unmount();
});

test('Home 跳到逻辑行首，End 跳到逻辑行尾', async () => {
  const submitted: string[] = [];
  const view = render(React.createElement(InputBox, {
    onSubmit: value => submitted.push(value),
    disabled: false,
    capabilities: capabilities(80),
  }));
  await flushInput();
  view.stdin.write('abc');
  await flushInput();
  view.stdin.write('\u001B[H'); // Home → 行首
  await flushInput();
  view.stdin.write('Z');
  await flushInput();
  view.stdin.write('\u001B[F'); // End → 行尾
  await flushInput();
  view.stdin.write('Y');
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(submitted, ['ZabcY']);
  view.unmount();
});

test('Backspace 删除光标前字符，Delete 删除光标后字符', async () => {
  const submitted: string[] = [];
  const view = render(React.createElement(InputBox, {
    onSubmit: value => submitted.push(value),
    disabled: false,
    capabilities: capabilities(80),
  }));
  await flushInput();
  view.stdin.write('abc');
  await flushInput();
  view.stdin.write('\u001B[D');
  await flushInput();
  view.stdin.write('\u001B[D'); // 光标在 a、b 之间
  await flushInput();
  view.stdin.write('\u001B[3~'); // Delete 删除光标后的 b
  await flushInput();
  view.stdin.write('\x7f'); // Backspace 删除光标前的 a
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(submitted, ['c']);
  view.unmount();
});

test('光标移动到上一逻辑行后可在行首插入', async () => {
  const submitted: string[] = [];
  const view = render(React.createElement(InputBox, {
    onSubmit: value => submitted.push(value),
    disabled: false,
    capabilities: capabilities(80),
  }));
  await flushInput();
  view.stdin.write('第一行');
  await flushInput();
  view.stdin.write('\u001B[13;2u'); // Shift+Enter
  await flushInput();
  view.stdin.write('第二行');
  await flushInput();
  view.stdin.write('\u001B[H'); // Home → 第二行行首
  await flushInput();
  view.stdin.write('\u001B[D'); // 左移 → 第一行行尾
  await flushInput();
  view.stdin.write('\u001B[H'); // Home → 第一行行首
  await flushInput();
  view.stdin.write('X');
  await flushInput();
  view.stdin.write('\r');
  await flushInput();
  assert.deepEqual(submitted, ['X第一行\n第二行']);
  view.unmount();
});

test('多行输入显示 Shift+Enter 换行提示', async () => {
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    capabilities: capabilities(80),
  }));
  await flushInput();
  view.stdin.write('第一行');
  await flushInput();
  assert.doesNotMatch(view.lastFrame() ?? '', /Shift\+Enter 换行/u);
  view.stdin.write('\u001B[13;2u');
  await flushInput();
  const frame = view.lastFrame() ?? '';
  assert.match(frame, /Shift\+Enter 换行/u);
  assert.match(frame, /⏎/u);
  view.unmount();

  const ascii = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    capabilities: capabilities(80, false),
  }));
  await flushInput();
  ascii.stdin.write('第一行');
  await flushInput();
  ascii.stdin.write('\u001B[13;2u');
  await flushInput();
  assert.match(ascii.lastFrame() ?? '', /> Shift\+Enter 换行/u);
  ascii.unmount();
});

test('Shift+Tab 触发 onShiftTab 且不参与补全，普通 Tab 补全不变', async () => {
  let shiftTabCount = 0;
  const view = render(React.createElement(InputBox, {
    onSubmit: () => undefined,
    disabled: false,
    complete,
    capabilities: capabilities(80),
    onShiftTab: () => { shiftTabCount += 1; },
  }));
  await flushInput();
  view.stdin.write('/he');
  await flushInput();
  view.stdin.write('\u001B[Z'); // Shift+Tab 不应触发补全
  await flushInput();
  assert.equal(shiftTabCount, 1);
  assert.match(view.lastFrame() ?? '', /❯ \/he█/u, 'Shift+Tab 不改写输入内容');
  view.stdin.write('\t'); // 普通 Tab 仍补全
  await flushInput();
  assert.match(view.lastFrame() ?? '', /❯ \/help/u);
  view.unmount();
});
