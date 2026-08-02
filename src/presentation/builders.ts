import type {
  ConversationPresentation,
  NoticePresentation,
  PresentationDocument,
} from './types.js';

const MAX_NOTICE_DETAILS = 20;

function requireTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error('展示标题不能为空');
  return title;
}

export function createDocument(
  input: Omit<PresentationDocument, 'kind'>,
): PresentationDocument {
  const title = requireTitle(input.title);
  for (const block of input.blocks) {
    if (block.type !== 'table') continue;
    if (block.columns.length === 0) throw new Error('表格至少需要一列');
    if (block.rows.some(row => row.length !== block.columns.length)) {
      throw new Error('表格行列数量不一致');
    }
  }
  return { ...input, title, kind: 'document' };
}

export function createNotice(input: Omit<NoticePresentation, 'kind'>): NoticePresentation {
  const title = requireTitle(input.title);
  if ((input.details?.length ?? 0) > MAX_NOTICE_DETAILS) {
    throw new Error(`通知详情不能超过 ${MAX_NOTICE_DETAILS} 条`);
  }
  return {
    ...input,
    title,
    ...(input.message?.trim() ? { message: input.message } : { message: undefined }),
    ...(input.details?.length ? { details: [...input.details] } : { details: undefined }),
    kind: 'notice',
  };
}

export function createConversation(
  input: Omit<ConversationPresentation, 'kind'>,
): ConversationPresentation {
  return { ...input, kind: 'conversation' };
}
