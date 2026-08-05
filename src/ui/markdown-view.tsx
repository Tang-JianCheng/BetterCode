import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type {
  MarkdownAst,
  MarkdownColor,
  MarkdownSegment,
  MarkdownSegmentStyle,
} from '../markdown/types.js';
import { renderMarkdown } from '../markdown/renderer.js';
import { terminalSafeText, type TerminalCapabilities } from './capabilities.js';
import { BETTERCODE_THEME, type ThemeColor } from './theme.js';

const COLOR_MAP: Record<MarkdownColor, ThemeColor> = {
  accent: BETTERCODE_THEME.accent,
  brand: BETTERCODE_THEME.brand,
  danger: BETTERCODE_THEME.danger,
  info: BETTERCODE_THEME.info,
  muted: BETTERCODE_THEME.muted,
  success: BETTERCODE_THEME.success,
  text: BETTERCODE_THEME.text,
  warning: BETTERCODE_THEME.warning,
};

function segmentColor(style: MarkdownSegmentStyle, color?: MarkdownColor): ThemeColor | undefined {
  if (color) return COLOR_MAP[color];
  switch (style) {
    case 'heading':
    case 'accent':
      return BETTERCODE_THEME.accent;
    case 'code':
      return BETTERCODE_THEME.selected;
    case 'link':
      return BETTERCODE_THEME.info;
    case 'muted':
    case 'dim':
      return BETTERCODE_THEME.muted;
    default:
      return undefined;
  }
}

function SegmentText({
  segment,
  colorEnabled,
  appleTerminal,
}: {
  segment: MarkdownSegment;
  colorEnabled: boolean;
  appleTerminal: boolean;
}) {
  const color = colorEnabled ? segmentColor(segment.style, segment.color) : undefined;
  const bold = colorEnabled && (segment.style === 'heading' || segment.style === 'bold');
  const dimColor = colorEnabled && (
    segment.style === 'muted' || segment.style === 'dim' || segment.color === 'muted'
  );
  return (
    <Text bold={bold} dimColor={dimColor} color={color}>
      {terminalSafeText(segment.text, appleTerminal)}
    </Text>
  );
}

export interface MarkdownViewProps {
  ast: MarkdownAst;
  capabilities: TerminalCapabilities;
}

/** 把已解析的 Markdown 行片段映射为 Ink 组件 */
export function MarkdownView({ ast, capabilities }: MarkdownViewProps) {
  const appleTerminal = capabilities.appleTerminal === true;
  const lines = useMemo(() => renderMarkdown(ast, {
    columns: Math.max(20, capabilities.columns - 2),
    unicode: capabilities.unicode,
    color: capabilities.color,
  }), [ast, capabilities]);

  return (
    <Box flexDirection="column">
      {lines.map((line, lineIndex) => (
        <Box key={`${lineIndex}-${line.indent ?? 0}`} paddingLeft={line.indent ?? 0}>
          <Text>
            {line.segments.map((segment, segmentIndex) => (
              <SegmentText
                key={`${lineIndex}-${segmentIndex}`}
                segment={segment}
                colorEnabled={capabilities.color}
                appleTerminal={appleTerminal}
              />
            ))}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
