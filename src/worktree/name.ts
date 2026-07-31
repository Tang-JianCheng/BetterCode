import { WorktreeError } from './types.js';

export const MAX_WORKTREE_NAME_LENGTH = 120;
export const MAX_WORKTREE_SEGMENT_LENGTH = 48;

const SEGMENT = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9_-])?$/u;

export function validateWorktreeName(input: string): string {
  if (typeof input !== 'string' || !input || input.length > MAX_WORKTREE_NAME_LENGTH) {
    throw new WorktreeError('INVALID_NAME', 'Worktree 名称长度必须为 1 到 120 个字符');
  }
  if (/[/]{2}|[\\\u0000-\u001F\u007F]/u.test(input) || input.includes('@{') || input.includes('..')) {
    throw new WorktreeError('INVALID_NAME', `Worktree 名称包含非法字符: ${input}`);
  }
  const segments = input.split('/');
  for (const segment of segments) {
    if (!segment || segment.length > MAX_WORKTREE_SEGMENT_LENGTH || segment === '.' || segment === '..' ||
        segment.endsWith('.lock') || !SEGMENT.test(segment)) {
      throw new WorktreeError('INVALID_NAME', `Worktree 名称段无效: ${segment || '(空)'}`);
    }
  }
  return input;
}
