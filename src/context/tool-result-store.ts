import { randomUUID, createHash } from 'node:crypto';
import {
  constants,
  lstatSync,
  realpathSync,
} from 'node:fs';
import {
  chmod,
  mkdir,
  open,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { PathGuard } from '../tool/path-guard.js';
import { CONTEXT_DIRECTORY } from './constants.js';
import type {
  StoredToolResult,
  ToolResultWriteInput,
} from './types.js';

interface StagedFile extends StoredToolResult {
  temporary: string;
  final: string;
}

function sanitizeToolName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '_').slice(0, 32) || 'tool';
}

export class ToolResultStore {
  private readonly rootDir: string;
  private sessionId = randomUUID();
  private sessionDirectory?: string;
  private sequence = 0;
  private closed = false;

  constructor(rootDir: string) {
    this.rootDir = new PathGuard(rootDir).rootDir;
  }

  async writeBatch(
    inputs: readonly ToolResultWriteInput[],
    signal: AbortSignal,
  ): Promise<StoredToolResult[]> {
    if (this.closed) throw new Error('上下文结果存储器已关闭');
    if (signal.aborted) throw new Error('上下文结果写入已取消');
    if (inputs.length === 0) return [];

    const directory = await this.ensureSessionDirectory();
    const staged: StagedFile[] = [];
    const committed: string[] = [];
    try {
      for (const input of inputs) {
        if (signal.aborted) throw new Error('上下文结果写入已取消');
        const content = Buffer.from(input.content, 'utf8');
        const sha256 = createHash('sha256').update(content).digest('hex');
        const sequence = String(++this.sequence).padStart(6, '0');
        const fileName = `${sequence}-${sanitizeToolName(input.toolName)}-${sha256.slice(0, 12)}.json`;
        const final = path.join(directory, fileName);
        const temporary = `${final}.${randomUUID()}.tmp`;
        const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY |
          (constants.O_NOFOLLOW ?? 0);
        const handle = await open(temporary, flags, 0o600);
        try {
          await handle.writeFile(content);
          await handle.sync();
        } finally {
          await handle.close();
        }
        staged.push({
          temporary,
          final,
          relativePath: this.relative(final),
          originalBytes: content.byteLength,
          sha256,
        });
      }

      for (const item of staged) {
        if (signal.aborted) throw new Error('上下文结果写入已取消');
        this.assertSafeDirectory(directory);
        await rename(item.temporary, item.final);
        await chmod(item.final, 0o600);
        committed.push(item.final);
      }
      return staged.map(({ relativePath, originalBytes, sha256 }) => ({
        relativePath,
        originalBytes,
        sha256,
      }));
    } catch (error) {
      await Promise.allSettled([
        ...staged.map(item => rm(item.temporary, { force: true })),
        ...committed.map(file => rm(file, { force: true })),
      ]);
      throw error;
    }
  }

  async clear(): Promise<void> {
    if (this.sessionDirectory) {
      await rm(this.sessionDirectory, { recursive: true, force: true });
    }
    this.sessionDirectory = undefined;
    this.sessionId = randomUUID();
    this.sequence = 0;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.clear();
    this.closed = true;
  }

  private async ensureSessionDirectory(): Promise<string> {
    if (this.sessionDirectory) {
      this.assertSafeDirectory(this.sessionDirectory);
      const toolResults = path.join(this.sessionDirectory, 'tool-results');
      this.assertSafeDirectory(toolResults);
      return toolResults;
    }

    let current = this.rootDir;
    for (const segment of [...CONTEXT_DIRECTORY.split('/'), `session-${this.sessionId}`, 'tool-results']) {
      current = path.join(current, segment);
      try {
        const stat = lstatSync(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new Error(`上下文目录不安全: ${this.relative(current)}`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await mkdir(current, { mode: 0o700 });
      }
      await chmod(current, 0o700);
      this.assertSafeDirectory(current);
    }
    this.sessionDirectory = path.dirname(current);
    return current;
  }

  private assertSafeDirectory(directory: string): void {
    const real = realpathSync(directory);
    const relative = path.relative(this.rootDir, real);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('上下文目录超出项目根目录');
    }
    if (lstatSync(directory).isSymbolicLink()) {
      throw new Error(`上下文目录不允许是符号链接: ${this.relative(directory)}`);
    }
  }

  private relative(absolute: string): string {
    return path.relative(this.rootDir, absolute).split(path.sep).join('/');
  }
}
