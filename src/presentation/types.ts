import type { MarkdownAst } from '../markdown/types.js';

export type PresentationTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface PresentationEntry {
  label: string;
  value: string;
  tone?: PresentationTone;
}

export interface PresentationColumn {
  key: string;
  label: string;
  priority?: number;
}

export type PresentationBlock =
  | { type: 'text'; content: string; muted?: boolean; heading?: boolean }
  | { type: 'key_value'; entries: readonly PresentationEntry[]; columns?: 1 | 2 }
  | {
      type: 'table';
      columns: readonly PresentationColumn[];
      rows: readonly (readonly string[])[];
    }
  | { type: 'list'; items: readonly string[]; ordered?: boolean }
  | { type: 'divider' };

export interface PresentationDocument {
  kind: 'document';
  source: 'command' | 'system' | 'agent' | 'team';
  title: string;
  tone: PresentationTone;
  badge?: string;
  blocks: readonly PresentationBlock[];
  footer?: string;
  /** 展示前解析好的 Markdown AST，供 MarkdownView 统一渲染 */
  markdown?: MarkdownAst;
}

export interface ConversationPresentation {
  kind: 'conversation';
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  /** 助手最终回复解析后的 Markdown AST；流式与用户消息不携带 */
  markdown?: MarkdownAst;
}

export interface NoticePresentation {
  kind: 'notice';
  tone: PresentationTone;
  title: string;
  message?: string;
  details?: readonly string[];
  source?: string;
  /** 展示前解析好的 Markdown AST，供 MarkdownView 统一渲染 */
  markdown?: MarkdownAst;
}

export type PresentationItem =
  | ConversationPresentation
  | PresentationDocument
  | NoticePresentation;

export interface IdentifiedPresentation {
  id: string;
  item: PresentationItem;
}
