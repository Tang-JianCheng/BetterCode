import stringWidth from 'string-width';
import type {
  MarkdownAst,
  MarkdownBlock,
  MarkdownInline,
  MarkdownLine,
  MarkdownRenderOptions,
  MarkdownSegment,
  MarkdownSegmentStyle,
} from './types.js';

const BLANK_LINE: MarkdownLine = { segments: [{ text: ' ', style: 'normal' }] };

function takeDisplay(value: string, maxWidth: number): { head: string; rest: string } {
  if (maxWidth <= 0) return { head: '', rest: value };
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let width = 0;
  let head = '';
  for (const { segment } of segmenter.segment(value)) {
    const segmentWidth = stringWidth(segment);
    if (width + segmentWidth > maxWidth) break;
    head += segment;
    width += segmentWidth;
  }
  return { head, rest: value.slice(head.length) };
}

function trimTrailingSpaces(segments: readonly MarkdownSegment[]): MarkdownSegment[] {
  const result = [...segments];
  while (result.length > 0 && result.at(-1)?.text.trim() === '') result.pop();
  const last = result.at(-1);
  if (last && /\s+$/u.test(last.text)) {
    result[result.length - 1] = { ...last, text: last.text.replace(/\s+$/u, '') };
  }
  return result;
}

function wrapSegments(
  segments: readonly MarkdownSegment[],
  width: number,
): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let current: MarkdownSegment[] = [];
  let currentWidth = 0;

  const flush = () => {
    const trimmed = trimTrailingSpaces(current);
    if (trimmed.length > 0) lines.push({ segments: trimmed });
    current = [];
    currentWidth = 0;
  };

  for (const segment of segments) {
    const parts = segment.text.split(/(\s+|\n)/u);
    for (const part of parts) {
      if (!part) continue;
      if (part === '\n') {
        flush();
        continue;
      }
      if (/^\s+$/u.test(part)) {
        if (currentWidth > 0 && currentWidth < width) {
          current.push({ text: ' ', style: segment.style });
          currentWidth += 1;
        }
        continue;
      }
      let remaining = part;
      while (remaining) {
        if (currentWidth >= width) {
          flush();
          continue;
        }
        const { head, rest } = takeDisplay(remaining, width - currentWidth);
        if (!head) {
          flush();
          continue;
        }
        current.push({ text: head, style: segment.style });
        currentWidth += stringWidth(head);
        remaining = rest;
      }
    }
  }
  flush();
  return lines;
}

function truncateSegments(
  segments: readonly MarkdownSegment[],
  maxWidth: number,
): MarkdownSegment[] {
  if (maxWidth <= 0) return [];
  const result: MarkdownSegment[] = [];
  let width = 0;
  for (const segment of segments) {
    if (width >= maxWidth) break;
    const { head } = takeDisplay(segment.text, maxWidth - width);
    if (!head) break;
    result.push({ ...segment, text: head });
    width += stringWidth(head);
  }
  return result;
}

function segmentWidth(segments: readonly MarkdownSegment[]): number {
  return segments.reduce((sum, segment) => sum + stringWidth(segment.text), 0);
}

function renderInlineCell(
  cell: readonly MarkdownInline[],
  maxWidth: number,
  options: MarkdownRenderOptions,
): MarkdownSegment[] {
  const segments = inlineSegments(cell, options);
  if (stringWidth(markdownLineText({ segments })) <= maxWidth) return segments;
  const ellipsis = options.unicode ? '…' : '...';
  const contentWidth = Math.max(0, maxWidth - stringWidth(ellipsis));
  return [...truncateSegments(segments, contentWidth), { text: ellipsis, style: 'muted' }];
}

function restyle(segments: readonly MarkdownSegment[], style: MarkdownSegmentStyle): MarkdownSegment[] {
  return segments.map(segment => segment.style === 'normal' ? { ...segment, style } : segment);
}

function inlineSegments(
  nodes: readonly MarkdownInline[],
  options: MarkdownRenderOptions,
): MarkdownSegment[] {
  const result: MarkdownSegment[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        result.push({ text: node.content, style: 'normal' });
        break;
      case 'strong': {
        const inner = inlineSegments(node.children, options);
        result.push(...(options.color
          ? restyle(inner, 'bold')
          : [{ text: '**', style: 'bold' as const }, ...inner, { text: '**', style: 'bold' as const }]));
        break;
      }
      case 'em': {
        const inner = inlineSegments(node.children, options);
        result.push(...(options.color
          ? restyle(inner, 'dim')
          : [{ text: '_', style: 'dim' as const }, ...inner, { text: '_', style: 'dim' as const }]));
        break;
      }
      case 'del': {
        const inner = inlineSegments(node.children, options);
        result.push(...(options.color
          ? restyle(inner, 'muted')
          : [{ text: '~~', style: 'muted' as const }, ...inner, { text: '~~', style: 'muted' as const }]));
        break;
      }
      case 'code':
        result.push({
          text: options.color ? node.content : `\`${node.content}\``,
          style: 'code',
        });
        break;
      case 'link': {
        const children = inlineSegments(node.children, options);
        const textSegments = children.length > 0 ? children : [{ text: node.href, style: 'normal' as const }];
        result.push(...restyle(textSegments, 'link'));
        if (node.href) result.push({ text: ` (${node.href})`, style: 'muted' });
        break;
      }
      case 'image':
        result.push({ text: `[${node.alt}](${node.src})`, style: 'muted' });
        break;
      case 'checkbox':
        result.push({ text: node.checked ? '[x] ' : '[ ] ', style: 'normal' });
        break;
      case 'br':
        result.push({ text: '\n', style: 'normal' });
        break;
    }
  }
  return result;
}

