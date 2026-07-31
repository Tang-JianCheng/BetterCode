import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

export const COMPACT_BOUNDARY = 'compact_boundary';
export const SUBAGENT_RESULT = 'subagent_result';
export const SESSION_EXPIRY_DAYS = 30;
const SESSION_DIRECTORY = '.bettercode/sessions';
const SESSION_ID_PATTERN = /^[a-z0-9]+-[a-f0-9]{8}$/u;

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  type?: typeof COMPACT_BOUNDARY | typeof SUBAGENT_RESULT;
  toolUseId?: string;
}

export interface KeptMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompactBoundaryPayload {
  summary: string;
  keep: KeptMessage[];
}

export interface SessionInfo {
  id: string;
  firstMessage: string;
  messageCount: number;
  size: number;
  modTime: Date;
}

export type RestoredMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'instruction'; instructionKind: typeof SUBAGENT_RESULT; content: string };

export function newSessionId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function sessionsDir(workDir: string): string {
  return path.join(path.resolve(workDir), SESSION_DIRECTORY);
}

function assertSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error('会话 ID 格式无效');
}

export function getSessionFilePath(workDir: string, sessionId: string): string {
  assertSessionId(sessionId);
  return path.join(sessionsDir(workDir), `${sessionId}.jsonl`);
}

export function saveMessage(
  workDir: string,
  sessionId: string,
  message: SessionMessage,
): void {
  if (!message.content || !message.timestamp) return;
  const directory = sessionsDir(workDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const file = getSessionFilePath(workDir, sessionId);
  appendFileSync(file, `${JSON.stringify(message)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(file, 0o600);
}

export function saveCompactBoundary(
  workDir: string,
  sessionId: string,
  payload: CompactBoundaryPayload,
): void {
  saveMessage(workDir, sessionId, {
    role: 'system',
    content: JSON.stringify(payload),
    timestamp: new Date().toISOString(),
    type: COMPACT_BOUNDARY,
  });
}

export function saveSubAgentResult(
  workDir: string,
  sessionId: string,
  content: string,
): void {
  saveMessage(workDir, sessionId, {
    role: 'system',
    content,
    timestamp: new Date().toISOString(),
    type: SUBAGENT_RESULT,
  });
}

function parseMessage(line: string): SessionMessage | undefined {
  try {
    const value = JSON.parse(line) as Partial<SessionMessage>;
    if (value.role !== 'user' && value.role !== 'assistant' && value.role !== 'system') return undefined;
    if (typeof value.content !== 'string' || value.content.length === 0) return undefined;
    if (typeof value.timestamp !== 'string' || !value.timestamp) return undefined;
    if (value.role === 'system') {
      if (value.type !== COMPACT_BOUNDARY && value.type !== SUBAGENT_RESULT) return undefined;
    } else if (value.type !== undefined) {
      return undefined;
    }
    return value as SessionMessage;
  } catch {
    return undefined;
  }
}

export function loadSession(workDir: string, sessionId: string): SessionMessage[] {
  let file: string;
  try {
    file = getSessionFilePath(workDir, sessionId);
  } catch {
    return [];
  }
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .map(parseMessage)
      .filter((message): message is SessionMessage => message !== undefined);
  } catch {
    return [];
  }
}

function parseBoundary(message: SessionMessage): CompactBoundaryPayload | undefined {
  try {
    const value = JSON.parse(message.content) as Partial<CompactBoundaryPayload>;
    if (typeof value.summary !== 'string' || !value.summary.trim() || !Array.isArray(value.keep)) {
      return undefined;
    }
    const keep = value.keep.filter((item): item is KeptMessage =>
      typeof item === 'object' && item !== null &&
      ((item as KeptMessage).role === 'user' || (item as KeptMessage).role === 'assistant') &&
      typeof (item as KeptMessage).content === 'string' &&
      Boolean((item as KeptMessage).content));
    return { summary: value.summary, keep };
  } catch {
    return undefined;
  }
}

export function rebuildFromSession(saved: readonly SessionMessage[]): RestoredMessage[] {
  let boundaryIndex = -1;
  let boundary: CompactBoundaryPayload | undefined;
  for (let index = saved.length - 1; index >= 0; index -= 1) {
    if (saved[index].type !== COMPACT_BOUNDARY) continue;
    const parsed = parseBoundary(saved[index]);
    if (!parsed) continue;
    boundaryIndex = index;
    boundary = parsed;
    break;
  }

  if (!boundary) {
    return saved.flatMap(message => restoreMessage(message));
  }

  const summary = [
    '本次会话延续自之前的对话，因上下文空间不足进行了压缩。以下是早期对话的摘要：',
    boundary.summary,
    ...(boundary.keep.length > 0 ? ['近期消息已原样保留。'] : []),
  ].join('\n\n');
  const afterBoundary = saved.slice(boundaryIndex + 1).flatMap(message => restoreMessage(message));
  return [
    { role: 'user', content: summary },
    ...boundary.keep,
    ...afterBoundary,
  ];
}

function restoreMessage(message: SessionMessage): RestoredMessage[] {
  if (message.role === 'user' || message.role === 'assistant') {
    return [{ role: message.role, content: message.content }];
  }
  if (message.role === 'system' && message.type === SUBAGENT_RESULT) {
    return [{ role: 'instruction', instructionKind: SUBAGENT_RESULT, content: message.content }];
  }
  return [];
}

export function listSessions(workDir: string): SessionInfo[] {
  const directory = sessionsDir(workDir);
  try {
    return readdirSync(directory)
      .filter(name => name.endsWith('.jsonl'))
      .flatMap(name => {
        try {
          const id = name.slice(0, -'.jsonl'.length);
          assertSessionId(id);
          const file = path.join(directory, name);
          const stat = statSync(file);
          const messages = loadSession(workDir, id);
          const firstMessage = messages.find(message =>
            message.role === 'user' && message.content.trim())?.content.slice(0, 100) ?? '';
          return [{
            id,
            firstMessage,
            messageCount: messages.length,
            size: stat.size,
            modTime: stat.mtime,
          }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.modTime.getTime() - left.modTime.getTime());
  } catch {
    return [];
  }
}

export function cleanExpiredSessions(workDir: string, now = Date.now()): number {
  const directory = sessionsDir(workDir);
  const expiryMs = SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1_000;
  let removed = 0;
  try {
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(directory, name);
      try {
        if (now - statSync(file).mtimeMs <= expiryMs) continue;
        rmSync(file, { force: true });
        removed += 1;
      } catch {
        // 单个损坏存档不影响其他会话清理。
      }
    }
  } catch {
    return 0;
  }
  return removed;
}
