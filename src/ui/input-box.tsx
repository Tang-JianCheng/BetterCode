import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, useStdin, useStdout } from 'ink';
import type { CommandCompletion } from '../command/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import {
  detectTerminalCapabilities,
  displayWidth,
  padDisplay,
  terminalSafeText,
  truncateDisplay,
  truncateStart,
} from './capabilities.js';
import { BETTERCODE_THEME } from './theme.js';
import {
  BRACKETED_PASTE_DISABLE,
  BRACKETED_PASTE_ENABLE,
  RawInputParser,
  type RawKeyEvent,
} from './raw-input.js';

interface Props {
  /** 用户按下 Enter 提交输入时的回调 */
  onSubmit: (input: string) => void;
  /** 是否禁用输入（等待 AI 回复时） */
  disabled: boolean;
  /** 按时间顺序排列的历史输入 */
  history?: readonly string[];
  /** 返回当前输入对应的命令补全候选 */
  complete?: (input: string) => readonly CommandCompletion[];
  capabilities?: TerminalCapabilities;
  focused?: boolean;
  /** 输入为空且无候选时按 Enter 的回调（如切换工具折叠视图），不触发提交 */
  onEmptyEnter?: () => void;
  /** 按 Shift+Tab 时的回调（如循环切换权限模式），独立于补全用的 Tab */
  onShiftTab?: () => void;
}

export interface HistoryNavigationState {
  input: string;
  cursor?: number;
  draft: string;
}

export function navigateHistory(
  history: readonly string[],
  state: HistoryNavigationState,
  direction: 'up' | 'down',
): HistoryNavigationState {
  if (history.length === 0) return state;
  if (direction === 'up') {
    const cursor = state.cursor === undefined
      ? history.length - 1
      : Math.max(0, state.cursor - 1);
    return {
      input: history[cursor],
      cursor,
      draft: state.cursor === undefined ? state.input : state.draft,
    };
  }
  if (state.cursor === undefined) return state;
  if (state.cursor >= history.length - 1) {
    return { input: state.draft, cursor: undefined, draft: state.draft };
  }
  const cursor = state.cursor + 1;
  return { input: history[cursor], cursor, draft: state.draft };
}

export interface CompletionResolution {
  input: string;
  items: readonly CommandCompletion[];
  selectedIndex: number;
}

export function resolveCompletion(
  input: string,
  items: readonly CommandCompletion[],
): CompletionResolution {
  if (items.length === 1) {
    return { input: items[0].value, items: [], selectedIndex: 0 };
  }
  return { input, items, selectedIndex: 0 };
}

export function moveCompletionIndex(
  current: number,
  itemCount: number,
  direction: 'up' | 'down',
): number {
  if (itemCount <= 0) return 0;
  return direction === 'up'
    ? (current - 1 + itemCount) % itemCount
    : (current + 1) % itemCount;
}

function exactCommandMatch(input: string, item: CommandCompletion): boolean {
  const token = input.trim();
  if (!token.startsWith('/') || /\s/u.test(token)) return false;
  const name = token.slice(1).toLowerCase();
  return name === item.name || item.aliases.some(alias => alias === name);
}

/** 把字符串拆成字素簇，用于按"逻辑字符"移动光标，CJK 与组合字符一次移动一格。 */
function graphemeSegments(value: string): string[] {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
    .map(segment => segment.segment);
}

function moveCursorLeft(input: string, cursor: number): number {
  if (cursor <= 0) return 0;
  const segments = graphemeSegments(input.slice(0, cursor));
  return cursor - (segments[segments.length - 1]?.length ?? 1);
}

function moveCursorRight(input: string, cursor: number): number {
  if (cursor >= input.length) return cursor;
  const first = graphemeSegments(input.slice(cursor))[0];
  return first ? cursor + first.length : cursor;
}

/** 当前光标所在逻辑行（以 \n 分隔）的首尾字符下标。 */
function logicalLineBounds(input: string, cursor: number): { start: number; end: number } {
  const start = input.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  const newlineIndex = input.indexOf('\n', cursor);
  const end = newlineIndex === -1 ? input.length : newlineIndex;
  return { start, end };
}

function deleteGraphemeBefore(input: string, cursor: number): { next: string; cursor: number } {
  if (cursor <= 0) return { next: input, cursor };
  const before = input.slice(0, cursor);
  const after = input.slice(cursor);
  const segments = graphemeSegments(before);
  const last = segments[segments.length - 1];
  if (!last) return { next: input, cursor };
  return {
    next: before.slice(0, before.length - last.length) + after,
    cursor: cursor - last.length,
  };
}

function deleteGraphemeAfter(input: string, cursor: number): string {
  if (cursor >= input.length) return input;
  const after = input.slice(cursor);
  const first = graphemeSegments(after)[0];
  if (!first) return input;
  return input.slice(0, cursor) + after.slice(first.length);
}