function withIndent(lines: MarkdownLine[], indent: number): MarkdownLine[] {
  return lines.map(line => ({ ...line, indent }));
}

function renderParagraph(
  inline: readonly MarkdownInline[],
  options: MarkdownRenderOptions,
  indent: number,
): MarkdownLine[] {
  return withIndent(
    wrapSegments(inlineSegments(inline, options), Math.max(8, options.columns - indent)),
    indent,
  );
}

function renderCode(
  block: Extract<MarkdownBlock, { type: 'code' }>,
  options: MarkdownRenderOptions,
  indent: number,
): MarkdownLine[] {
  const border = options.unicode ? '─' : '-';
  const top = options.unicode ? '┌─' : '+-';
  const bottom = options.unicode ? '└─' : '+-';
  const contentPrefix = options.unicode ? '│ ' : '| ';
  const language = block.language?.trim() || (options.unicode ? '代码' : 'code');
  const lineWidth = Math.max(8, options.columns - indent - 2);
  const lines: MarkdownLine[] = [{
    segments: [{ text: `${top} ${language}`, style: 'muted' }],
    indent,
  }];
  for (const rawLine of block.content.split('\n')) {
    let remaining = rawLine;
    do {
      const { head } = takeDisplay(remaining, lineWidth);
      lines.push({
        segments: [{ text: `${contentPrefix}${head}`, style: 'code' }],
        indent,
      });
      remaining = remaining.slice(head.length);
    } while (remaining.length > 0);
  }
  lines.push({ segments: [{ text: bottom, style: 'muted' }], indent });
  return lines;
}

function renderList(
  block: Extract<MarkdownBlock, { type: 'list' }>,
  options: MarkdownRenderOptions,
  indent: number,
): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  block.items.forEach((item, index) => {
    const number = block.ordered
      ? `${block.start + index}. `
      : options.unicode ? '• ' : '- ';
    const prefixWidth = Math.max(2, stringWidth(number));
    const childIndent = indent + prefixWidth;
    const itemLines = item.blocks.flatMap(child => renderBlock(child, options, childIndent));
    if (itemLines.length === 0) {
      lines.push({ segments: [{ text: number, style: 'bold' }], indent });
      return;
    }
    const first = itemLines[0];
    lines.push({
      segments: [{ text: number, style: 'bold' }, ...first.segments],
      indent,
    });
    lines.push(...itemLines.slice(1));
  });
  return lines;
}

function renderTree(
  block: Extract<MarkdownBlock, { type: 'tree' }>,
  options: MarkdownRenderOptions,
  indent: number,
): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  for (const line of block.lines) {
    const baseIndent = indent + line.indent;
    const branchPrefix = line.branch
      ? options.unicode ? '├ ' : '|- '
      : '';
    const prefixSegments: MarkdownSegment[] = [
      ...(line.prefixSegments?.map(segment => ({
        text: segment.text,
        style: 'normal' as const,
        ...(segment.color ? { color: segment.color } : {}),
      })) ?? (line.prefix ? [{ text: line.prefix, style: 'normal' as const }] : [])),
      ...(branchPrefix ? [{ text: branchPrefix, style: 'muted' as const }] : []),
    ];
    const prefixWidth = stringWidth(prefixSegments.map(segment => segment.text).join(''));
    const wrapped = renderParagraph(line.content, options, baseIndent + prefixWidth);
    if (wrapped.length === 0) {
      lines.push({ segments: prefixSegments, indent: baseIndent });
      continue;
    }
    const first = wrapped[0];
    const contentSegments = line.color
      ? first.segments.map(segment =>
          segment.style === 'normal' ? { ...segment, color: line.color } : segment)
      : first.segments;
    lines.push({
      segments: [...prefixSegments, ...contentSegments],
      indent: baseIndent,
    });
    lines.push(...wrapped.slice(1));
  }
  return lines;
}

function renderQuote(
  block: Extract<MarkdownBlock, { type: 'quote' }>,
  options: MarkdownRenderOptions,
  indent: number,
): MarkdownLine[] {
  const prefix = options.unicode ? '┊ ' : '> ';
  const inner = block.blocks.flatMap(child => renderBlock(child, options, indent + 2));
  if (inner.length === 0) return [{ segments: [{ text: prefix, style: 'muted' }], indent }];
  return inner.map(line => ({
    segments: [{ text: prefix, style: 'muted' }, ...line.segments],
    indent,
  }));
}

