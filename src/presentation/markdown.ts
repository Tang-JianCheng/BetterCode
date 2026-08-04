import { parseInlineMarkdown } from '../markdown/parser.js';
import type {
  MarkdownAst,
  MarkdownBlock,
  MarkdownInline,
  MarkdownListItem,
} from '../markdown/types.js';
import type { PresentationBlock, PresentationEntry } from './types.js';

function paragraph(content: string): MarkdownBlock {
  return { type: 'paragraph', inline: parseInlineMarkdown(content) };
}

function keyValueItem(entry: PresentationEntry): MarkdownListItem {
  return {
    blocks: [{
      type: 'paragraph',
      inline: [
        ...parseInlineMarkdown(entry.label),
        { type: 'text', content: ': ' },
        ...parseInlineMarkdown(entry.value),
      ],
    }],
  };
}

function listItem(content: string): MarkdownListItem {
  return { blocks: [paragraph(content)] };
}

function tableBlock(block: Extract<PresentationBlock, { type: 'table' }>): MarkdownBlock {
  return {
    type: 'table',
    header: block.columns.map(column => parseInlineMarkdown(column.label)),
    rows: block.rows.map(row => row.map(cell => parseInlineMarkdown(cell))),
  };
}

export function presentationBlocksToMarkdown(
  blocks: readonly PresentationBlock[],
): MarkdownBlock[] {
  const result: MarkdownBlock[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        result.push(block.heading
          ? { type: 'heading', level: 3, inline: parseInlineMarkdown(block.content) }
          : paragraph(block.content));
        break;
      case 'key_value':
        result.push({
          type: 'list',
          ordered: false,
          start: 1,
          items: block.entries.map(keyValueItem),
        });
        break;
      case 'table':
        result.push(tableBlock(block));
        break;
      case 'list':
        result.push({
          type: 'list',
          ordered: block.ordered ?? false,
          start: 1,
          items: block.items.map(listItem),
        });
        break;
      case 'tree':
        result.push({
          type: 'tree',
          lines: block.lines.map(line => ({
            content: parseInlineMarkdown(line.content),
            indent: line.indent ?? 0,
            branch: line.branch ?? false,
            ...(line.prefix ? { prefix: line.prefix } : {}),
            ...(line.color ? { color: line.color } : {}),
          })),
        });
        break;
      case 'divider':
        result.push({ type: 'hr' });
        break;
    }
  }
  return result;
}

export function presentationDocumentMarkdown(input: {
  title: string;
  badge?: string;
  blocks: readonly PresentationBlock[];
  footer?: string;
}): MarkdownAst {
  const titleInline: readonly MarkdownInline[] = input.badge
    ? [{ type: 'text', content: `[${input.badge}] ` }, ...parseInlineMarkdown(input.title)]
    : parseInlineMarkdown(input.title);
  const blocks: MarkdownBlock[] = [
    { type: 'heading', level: 2, inline: titleInline },
    ...presentationBlocksToMarkdown(input.blocks),
  ];
  if (input.footer) blocks.push(paragraph(input.footer));
  return { blocks };
}

export function presentationNoticeMarkdown(input: {
  message?: string;
  details?: readonly string[];
}): MarkdownAst | undefined {
  const blocks: MarkdownBlock[] = [];
  if (input.message) blocks.push(paragraph(input.message));
  if (input.details?.length) {
    blocks.push({
      type: 'list',
      ordered: false,
      start: 1,
      items: input.details.map(listItem),
    });
  }
  return blocks.length > 0 ? { blocks } : undefined;
}
