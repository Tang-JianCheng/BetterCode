import React from 'react';
import { Box, Text } from 'ink';
import { presentationDocumentMarkdown, presentationNoticeMarkdown } from '../presentation/markdown.js';
import type {
  NoticePresentation,
  PresentationDocument,
  PresentationItem,
} from '../presentation/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { terminalSafeText } from './capabilities.js';
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
  if (item.role === 'assistant' && item.markdown) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <MarkdownView ast={item.markdown} capabilities={capabilities} thinking={item.thinking} />
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginBottom={1}>
      {item.thinking ? (
        <Box>
          <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
            {capabilities.unicode ? '┊ ' : ': '}
          </Text>
          <Text dimColor color={capabilities.color ? BETTERCODE_THEME.muted : undefined}>
            {terminalSafeText(item.thinking, appleTerminal)}
          </Text>
        </Box>
      ) : undefined}
      <Box>
        {item.role === 'user' ? (
          <Text bold color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
            {capabilities.unicode ? '❯ ' : '> '}
          </Text>
        ) : undefined}
        <Text>{terminalSafeText(item.content, appleTerminal)}</Text>
      </Box>
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
