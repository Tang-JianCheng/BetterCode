import React from 'react';
import { Box, Text } from 'ink';
import { presentationDocumentMarkdown, presentationNoticeMarkdown } from '../presentation/markdown.js';
import type {
  NoticePresentation,
  PresentationDocument,
  PresentationItem,
} from '../presentation/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { terminalSafeText, wrapDisplay } from './capabilities.js';
import { MarkdownView } from './markdown-view.js';
import { MascotMark } from './mascot.js';
import { BETTERCODE_THEME, TONE_LABELS, toneColor } from './theme.js';

function ConversationView({
  item,
  capabilities,
}: {
  item: Extract<PresentationItem, { kind: 'conversation' }>;
  capabilities: TerminalCapabilities;
}) {
  const appleTerminal = capabilities.appleTerminal === true;
  const contentLines = wrapDisplay(
    terminalSafeText(item.content, appleTerminal),
    Math.max(8, capabilities.columns - 2),
  );
  if (item.role === 'assistant' && item.markdown) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <MarkdownView ast={item.markdown} capabilities={capabilities} />
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {contentLines.map((line, lineIndex) => (
        <Box key={`content-${lineIndex}`}>
          {item.role === 'user' && lineIndex === 0 ? (
            <Text bold color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
              {capabilities.unicode ? '❯ ' : '> '}
            </Text>
          ) : undefined}
          <Text>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}

function DocumentView({
  item,
  capabilities,
}: {
  item: PresentationDocument;
  capabilities: TerminalCapabilities;
}) {
  const markdown = item.markdown ?? presentationDocumentMarkdown(item);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <MarkdownView ast={markdown} capabilities={capabilities} />
    </Box>
  );
}

function NoticeView({
  item,
  capabilities,
}: {
  item: NoticePresentation;
  capabilities: TerminalCapabilities;
}) {
  const appleTerminal = capabilities.appleTerminal === true;
  const markdown = item.markdown ?? presentationNoticeMarkdown(item);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <MascotMark tone={item.tone} capabilities={capabilities} />
        <Text bold color={capabilities.color ? toneColor(item.tone) : undefined}>
          {' '}{TONE_LABELS[item.tone]} · {terminalSafeText(item.title, appleTerminal)}
        </Text>
      </Box>
      {markdown ? (
        <Box paddingLeft={2}>
          <MarkdownView ast={markdown} capabilities={capabilities} />
        </Box>
      ) : undefined}
    </Box>
  );
}

export interface PresentationViewProps {
  item: PresentationItem;
  capabilities: TerminalCapabilities;
}

export function PresentationView({ item, capabilities }: PresentationViewProps) {
  if (item.kind === 'conversation') {
    return <ConversationView item={item} capabilities={capabilities} />;
  }
  if (item.kind === 'document') {
    return <DocumentView item={item} capabilities={capabilities} />;
  }
  return <NoticeView item={item} capabilities={capabilities} />;
}
