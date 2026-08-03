import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import type { TerminalCapabilities } from './capabilities.js';
import { displayWidth } from './capabilities.js';
import { BETTERCODE_THEME, type ThemeColor } from './theme.js';

const GLYPH_WIDTH = 5;
const GLYPH_STEP = 4;
const GLYPH_HEIGHT = 7;
const BETTERCODE = 'BETTERCODE';

const PIXEL_GLYPHS: Record<string, readonly string[]> = {
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  E: ['11110', '10000', '10000', '11110', '10000', '10000', '11110'],
  T: ['01110', '00100', '00100', '00100', '00100', '00100', '00100'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  C: ['01110', '11000', '10000', '10000', '10000', '11000', '01110'],
  O: ['01110', '11011', '10001', '10001', '10001', '11011', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
};

// 连接高度刻意错开，避免任何一行变成贯穿整词的辅助横梁。
const BETTERCODE_JOIN_ROWS = [1, 6, 4, 2, 3, 1, 3, 2, 4] as const;

export interface LogoRendererOptions {
  width?: number;
  center?: boolean;
  animation?: boolean;
  animationDuration?: number;
  unicode?: boolean;
  scaleX?: 1 | 2;
}

export interface LogoJoin {
  row: number;
  leftColumn: number;
  rightColumn: number;
}

export interface LogoLayout {
  lines: readonly string[];
  joins: readonly LogoJoin[];
  contentWidth: number;
}

export interface AnsiLogoFrame {
  content: string;
  delayMs: number;
}

function colorForCharacter(character: string): ThemeColor {
  if (character === '░') return BETTERCODE_THEME.brandGhost;
  if (character === '▒') return BETTERCODE_THEME.brandShadow;
  if (character === '▓' || /[╭╮╰╯]/u.test(character)) return BETTERCODE_THEME.brandHighlight;
  return BETTERCODE_THEME.brand;
}

function colorRuns(line: string): Array<{ color: ThemeColor; value: string }> {
  const runs: Array<{ color: ThemeColor; value: string }> = [];
  for (const character of line) {
    const color = colorForCharacter(character);
    const previous = runs.at(-1);
    if (previous?.color === color) previous.value += character;
    else runs.push({ color, value: character });
  }
  return runs;
}

function blankLike(line: string): string {
  return ' '.repeat(displayWidth(line));
}

function ghostLine(line: string, unicode: boolean): string {
  return unicode ? line.replace(/[^ ]/gu, '░') : line.replace(/[^ ]/gu, '.');
}

export class LogoRenderer {
  readonly options: Required<LogoRendererOptions>;

  constructor(options: LogoRendererOptions = {}) {
    this.options = {
      width: options.width ?? 100,
      center: options.center ?? false,
      animation: options.animation ?? true,
      animationDuration: Math.max(0, options.animationDuration ?? 720),
      unicode: options.unicode ?? true,
      scaleX: options.scaleX ?? 2,
    };
  }

  layout(text = BETTERCODE): LogoLayout {
    const normalized = text.trim().toUpperCase();
    if (!normalized || [...normalized].some(character => !PIXEL_GLYPHS[character])) {
      throw new Error(`不支持的 Logo 文字: ${text}`);
    }

    const characters = [...normalized];
    const logicalWidth = GLYPH_WIDTH + (characters.length - 1) * GLYPH_STEP;
    const rawWidth = logicalWidth * this.options.scaleX;
    const pixels = Array.from(
      { length: GLYPH_HEIGHT },
      () => Array.from({ length: rawWidth }, () => false),
    );
    characters.forEach((character, characterIndex) => {
      PIXEL_GLYPHS[character].forEach((row, rowIndex) => {
        [...row].forEach((pixel, pixelIndex) => {
          if (pixel !== '1') return;
          const start = (characterIndex * GLYPH_STEP + pixelIndex) * this.options.scaleX;
          for (let offset = 0; offset < this.options.scaleX; offset += 1) {
            pixels[rowIndex][start + offset] = true;
          }
        });
      });
    });
    const joins = characters.slice(0, -1).map((_, index) => {
      const row = normalized === BETTERCODE
        ? BETTERCODE_JOIN_ROWS[index]
        : (index * 2 + 3) % GLYPH_HEIGHT;
      const leftColumn = (index + 1) * GLYPH_STEP * this.options.scaleX;
      const rightColumn = leftColumn + this.options.scaleX - 1;
      const leftPixel = PIXEL_GLYPHS[characters[index]][row].lastIndexOf('1');
      const rightPixel = PIXEL_GLYPHS[characters[index + 1]][row].indexOf('1');
      if (leftPixel < 0 || rightPixel < 0) {
        throw new Error(`无法连接 Logo 字符边界: ${index}`);
      }
      const leftStroke = (index * GLYPH_STEP + leftPixel + 1) * this.options.scaleX - 1;
      const rightStroke = ((index + 1) * GLYPH_STEP + rightPixel) * this.options.scaleX;
      const bridgeStart = Math.min(leftStroke, rightStroke);
      const bridgeEnd = Math.max(leftStroke, rightStroke);
      for (let column = bridgeStart; column <= bridgeEnd; column += 1) pixels[row][column] = true;
      return { row, leftColumn, rightColumn };
    });

    const isFilled = (row: number, column: number): boolean => pixels[row]?.[column] ?? false;
    const sharedColumns = new Map<number, string>();
    joins.forEach(({ leftColumn, rightColumn }) => {
      sharedColumns.set(leftColumn, this.options.unicode ? '▒' : '#');
      sharedColumns.set(rightColumn, this.options.unicode ? '░' : '#');
    });

    const rawLines = pixels.map((row, rowIndex) => row.map((filled, columnIndex) => {
      if (!filled) return ' ';
      if (!this.options.unicode) return '#';
      const sharedEdge = sharedColumns.get(columnIndex);
      if (sharedEdge) return sharedEdge;
      const topExposed = !isFilled(rowIndex - 1, columnIndex);
      const bottomExposed = !isFilled(rowIndex + 1, columnIndex);
      const rightExposed = !isFilled(rowIndex, columnIndex + 1);
      if (topExposed) return '▓';
      if (bottomExposed) return '▒';
      if (rightExposed) return '░';
      return '█';
    }).join('').trimEnd()).map((line, rowIndex) => {
      if (!this.options.unicode || (rowIndex !== 0 && rowIndex !== GLYPH_HEIGHT - 1)) return line;
      const characters = [...line];
      const first = characters.findIndex(character => character !== ' ');
      let last = characters.length - 1;
      while (last >= 0 && characters[last] === ' ') last -= 1;
      if (first >= 0) characters[first] = rowIndex === 0 ? '╭' : '╰';
      if (last >= 0) characters[last] = rowIndex === 0 ? '╮' : '╯';
      return characters.join('');
    });

    const contentWidth = Math.max(...rawLines.map(displayWidth));
    const lines = this.options.center
      ? rawLines.map(line => `${' '.repeat(Math.max(0, Math.floor((this.options.width - displayWidth(line)) / 2)))}${line}`)
      : rawLines;
    const centerOffset = this.options.center
      ? Math.max(0, Math.floor((this.options.width - contentWidth) / 2))
      : 0;
    return {
      lines,
      joins: joins.map(join => ({
        ...join,
        leftColumn: join.leftColumn + centerOffset,
        rightColumn: join.rightColumn + centerOffset,
      })),
      contentWidth,
    };
  }

  render(text = BETTERCODE): readonly string[] {
    return this.layout(text).lines;
  }

  animationFrames(text = BETTERCODE): readonly (readonly string[])[] {
    const lines = this.render(text);
    if (!this.options.animation) return [lines];
    const frames: string[][] = [lines.map(blankLike)];
    for (let row = 0; row < lines.length; row += 1) {
      frames.push(lines.map((line, index) => (
        index < row ? line : index === row ? ghostLine(line, this.options.unicode) : blankLike(line)
      )));
      frames.push(lines.map((line, index) => (index <= row ? line : blankLike(line))));
    }
    return frames;
  }

  ansiFrames(text = BETTERCODE): readonly AnsiLogoFrame[] {
    const frames = this.animationFrames(text);
    const delayMs = frames.length <= 1 ? 0 : Math.round(this.options.animationDuration / (frames.length - 1));
    return frames.map((frame, index) => ({
      content: `${index === 0 ? '\u001B[?25l' : `\u001B[${Math.max(0, frame.length - 1)}A\r`}${frame.map(line => `\u001B[2K${line}`).join('\n')}${index === frames.length - 1 ? '\u001B[?25h' : ''}`,
      delayMs,
    }));
  }
}

export const BETTERCODE_LOGO_TEMPLATE = new LogoRenderer({
  center: false,
  animation: false,
  unicode: true,
  scaleX: 2,
}).render(BETTERCODE);

export interface PixelLogoProps {
  capabilities: TerminalCapabilities;
  text?: string;
  center?: boolean;
  animation?: boolean;
  animationDuration?: number;
  onAnimationComplete?: () => void;
}

export function PixelLogo({
  capabilities,
  text = BETTERCODE,
  center = true,
  animation = capabilities.motion,
  animationDuration = 720,
  onAnimationComplete,
}: PixelLogoProps) {
  const availableWidth = Math.max(20, capabilities.columns - 2);
  const scaleX = capabilities.unicode && availableWidth >= 100 ? 2 : 1;
  const renderer = useMemo(() => new LogoRenderer({
    width: availableWidth,
    center,
    animation,
    animationDuration,
    unicode: capabilities.unicode,
    scaleX,
  }), [animation, animationDuration, availableWidth, capabilities.unicode, center, scaleX]);
  const frames = useMemo(() => renderer.animationFrames(text), [renderer, text]);
  const [frameIndex, setFrameIndex] = useState(animation && frames.length > 1 ? 0 : frames.length - 1);
  const completionNotified = useRef(false);

  useEffect(() => {
    completionNotified.current = false;
    if (!animation || frames.length <= 1) {
      setFrameIndex(frames.length - 1);
      return undefined;
    }
    setFrameIndex(0);
    const delay = Math.max(16, Math.round(animationDuration / (frames.length - 1)));
    const timer = setInterval(() => setFrameIndex(current => {
      const next = Math.min(frames.length - 1, current + 1);
      if (next === frames.length - 1) clearInterval(timer);
      return next;
    }), delay);
    return () => clearInterval(timer);
  }, [animation, animationDuration, frames]);

  useEffect(() => {
    if (frameIndex !== frames.length - 1 || completionNotified.current) return;
    completionNotified.current = true;
    onAnimationComplete?.();
  }, [frameIndex, frames.length, onAnimationComplete]);

  return (
    <Box flexDirection="column" width={availableWidth}>
      {frames[frameIndex].map((line, index) => (
        <Text key={`${index}-${line}`}>
          {colorRuns(line).map((run, runIndex) => (
            <Text
              key={`${runIndex}-${run.value}`}
              color={capabilities.color ? run.color : undefined}
            >
              {run.value}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