export interface InputLayoutLine {
  /** 该视觉行第一个字符在输入串中的下标（UTF-16 码元） */
  start: number;
  text: string;
}

/**
 * 把输入串按 displayWidth 逐段拆分，得到光标定位用的视觉行列表。
 * 与 capabilities.wrapDisplay 的换行规则保持一致：先按 \n 分逻辑行，再按显示宽度折行。
 */
export function buildInputLayout(input: string, width: number): InputLayoutLine[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const layout: InputLayoutLine[] = [];
  let offset = 0;
  for (const paragraph of input.split('\n')) {
    if (paragraph === '') {
      layout.push({ start: offset, text: '' });
      offset += 1;
      continue;
    }
    let current = '';
    let currentWidth = 0;
    let lineStart = offset;
    for (const { segment } of segmenter.segment(paragraph)) {
      const segmentWidth = displayWidth(segment);
      if (currentWidth > 0 && currentWidth + segmentWidth > width) {
        layout.push({ start: lineStart, text: current });
        lineStart += current.length;
        current = '';
        currentWidth = 0;
      }
      current += segment;
      currentWidth += segmentWidth;
    }
    layout.push({ start: lineStart, text: current });
    offset += paragraph.length + 1;
  }
  return layout;
}

export function cursorLocation(
  layout: readonly InputLayoutLine[],
  cursor: number,
): { lineIndex: number; offset: number } {
  if (layout.length === 0) return { lineIndex: 0, offset: 0 };
  for (let index = 0; index < layout.length; index += 1) {
    const line = layout[index]!;
    if (cursor <= line.start + line.text.length) {
      return { lineIndex: index, offset: Math.max(0, cursor - line.start) };
    }
  }
  const last = layout[layout.length - 1]!;
  return { lineIndex: layout.length - 1, offset: last.text.length };
}

/**
 * 输入框组件——捕获用户键盘输入。
 * 支持：左右/Home/End 移动光标、Backspace/Delete 前后删除、Enter 提交、Shift+Enter 换行、
 * 粘贴多行文本、普通字符输入。光标是输入串内的下标（按字素簇移动），渲染定位到对应视觉行。
 * 输入走原始终端流解析（RawInputParser），不依赖 Ink 的 useInput，从而能识别
 * Shift+Enter 的 CSI-u 序列，并把括号粘贴内容按字面插入而不触发提交。
 */