function renderTable(
  block: Extract<MarkdownBlock, { type: 'table' }>,
  options: MarkdownRenderOptions,
  indent: number,
): MarkdownLine[] {
  const width = Math.min(88, Math.max(8, options.columns - indent));
  const columnCount = Math.max(1, block.header.length);
  const separator = options.unicode ? ' │ ' : ' | ';
  const separatorWidth = stringWidth(separator) * Math.max(0, columnCount - 1);
  if (options.columns < 64) {
    return block.rows.flatMap(row => row.map((cell, index) => {
      const label = block.header[index] ?? [{ type: 'text', content: `列 ${index + 1}` }];
      const labelSegments = restyle(inlineSegments(label, options), 'muted');
      const labelText = markdownLineText({ segments: labelSegments });
      const value = renderInlineCell(
        cell,
        Math.max(8, width - stringWidth(labelText) - 2),
        options,
      );
      return {
        segments: [
          ...labelSegments,
          { text: ': ', style: 'normal' as const },
          ...value,
        ],
        indent,
      };
    }));
  }
  const available = Math.max(columnCount, width - separatorWidth);
  const maxCellWidth = Math.max(6, Math.floor(available / columnCount));
  const naturalWidths = Array.from({ length: columnCount }, () => 0);
  const considerWidth = (cells: readonly (readonly MarkdownInline[])[]) => {
    cells.forEach((cell, index) => {
      if (index >= columnCount) return;
      const cellWidth = stringWidth(markdownLineText({
        segments: inlineSegments(cell, options),
      }));
      naturalWidths[index] = Math.max(naturalWidths[index], cellWidth);
    });
  };
  considerWidth(block.header);
  block.rows.forEach(considerWidth);
  const capped = naturalWidths.map(item => Math.min(item, maxCellWidth));
  const naturalTotal = capped.reduce((sum, item) => sum + item, 0);
  const columnWidths = naturalTotal <= available
    ? capped.map(item => Math.max(6, item))
    : capped.map(item => Math.max(6, Math.floor(item * available / naturalTotal)));
  if (naturalTotal > available) {
    let used = columnWidths.reduce((sum, item) => sum + item, 0);
    let remaining = available - used;
    const order = capped.map((item, index) => ({ item, index }))
      .sort((a, b) => b.item - a.item);
    let cursor = 0;
    while (remaining > 0 && cursor < order.length) {
      columnWidths[order[cursor].index] += 1;
      remaining -= 1;
      cursor += 1;
    }
  }
  const renderRow = (cells: readonly (readonly MarkdownInline[])[]) => {
    const segments: MarkdownSegment[] = [];
    for (let index = 0; index < columnCount; index += 1) {
      if (index > 0) segments.push({ text: separator, style: 'muted' });
      const content = renderInlineCell(cells[index] ?? [], columnWidths[index], options);
      const contentWidth = segmentWidth(content);
      segments.push(...content);
      if (contentWidth < columnWidths[index]) {
        segments.push({
          text: ' '.repeat(columnWidths[index] - contentWidth),
          style: 'normal',
        });
      }
    }
    return { segments: trimTrailingSpaces(segments), indent };
  };
  const tableWidth = columnWidths.reduce((sum, item) => sum + item, 0) + separatorWidth;
  return [
    renderRow(block.header),
    {
      segments: [{
        text: (options.unicode ? '─' : '-').repeat(Math.min(width, tableWidth)),
        style: 'muted',
      }],
      indent,
    },
    ...block.rows.map(renderRow),
  ];
}

function renderBlock(
  block: MarkdownBlock,
  options: MarkdownRenderOptions,
  indent: number,
): MarkdownLine[] {
  switch (block.type) {
    case 'heading': {
      const inner = inlineSegments(block.inline, options);
      return withIndent(
        wrapSegments(restyle(inner, 'heading'), Math.max(8, options.columns - indent)),
        indent,
      );
    }
    case 'paragraph':
      return renderParagraph(block.inline, options, indent);
    case 'code':
      return renderCode(block, options, indent);
    case 'list':
      return renderList(block, options, indent);
    case 'tree':
      return renderTree(block, options, indent);
    case 'quote':
      return renderQuote(block, options, indent);
    case 'table':
      return renderTable(block, options, indent);
    case 'hr':
      return [{
        segments: [{
          text: (options.unicode ? '─' : '-').repeat(
            Math.min(28, Math.max(8, options.columns - indent)),
          ),
          style: 'muted',
        }],
        indent,
      }];
    case 'html':
      return withIndent(
        wrapSegments(
          [{ text: block.content, style: 'muted' }],
          Math.max(8, options.columns - indent),
        ),
        indent,
      );
  }
}

export function renderMarkdown(
  ast: MarkdownAst,
  options: MarkdownRenderOptions,
): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  ast.blocks.forEach((block, index) => {
    if (index > 0) lines.push(BLANK_LINE);
    lines.push(...renderBlock(block, options, 0));
  });
  return lines;
}

export function markdownLineText(line: MarkdownLine): string {
  return line.segments.map(segment => segment.text).join('');
}
