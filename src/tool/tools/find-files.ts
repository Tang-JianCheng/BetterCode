import fg from 'fast-glob';
import path from 'node:path';
import { ToolFailure } from '../errors.js';
import {
  createToolSuccess,
  type JsonObject,
  type Tool,
  type ToolContext,
} from '../types.js';
import { PathGuard } from '../path-guard.js';

const IGNORE = ['.git/**', 'node_modules/**', 'dist/**'];

function assertPattern(pattern: string): void {
  if (!pattern || path.isAbsolute(pattern) || pattern.split(/[\\/]+/).includes('..')) {
    throw new ToolFailure('PATH_OUTSIDE_ROOT', '查找模式必须是项目内的相对模式');
  }
}

export class FindFilesTool implements Tool {
  readonly name = 'find_files';
  readonly effect = 'read_only' as const;
  readonly description = '按 glob 模式查找项目根目录内的文件和目录';
  readonly inputSchema = {
    type: 'object',
    properties: { pattern: { type: 'string', minLength: 1 } },
    required: ['pattern'],
    additionalProperties: false,
  };

  constructor(private readonly pathGuard: PathGuard) {}

  async execute(input: JsonObject, context: ToolContext) {
    const pattern = input.pattern;
    if (typeof pattern !== 'string') {
      throw new ToolFailure('INVALID_ARGUMENTS', 'pattern 必须是字符串');
    }
    assertPattern(pattern);

    const matches = await fg(pattern, {
      cwd: context.rootDir,
      absolute: false,
      onlyFiles: false,
      dot: true,
      followSymbolicLinks: false,
      unique: true,
      ignore: IGNORE,
    });
    const safeMatches = matches
      .filter(match => {
        try {
          this.pathGuard.resolveExisting(match);
          return true;
        } catch {
          return false;
        }
      })
      .sort();
    return createToolSuccess(safeMatches.join('\n'), {
      count: safeMatches.length,
      pattern,
    });
  }
}
