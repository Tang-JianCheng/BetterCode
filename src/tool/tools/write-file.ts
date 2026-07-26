import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ToolFailure } from '../errors.js';
import {
  createToolSuccess,
  type JsonObject,
  type Tool,
  type ToolContext,
} from '../types.js';
import { PathGuard } from '../path-guard.js';

export class WriteFileTool implements Tool {
  readonly name = 'write_file';
  readonly effect = 'side_effect' as const;
  readonly permission = {
    targetArgument: 'path',
    targetKind: 'path',
    pathIntent: 'write',
    risk: 'write',
  } as const;
  readonly description = '创建或完整覆盖项目根目录内的 UTF-8 文本文件。覆盖现有文件前必须先读取当前内容，不得用命令绕过目录约束';
  readonly inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  };

  constructor(private readonly pathGuard: PathGuard) {}

  async execute(input: JsonObject, _context: ToolContext) {
    const filePath = input.path;
    const content = input.content;
    if (typeof filePath !== 'string' || typeof content !== 'string') {
      throw new ToolFailure('INVALID_ARGUMENTS', 'path 和 content 必须是字符串');
    }

    const target = this.pathGuard.resolveForWrite(filePath);
    try {
      if (statSync(target.absolute, { throwIfNoEntry: false })?.isDirectory()) {
        throw new ToolFailure('EXECUTION_ERROR', `目标是目录，无法写入: ${filePath}`);
      }
      mkdirSync(path.dirname(target.absolute), { recursive: true });
      writeFileSync(target.absolute, content, 'utf8');
    } catch (error) {
      if (error instanceof ToolFailure) throw error;
      throw new ToolFailure('EXECUTION_ERROR', `写入文件失败: ${filePath}`);
    }

    return createToolSuccess('', {
      path: target.relative,
      bytesWritten: Buffer.byteLength(content, 'utf8'),
    });
  }
}
