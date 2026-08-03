export type MarkdownInline =
  | { type: 'text'; content: string }
  | { type: 'strong'; children: readonly MarkdownInline[] }
  | { type: 'em'; children: readonly MarkdownInline[] }
  | { type: 'del'; children: readonly MarkdownInline[] }
  | { type: 'code'; content: string }
  | { type: 'link'; href: string; children: readonly MarkdownInline[] }
  | { type: 'image'; alt: string; src: string }
  | { type: 'checkbox'; checked: boolean }
  | { type: 'br' };

export interface MarkdownListItem {
  blocks: readonly MarkdownBlock[];
}

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inline: readonly MarkdownInline[] }
  | { type: 'paragraph'; inline: readonly MarkdownInline[] }
  | { type: 'code'; language?: string; content: string }
  | { type: 'list'; ordered: boolean; start: number; items: readonly MarkdownListItem[] }
  | { type: 'quote'; blocks: readonly MarkdownBlock[] }
  | {
      type: 'table';
      header: readonly (readonly MarkdownInline[])[];
      rows: readonly (readonly (readonly MarkdownInline[])[])[];
    }
  | { type: 'hr' }
  | { type: 'html'; content: string };

export interface MarkdownAst {
  blocks: readonly MarkdownBlock[];
}

export type MarkdownSegmentStyle =
  | 'normal'
  | 'bold'
  | 'dim'
  | 'accent'
  | 'code'
  | 'link'
  | 'heading'
  | 'muted';

export interface MarkdownSegment {
  text: string;
  style: MarkdownSegmentStyle;
}

export interface MarkdownLine {
  segments: readonly MarkdownSegment[];
  indent?: number;
}

export interface MarkdownRenderOptions {
  columns: number;
  unicode: boolean;
  color: boolean;
}
