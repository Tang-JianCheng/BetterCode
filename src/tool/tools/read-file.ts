import { readFileSync, statSync } from 'node:fs';
import { ToolFailure } from '../errors.js';
import { truncateUtf8 } from '../output-limit.js';
import {
  createToolSuccess,
  type JsonObject,
  type Tool,
  type ToolContext,
} from '../types.js';
import { PathGuard } from '../path-guard.js';

export class ReadFileTool implements Tool {
  readonly name = 'read_file';
  readonly effect = 'read_only' as const;
  readonly permission = {
    targetArgument: 'path',
    targetKind: 'path',
    pathIntent: 'existing',
    risk: 'read',
  } as const;
  readonly description = '读取项目根目录内的 UTF-8 文本文件。读取文件优先使用本工具；编辑或覆盖现有文件前必须先读取当前内容';
  readonly inputSchema = {
    type: 'object',
    properties: { path: { type: 'string', minLength: 1 } },
    required: ['path'],
    additionalProperties: false,
  };

  constructor(private readonly pathGuard: PathGuard) {}

  async execute(input: JsonObject, context: ToolContext) {
    const filePath = input.path;
    if (typeof filePath !== 'string') {
      throw new ToolFailure('INVALID_ARGUMENTS', 'path 必须是字符串');
    }

    const target = this.pathGuard.resolveExisting(filePath);
    if (!statSync(target.absolute).isFile()) {
      throw new ToolFailure('FILE_NOT_FOUND', `目标不是普通文件: ${filePath}`);
    }

    const stat = statSync(target.absolute);
    const cached = context.executionState?.getFileRead(target.absolute, stat.size, stat.mtimeMs);
    const bytes = cached === undefined ? readFileSync(target.absolute) : Buffer.from(cached, 'utf8');
    let content: string;
    if (cached !== undefined) {
      content = cached;
    } else {
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new ToolFailure('NOT_TEXT_FILE', `文件不是有效的 UTF-8 文本: ${filePath}`);
      }
      context.executionState?.setFileRead({
        absolutePath: target.absolute,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        content,
      });
    }

    const limited = truncateUtf8(content, context.maxOutputBytes);
    return createToolSuccess(limited.value, {
      path: target.relative,
      bytes: bytes.byteLength,
      truncated: limited.truncated,
      cached: cached !== undefined,
    });
  }
}
