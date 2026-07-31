import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { HookLogEntry, HookLogger } from './types.js';

const MAX_LOG_BYTES = 2048;

function sanitize(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)) {
    result = result.replaceAll(secret, '[REDACTED]');
  }
  return result.replace(/[\r\n\t\u0000-\u001F\u007F]+/gu, ' ');
}

export class JsonlHookLogger implements HookLogger {
  private queue: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(rootDir: string, private readonly secrets: readonly string[] = []) {
    this.file = path.join(rootDir, '.bettercode', 'logs', 'hooks.jsonl');
  }

  write(entry: HookLogEntry): void {
    const safe = {
      ...entry,
      source: { ...entry.source, file: sanitize(entry.source.file, this.secrets).slice(0, 500) },
      message: sanitize(entry.message, this.secrets),
    };
    let line = `${JSON.stringify(safe)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_LOG_BYTES) {
      safe.message = Buffer.from(safe.message, 'utf8')
        .subarray(0, Math.max(0, MAX_LOG_BYTES - 1024))
        .toString('utf8');
      line = `${JSON.stringify(safe)}\n`;
      if (Buffer.byteLength(line, 'utf8') > MAX_LOG_BYTES) {
        line = `${JSON.stringify({ ...safe, message: 'Hook 日志内容已截断' })}\n`;
      }
    }
    this.queue = this.queue.then(async () => {
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        await appendFile(this.file, line, 'utf8');
      } catch {
        // 钩子日志失败不能反向影响 Agent。
      }
    });
  }

  async close(): Promise<void> {
    await this.queue.catch(() => {});
  }
}
