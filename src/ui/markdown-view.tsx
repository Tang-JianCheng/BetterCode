import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import type {
  MarkdownAst,
  MarkdownSegment,
  MarkdownSegmentStyle,
} from '../markdown/types.js';
import { renderMarkdown } from '../markdown/renderer.js';
import type { TerminalCapabilities } from './capabilities.js';
import { BETTERCODE_THEME, type ThemeColor } from './theme.js';

function segmentColor(style: MarkdownSegmentStyle): ThemeColor | undefined {
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
}: {
  segment: MarkdownSegment;
  colorEnabled: boolean;
}) {
  const color = colorEnabled ? segmentColor(segment.style) : undefined;
  const bold = colorEnabled && (segment.style === 'heading' || segment.style === 'bold');
  const dimColor = colorEnabled && (segment.style === 'muted' || segment.style === 'dim');
  return (
    <Text bold={bold} dimColor={dimColor} color={color}>
      {segment.text}
    </Text>
  );
}

export interface MarkdownViewProps {
  ast: MarkdownAst;
  capabilities: TerminalCapabilities;
  thinking?: string;
}

/** 把已解析的 Markdown 行片段映射为 Ink 组件 */
export function MarkdownView({ ast, capabilities, thinking }: MarkdownViewProps) {
  const lines = useMemo(() => renderMarkdown(ast, {
    columns: capabilities.columns,
    unicode: capabilities.unicode,
    color: capabilities.color,
  }), [ast, capabilities]);

  return (
    <Box flexDirection="column">
      {thinking ? (
        <Box>
          <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
            {capabilities.unicode ? '┊ ' : ': '}
          </Text>
          <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
            {thinking}
          </Text>
        </Box>
      ) : undefined}
      {lines.map((line, lineIndex) => (
        <Box key={`${lineIndex}-${line.indent ?? 0}`} paddingLeft={line.indent ?? 0}>
          <Text>
            {line.segments.map((segment, segmentIndex) => (
              <SegmentText
                key={`${lineIndex}-${segmentIndex}`}
                segment={segment}
                colorEnabled={capabilities.color}
              />
            ))}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