export function InputBox({
  onSubmit,
  disabled,
  history = [],
  complete,
  capabilities = detectTerminalCapabilities(),
  focused = true,
  onEmptyEnter,
  onShiftTab,
}: Props) {
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [historyCursor, setHistoryCursor] = useState<number | undefined>();
  const [draft, setDraft] = useState('');
  const [completionItems, setCompletionItems] = useState<readonly CommandCompletion[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);

  // 同一分片可能解析出多个事件（如粘贴内容后紧跟回车），用 ref 同步最新值，
  // 保证事件按顺序处理时读到的是前一个事件写入后的状态。
  const inputRef = useRef('');
  const cursorRef = useRef(0);
  const historyCursorRef = useRef<number | undefined>(undefined);
  const draftRef = useRef('');
  const completionRef = useRef<{ items: readonly CommandCompletion[]; index: number }>({
    items: [],
    index: 0,
  });
  const parserRef = useRef(new RawInputParser());

  const { internal_eventEmitter, setRawMode } = useStdin();
  const { stdout } = useStdout();

  const commitInput = useCallback((next: string, nextCursor: number) => {
    inputRef.current = next;
    setInput(next);
    cursorRef.current = nextCursor;
    setCursor(nextCursor);
    historyCursorRef.current = undefined;
    setHistoryCursor(undefined);
  }, []);

  const commitHistory = useCallback((
    next: string,
    nextHistoryCursor: number | undefined,
    nextDraft: string,
  ) => {
    inputRef.current = next;
    setInput(next);
    cursorRef.current = next.length;
    setCursor(next.length);
    historyCursorRef.current = nextHistoryCursor;
    setHistoryCursor(nextHistoryCursor);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, []);

  const commitCompletion = useCallback((
    items: readonly CommandCompletion[],
    index = 0,
  ) => {
    completionRef.current = { items, index };
    setCompletionItems(items);
    setCompletionIndex(index);
  }, []);

  const commitReset = useCallback(() => {
    inputRef.current = '';
    setInput('');
    cursorRef.current = 0;
    setCursor(0);
    historyCursorRef.current = undefined;
    setHistoryCursor(undefined);
    draftRef.current = '';
    setDraft('');
    completionRef.current = { items: [], index: 0 };
    setCompletionItems([]);
    setCompletionIndex(0);
  }, []);

  const applyInputEvent = useCallback((event: RawKeyEvent) => {
    const current = inputRef.current;
    const cursorAt = cursorRef.current;
    const currentCompletion = completionRef.current;

    switch (event.kind) {
      case 'escape':
        if (currentCompletion.items.length > 0) commitCompletion([]);
        return;

      case 'tab':
        if (complete) {
          const resolution = resolveCompletion(current, complete(current));
          commitInput(resolution.input, resolution.input.length);
          commitCompletion(resolution.items, resolution.selectedIndex);
        }
        return;

      case 'shifttab':
        // Shift+Tab 不参与补全，交给上层应用（如循环切换权限模式）
        onShiftTab?.();
        return;

      case 'return':
        if (currentCompletion.items.length > 0) {
          const selected = currentCompletion.items[currentCompletion.index];
          if (selected && exactCommandMatch(current, selected)) {
            const trimmed = current.trim();
            if (trimmed) {
              onSubmit(trimmed);
              commitReset();
            }
          } else if (selected) {
            commitInput(selected.value, selected.value.length);
            commitCompletion([]);
          }
        } else {
          const trimmed = current.trim();
          if (trimmed) {
            onSubmit(trimmed);
            commitReset();
          } else if (onEmptyEnter) {
            onEmptyEnter();
          }
        }
        return;

      case 'up':
      case 'down':
        if (currentCompletion.items.length > 0) {
          commitCompletion(
            currentCompletion.items,
            moveCompletionIndex(
              currentCompletion.index,
              currentCompletion.items.length,
              event.kind === 'up' ? 'up' : 'down',
            ),
          );
          return;
        }
        {
          const next = navigateHistory(history, {
            input: current,
            cursor: historyCursorRef.current,
            draft: draftRef.current,
          }, event.kind === 'up' ? 'up' : 'down');
          commitHistory(next.input, next.cursor, next.draft);
          commitCompletion(complete ? complete(next.input) : []);
        }
        return;

      case 'left':
        commitInput(current, moveCursorLeft(current, cursorAt));
        return;

      case 'right':
        commitInput(current, moveCursorRight(current, cursorAt));
        return;

      case 'home':
        commitInput(current, logicalLineBounds(current, cursorAt).start);
        return;

      case 'end':
        commitInput(current, logicalLineBounds(current, cursorAt).end);
        return;

      case 'backspace':
        {
          const result = deleteGraphemeBefore(current, cursorAt);
          commitInput(result.next, result.cursor);
          commitCompletion(complete ? complete(result.next) : []);
        }
        return;

      case 'delete':
        {
          const next = deleteGraphemeAfter(current, cursorAt);
          commitInput(next, cursorAt);
          commitCompletion(complete ? complete(next) : []);
        }
        return;

      case 'text':
      case 'paste':
        {
          const before = current.slice(0, cursorAt);
          const after = current.slice(cursorAt);
          const text = event.text ?? '';
          const next = before + text + after;
          commitInput(next, cursorAt + text.length);
          commitCompletion(complete ? complete(next) : []);
        }
        return;

      case 'newline':
        {
          const next = `${current.slice(0, cursorAt)}\n${current.slice(cursorAt)}`;
          commitInput(next, cursorAt + 1);
          commitCompletion([]);
        }
        return;

      case 'ignore':
        return;
    }
  }, [commitCompletion, commitHistory, commitInput, commitReset, complete, history, onEmptyEnter, onShiftTab, onSubmit]);

  // 最新的处理函数放进 ref，输入监听只订阅一次，避免每敲一个字符都重新挂载。
  const applyInputEventRef = useRef(applyInputEvent);
  applyInputEventRef.current = applyInputEvent;

  useEffect(() => {
    if (disabled || !focused) return;
    // 开启 raw mode，让 Ink 开始从 stdin 读取并广播到 internal_eventEmitter
    setRawMode(true);
    // 真实终端才发送括号粘贴模式切换序列，测试环境的假 stdout 不受影响。
    const isRealTerminal = stdout.isTTY === true;
    if (isRealTerminal) stdout.write(BRACKETED_PASTE_ENABLE);
    const handleRawInput = (chunk: unknown) => {
      const raw = typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk ?? '');
      for (const event of parserRef.current.push(raw)) {
        applyInputEventRef.current(event);
      }
    };
    internal_eventEmitter.on('input', handleRawInput);
    return () => {
      internal_eventEmitter.off('input', handleRawInput);
      if (isRealTerminal) stdout.write(BRACKETED_PASTE_DISABLE);
      setRawMode(false);
    };
  }, [disabled, focused, internal_eventEmitter, setRawMode, stdout]);

  const pageSize = capabilities.density === 'narrow' ? 4 : 8;
  const pageCount = Math.max(1, Math.ceil(completionItems.length / pageSize));
  const pageIndex = completionItems.length === 0
    ? 0
    : Math.min(Math.floor(completionIndex / pageSize), pageCount - 1);
  const pageStart = pageIndex * pageSize;
  const visibleCompletionItems = completionItems.slice(pageStart, pageStart + pageSize);
  // 应用层会在左右各留 1 列内边距，边框与面板按实际内容宽度排版
  const contentWidth = Math.max(8, capabilities.columns - 2);
  const border = capabilities.unicode ? '─' : '-';
  const marker = capabilities.unicode ? '❯ ' : '> ';
  const ellipsis = capabilities.unicode ? '…' : '...';
  const markerWidth = displayWidth(marker);
  const maxLabelWidth = completionItems.reduce(
    (max, item) => Math.max(max, displayWidth(item.label)),
    0,
  );
  const labelColumnWidth = Math.min(
    maxLabelWidth,
    Math.max(8, Math.floor((contentWidth - markerWidth) * 0.45)),
  );
  const commandGap = 4;
  const descriptionColumnWidth = Math.max(
    8,
    contentWidth - markerWidth - labelColumnWidth - commandGap,
  );
  const cursorChar = capabilities.unicode ? '█' : '_';
  const showCursor = !disabled && focused;
  const appleTerminal = capabilities.appleTerminal === true;
  const inputWidth = Math.max(1, contentWidth - markerWidth);
  const inputLayout = disabled
    ? [{ start: 0, text: '等待当前操作完成…' }]
    : buildInputLayout(input, inputWidth);
  const cursorAt = showCursor ? cursorLocation(inputLayout, cursor) : undefined;
  const multilineHint = !disabled && input.includes('\n');
  const hint = capabilities.unicode
    ? '⏎ Shift+Enter 换行 · Enter 发送'
    : '> Shift+Enter 换行 | Enter 发送';
  return (
    <Box flexDirection="column">
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {border.repeat(contentWidth)}
      </Text>
      {multilineHint ? (
        <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
          {hint}
        </Text>
      ) : undefined}
      <Box>
        <Text bold color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
          {capabilities.unicode ? '❯' : '>'}{' '}
        </Text>
        <Box flexDirection="column">
          {inputLayout.map((line, index) => {
            // 光标所在行把文本拆成光标前/后两段，光标作为兄弟 Text 渲染；
            // 不要嵌套在 Text 里，否则 Ink 增量重绘时首次更新会丢掉光标。
            if (cursorAt && cursorAt.lineIndex === index) {
              const before = line.text.slice(0, cursorAt.offset);
              const after = line.text.slice(cursorAt.offset);
              return (
                <Box key={index} flexDirection="row">
                  <Text dimColor={disabled}>{terminalSafeText(before, appleTerminal)}</Text>
                  <Text bold color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
                    {cursorChar}
                  </Text>
                  <Text dimColor={disabled}>{terminalSafeText(after, appleTerminal)}</Text>
                </Box>
              );
            }
            return (
              <Box key={index} flexDirection="row">
                <Text dimColor={disabled}>{terminalSafeText(line.text, appleTerminal)}</Text>
              </Box>
            );
          })}
        </Box>
      </Box>
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {border.repeat(contentWidth)}
      </Text>
      {visibleCompletionItems.map((item, index) => {
        const selected = completionIndex - pageStart === index;
        const label = terminalSafeText(item.label, appleTerminal);
        const descriptionSource = terminalSafeText(item.description, appleTerminal);
        // 聚焦行让描述在右侧原地展开；超长时保留右缘并从左侧截断，避免挤掉命令名。
        const description = selected
          ? truncateStart(descriptionSource, descriptionColumnWidth, ellipsis)
          : truncateDisplay(descriptionSource, descriptionColumnWidth, ellipsis);
        const paddedDescription = `${' '.repeat(
          Math.max(0, descriptionColumnWidth - displayWidth(description)),
        )}${description}`;
        const rowText = [
          selected ? marker : '  ',
          padDisplay(label, labelColumnWidth, ellipsis),
          ' '.repeat(commandGap),
          paddedDescription,
        ].join('');
        return (
          <Box key={item.name} width={contentWidth}>
            <Text
              bold={selected}
              inverse={selected}
              color={capabilities.color
                ? selected ? BETTERCODE_THEME.selected : BETTERCODE_THEME.text
                : undefined}
            >
              {rowText}
            </Text>
          </Box>
        );
      })}
      {pageStart + visibleCompletionItems.length < completionItems.length ? (
        <Text dimColor>  还有 {completionItems.length - pageStart - visibleCompletionItems.length} 个候选</Text>
      ) : undefined}
    </Box>
  );
}
