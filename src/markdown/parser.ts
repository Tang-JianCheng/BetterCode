import { lexer, type Token, type Tokens } from 'marked';
import type {
  MarkdownAst,
  MarkdownBlock,
  MarkdownInline,
  MarkdownListItem,
} from './types.js';

const ANSI_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)|\(B|[PQRSTUVWX]|.)/gu;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

export function sanitizeText(value: string): string {
  const text = String(value);
  return text
    .replace(ANSI_PATTERN, '')
    .replace(CONTROL_PATTERN, '');
}

function parseInlineToken(token: Token): MarkdownInline[] {
  switch (token.type) {
    case 'text':
    case 'escape':
      return [{ type: 'text', content: sanitizeText(token.text) }];
    case 'strong':
      return [{ type: 'strong', children: (token.tokens ?? []).flatMap(parseInlineToken) }];
    case 'em':
      return [{ type: 'em', children: (token.tokens ?? []).flatMap(parseInlineToken) }];
    case 'del':
      return [{ type: 'del', children: (token.tokens ?? []).flatMap(parseInlineToken) }];
    case 'codespan':
      return [{ type: 'code', content: sanitizeText(token.text) }];
    case 'link':
      return [{
        type: 'link',
        href: sanitizeText(token.href),
        children: (token.tokens ?? []).flatMap(parseInlineToken),
      }];
    case 'image':
      return [{ type: 'image', alt: sanitizeText(token.text), src: sanitizeText(token.href) }];
    case 'checkbox':
      return [{ type: 'checkbox', checked: token.checked }];
    case 'br':
      return [{ type: 'br' }];
    case 'html':
      return [{ type: 'text', content: sanitizeText(token.text) }];
    default:
      return [{ type: 'text', content: sanitizeText(token.raw) }];
  }
}

function parseBlockToken(token: Token): MarkdownBlock[] {
  switch (token.type) {
    case 'space':
    case 'def':
      return [];
    case 'heading':
      return [{
        type: 'heading',
        level: Math.min(6, Math.max(1, token.depth)) as 1 | 2 | 3 | 4 | 5 | 6,
        inline: (token.tokens ?? []).flatMap(parseInlineToken),
      }];
    case 'paragraph':
      return [{ type: 'paragraph', inline: (token.tokens ?? []).flatMap(parseInlineToken) }];
    case 'code':
      return [{
        type: 'code',
        ...(token.lang?.trim() ? { language: sanitizeText(token.lang.trim()) } : {}),
        content: sanitizeText(token.text),
      }];
    case 'blockquote':
      return [{ type: 'quote', blocks: (token.tokens ?? []).flatMap(parseBlockToken) }];
    case 'list': {
      const list = token as Tokens.List;
      const items: MarkdownListItem[] = list.items.map(item => ({
        blocks: item.tokens.flatMap(parseBlockToken),
      }));
      return [{
        type: 'list',
        ordered: list.ordered,
        start: typeof list.start === 'number' ? list.start : 1,
        items,
      }];
    }
    case 'table': {
      const table = token as Tokens.Table;
      return [{
        type: 'table',
        header: table.header.map(cell => sanitizeText(cell.text)),
        rows: table.rows.map(row => row.map(cell => sanitizeText(cell.text))),
      }];
    }
    case 'hr':
      return [{ type: 'hr' }];
    case 'html':
      return [{ type: 'html', content: sanitizeText(token.text) }];
    default:
      return [{ type: 'paragraph', inline: [{ type: 'text', content: sanitizeText(token.raw) }] }];
  }
}

export interface MarkdownParseResult {
  ast: MarkdownAst;
  /** 解析异常时回退为单段落原文，并由调用方决定是否提示 */
  recovered: boolean;
}

function fallbackContent(source: string): string {
  try {
    return sanitizeText(source);
  } catch {
    try {
      return typeof source === 'string' ? source : String(source);
    } catch {
      return '';
    }
  }
}

export function tryParseMarkdown(source: string): MarkdownParseResult {
  try {
    return {
      ast: { blocks: lexer(source, { gfm: true, breaks: false }).flatMap(parseBlockToken) },
      recovered: false,
    };
  } catch {
    return {
      ast: { blocks: [{ type: 'paragraph', inline: [{ type: 'text', content: fallbackContent(source) }] }] },
      recovered: true,
    };
  }
}

export function parseMarkdown(source: string): MarkdownAst {
  return tryParseMarkdown(source).ast;
}
