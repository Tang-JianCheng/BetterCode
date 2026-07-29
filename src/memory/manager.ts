import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';

export const MAX_ENTRYPOINT_LINES = 200;
export const MAX_ENTRYPOINT_BYTES = 25_000;
const MEMORY_INDEX = 'MEMORY.md';
const MAX_SELECTOR_CANDIDATES = 50;
const MAX_RELEVANT_MEMORIES = 5;

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';
export type MemoryScope = 'user' | 'project';

export interface MemoryFile {
  path: string;
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  scope: MemoryScope;
}

export interface MemoryHeader {
  filename: string;
  filePath: string;
  scope: MemoryScope;
  mtimeMs: number;
  description: string;
  type: MemoryType;
}

export interface RelevantMemory {
  path: string;
  mtimeMs: number;
}

export interface MemoryManagerOptions {
  userHome?: string;
}

export interface MemoryWriteInput {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
}

function isMemoryType(value: unknown): value is MemoryType {
  return value === 'user' || value === 'feedback' || value === 'project' || value === 'reference';
}

function parseFrontmatter(file: string, scope: MemoryScope): MemoryFile | undefined {
  try {
    const raw = readFileSync(file, 'utf8');
    if (!raw.startsWith('---')) return undefined;
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(raw);
    if (!match) return undefined;
    const metadata = parseYaml(match[1]) as Record<string, unknown> | null;
    const nested = metadata?.metadata;
    const nestedMetadata = typeof nested === 'object' && nested !== null
      ? nested as Record<string, unknown>
      : {};
    const name = typeof metadata?.name === 'string' && metadata.name.trim()
      ? metadata.name.trim()
      : path.basename(file, '.md');
    const description = typeof metadata?.description === 'string'
      ? metadata.description.trim()
      : '';
    const rawType = metadata?.type ?? nestedMetadata.type;
    const type = isMemoryType(rawType) ? rawType : scope === 'project' ? 'project' : 'user';
    return {
      path: file,
      name,
      description,
      type,
      content: match[2].trim(),
      scope,
    };
  } catch {
    return undefined;
  }
}

function scanMarkdown(directory: string, scope: MemoryScope): MemoryFile[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== MEMORY_INDEX) {
        files.push(path.join(directory, entry.name));
      } else if (entry.isDirectory()) {
        for (const nested of readdirSync(path.join(directory, entry.name), { withFileTypes: true })) {
          if (nested.isFile() && nested.name.endsWith('.md') && nested.name !== MEMORY_INDEX) {
            files.push(path.join(directory, entry.name, nested.name));
          }
        }
      }
    }
  } catch {
    return [];
  }
  return files.flatMap(file => {
    const memory = parseFrontmatter(file, scope);
    return memory ? [memory] : [];
  });
}

function safeFilename(name: string): string {
  const safe = name.trim()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  if (!safe || safe.toUpperCase() === 'MEMORY') throw new Error('记忆名称无效');
  return `${safe}.md`;
}

function serializeMemory(input: MemoryWriteInput): string {
  return [
    '---',
    `name: ${JSON.stringify(input.name)}`,
    `description: ${JSON.stringify(input.description)}`,
    `type: ${input.type}`,
    '---',
    input.content.trim(),
    '',
  ].join('\n');
}

export class MemoryManager {
  readonly projectDir: string;
  readonly userDir: string;

  constructor(
    readonly workDir: string,
    options: MemoryManagerOptions = {},
  ) {
    this.workDir = path.resolve(workDir);
    this.projectDir = path.join(this.workDir, '.bettercode/memory');
    this.userDir = path.join(path.resolve(options.userHome ?? homedir()), '.bettercode/memory');
  }

  loadAll(): MemoryFile[] {
    return [
      ...scanMarkdown(this.userDir, 'user'),
      ...scanMarkdown(this.projectDir, 'project'),
    ];
  }

  getMemories(): MemoryFile[] {
    return this.loadAll();
  }

