import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import type { TerminalCapabilities } from './capabilities.js';
import { displayWidth } from './capabilities.js';
import { BETTERCODE_THEME, type ThemeColor } from './theme.js';

const BETTERCODE = 'BETTERCODE';

// 紧凑回退字模：窄屏或 ASCII 环境使用，保持可读且不越界。
const PIXEL_GLYPHS: Record<string, readonly string[]> = {
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  E: ['11110', '10000', '10000', '11110', '10000', '10000', '11110'],
  T: ['01110', '00100', '00100', '00100', '00100', '00100', '00100'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  C: ['01110', '11000', '10000', '10000', '10000', '11000', '01110'],
  O: ['01110', '11011', '10001', '10001', '10001', '11011', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
};
const PIXEL_GLYPH_WIDTH = 5;
const PIXEL_GLYPH_STEP = 4;
const PIXEL_GLYPH_HEIGHT = 7;

// 用户指定的 BETTERCODE 像素横幅：原样输出，不做连接或字符替换。
export const BETTERCODE_LOGO_TEMPLATE = [
  '██████╗ ███████╗████████╗████████╗███████╗██████╗   ██████╗ ██████╗ ██████╗ ███████╗',
  '██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗ ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '██████╔╝█████╗     ██║      ██║   █████╗  ██████╔╝ ██║     ██║   ██║██║  ██║█████╗',
  '██╔══██╗██╔══╝     ██║      ██║   ██╔══╝  ██╔══██╗ ██║     ██║   ██║██║  ██║██╔══╝',
  '██████╔╝███████╗   ██║      ██║   ███████╗██║  ██║ ╚██████╗╚██████╔╝██████╔╝███████╗',
  '╚═════╝ ╚══════╝   ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
] as const;

export interface LogoRendererOptions {
  width?: number;
  center?: boolean;
  animation?: boolean;
  animationDuration?: number;
  unicode?: boolean;
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
      width: options.width ?? 120,
      center: options.center ?? false,
      animation: options.animation ?? true,
      animationDuration: Math.max(0, options.animationDuration ?? 720),
      unicode: options.unicode ?? true,
    };
  }

  layout(text = BETTERCODE): LogoLayout {
    const normalized = text.trim().toUpperCase();
    if (!normalized) {
      throw new Error(`不支持的 Logo 文字: ${text}`);
    }

    if (this.options.unicode && normalized === BETTERCODE) {
      const contentWidth = Math.max(...BETTERCODE_LOGO_TEMPLATE.map(displayWidth));
      if (contentWidth <= this.options.width) {
        const centerOffset = this.options.center
          ? Math.max(0, Math.floor((this.options.width - contentWidth) / 2))
          : 0;
        return {
          lines: BETTERCODE_LOGO_TEMPLATE.map(line => (
            this.options.center ? `${' '.repeat(centerOffset)}${line}` : line
          )),
          joins: [],
          contentWidth,
        };
      }
    }

    const characters = [...normalized];
    if (characters.some(character => !PIXEL_GLYPHS[character])) {
      throw new Error(`不支持的 Logo 文字: ${text}`);
    }
    return this.compactLayout(characters);
  }

  private compactLayout(characters: readonly string[]): LogoLayout {
    const rawWidth = PIXEL_GLYPH_WIDTH + (characters.length - 1) * PIXEL_GLYPH_STEP;
    const pixels = Array.from(
      { length: PIXEL_GLYPH_HEIGHT },
      () => Array.from({ length: rawWidth }, () => false),
    );
    characters.forEach((character, characterIndex) => {
      PIXEL_GLYPHS[character].forEach((row, rowIndex) => {
        [...row].forEach((pixel, pixelIndex) => {
          if (pixel === '1') pixels[rowIndex][characterIndex * PIXEL_GLYPH_STEP + pixelIndex] = true;
        });
      });
    });
    const block = this.options.unicode ? '█' : '#';
    const rawLines = pixels.map(row => row.map(filled => (filled ? block : ' ')).join('').trimEnd());
    const contentWidth = Math.max(...rawLines.map(displayWidth));
    const centerOffset = this.options.center
      ? Math.max(0, Math.floor((this.options.width - contentWidth) / 2))
      : 0;
    return {
      lines: rawLines.map(line => (this.options.center ? `${' '.repeat(centerOffset)}${line}` : line)),
      joins: [],
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
  const renderer = useMemo(() => new LogoRenderer({
    width: availableWidth,
    center,
    animation,
    animationDuration,
    unicode: capabilities.unicode,
  }), [animation, animationDuration, availableWidth, capabilities.unicode, center]);
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
