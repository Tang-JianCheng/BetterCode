import { readFileSync, writeFileSync } from 'node:fs';
import { ToolFailure } from '../errors.js';
import {
  createToolSuccess,
  type JsonObject,
  type Tool,
  type ToolContext,
} from '../types.js';
import { PathGuard } from '../path-guard.js';

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = value.indexOf(search, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + search.length;
  }
}

export class EditFileTool implements Tool {
  readonly name = 'edit_file';
  readonly effect = 'side_effect' as const;
  readonly permission = {
    targetArgument: 'path',
    targetKind: 'path',
    pathIntent: 'existing',
    risk: 'write',
  } as const;
  readonly description = '仅在原文唯一匹配时修改项目根目录内的文本文件。调用前必须先读取当前内容并使用读取到的唯一原文，不得用命令替代编辑';
  readonly inputSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      old_text: { type: 'string', minLength: 1 },
      new_text: { type: 'string' },
    },
    required: ['path', 'old_text', 'new_text'],
    additionalProperties: false,
  };

  constructor(private readonly pathGuard: PathGuard) {}

  async execute(input: JsonObject, _context: ToolContext) {
    const filePath = input.path;
    const oldText = input.old_text;
    const newText = input.new_text;
    if (
      typeof filePath !== 'string' ||
      typeof oldText !== 'string' ||
      typeof newText !== 'string' ||
      oldText.length === 0
    ) {
      throw new ToolFailure('INVALID_ARGUMENTS', 'path、old_text 和 new_text 参数无效');
    }

    const target = this.pathGuard.resolveExisting(filePath);
    const original = readFileSync(target.absolute, 'utf8');
    const matches = countOccurrences(original, oldText);
    if (matches === 0) {
      throw new ToolFailure('MATCH_NOT_FOUND', `原文未找到: ${filePath}`);
    }
    if (matches > 1) {
      throw new ToolFailure('MATCH_NOT_UNIQUE', `原文匹配了 ${matches} 次: ${filePath}`);
    }

    writeFileSync(target.absolute, original.replace(oldText, newText), 'utf8');
    return createToolSuccess('', {
      path: target.relative,
      replacements: 1,
    });
  }
}