  buildSystemReminder(): string {
    const memories = this.loadAll().sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    if (memories.length === 0) return '';
    return [
      'Active memories（需要正文时请使用文件读取工具重新读取对应路径）:',
      ...memories.map(memory =>
        `- [${memory.name}] (${memory.type}): ${memory.description || '无描述'}`),
    ].join('\n');
  }

  saveMemory(input: MemoryWriteInput): string {
    const scope: MemoryScope = input.type === 'project' || input.type === 'reference'
      ? 'project'
      : 'user';
    const directory = scope === 'project' ? this.projectDir : this.userDir;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, safeFilename(input.name));
    writeFileSync(file, serializeMemory(input), { encoding: 'utf8', mode: 0o600 });
    this.rebuildIndex();
    return file;
  }

  rebuildIndex(): void {
    const memories = this.loadAll().sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    mkdirSync(this.projectDir, { recursive: true, mode: 0o700 });
    const lines: string[] = [];
    let bytes = 0;
    for (const memory of memories) {
      if (lines.length >= MAX_ENTRYPOINT_LINES) break;
      const relative = memory.scope === 'project'
        ? path.relative(this.projectDir, memory.path).split(path.sep).join('/')
        : `~/.bettercode/memory/${path.relative(this.userDir, memory.path).split(path.sep).join('/')}`;
      const line = `- [${memory.name}](${relative}) — ${memory.description || '无描述'}`;
      const nextBytes = Buffer.byteLength(`${line}\n`, 'utf8');
      if (bytes + nextBytes > MAX_ENTRYPOINT_BYTES) break;
      lines.push(line);
      bytes += nextBytes;
    }
    writeFileSync(path.join(this.projectDir, MEMORY_INDEX), `${lines.join('\n')}${lines.length ? '\n' : ''}`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  clear(): void {
    for (const directory of [this.userDir, this.projectDir]) {
      try {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            rmSync(path.join(directory, entry.name), { force: true });
          }
        }
      } catch {
        // 某个记忆作用域不可读时不影响另一个作用域。
      }
    }
  }

  async findRelevantMemories(
    query: string,
    provider: LLMProvider,
    recentTools: string[] = [],
    alreadySurfaced: Set<string> = new Set(),
  ): Promise<RelevantMemory[]> {
    const headers = this.loadAll()
      .flatMap(memory => {
        try {
          return [{
            filename: path.basename(memory.path),
            filePath: memory.path,
            scope: memory.scope,
            mtimeMs: statSync(memory.path).mtimeMs,
            description: memory.description,
            type: memory.type,
          } satisfies MemoryHeader];
        } catch {
          return [];
        }
      })
      .filter(header => !alreadySurfaced.has(header.filePath))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, MAX_SELECTOR_CANDIDATES);
    if (!query.trim() || headers.length === 0) return [];
    const request: ProviderRequest = {
      systemPrompt: [
        '你是 BetterCode 的记忆选择器。只从候选清单选择与查询直接相关的记忆。',
        `最多选择 ${MAX_RELEVANT_MEMORIES} 条，只输出 JSON：{"paths":["绝对路径"]}。`,
        '禁止调用工具，不得输出候选清单之外的路径。',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: JSON.stringify({ query, recentTools, candidates: headers }),
      }],
      tools: [],
      maxOutputTokens: 1_024,
    };
    let text = '';
    let valid = true;
    let done = false;
    try {
      await provider.chat(request, (event: StreamEvent) => {
        if (event.type === 'text_delta') text += event.content;
        else if (event.type === 'done') done = true;
        else if (event.type === 'error' || event.type === 'tool_call') valid = false;
      });
      if (!valid || !done) return [];
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return [];
      const parsed = JSON.parse(text.slice(start, end + 1)) as { paths?: unknown };
      if (!Array.isArray(parsed.paths)) return [];
      const allowed = new Map(headers.map(header => [header.filePath, header]));
      return parsed.paths
        .filter((value): value is string => typeof value === 'string' && allowed.has(value))
        .slice(0, MAX_RELEVANT_MEMORIES)
        .map(file => ({ path: file, mtimeMs: allowed.get(file)!.mtimeMs }));
    } catch {
      return [];
    }
  }
}
