import fg from 'fast-glob';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ToolFailure } from '../errors.js';
import {
  createToolSuccess,
  type JsonObject,
  type Tool,
  type ToolContext,
} from '../types.js';
import { PathGuard } from '../path-guard.js';

const IGNORE = ['.git/**', 'node_modules/**', 'dist/**'];

function assertGlob(glob: string): void {
  if (path.isAbsolute(glob) || glob.split(/[\\/]+/).includes('..')) {
    throw new ToolFailure('PATH_OUTSIDE_ROOT', '搜索模式必须是项目内的相对模式');
  }
}

export class SearchCodeTool implements Tool {
  readonly name = 'search_code';
  readonly effect = 'read_only' as const;
  readonly description = '在项目内按文本或正则表达式搜索代码内容';
  readonly inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      glob: { type: 'string', minLength: 1, default: '**/*' },
      regex: { type: 'boolean', default: false },
      case_sensitive: { type: 'boolean', default: true },
    },
    required: ['query'],
    additionalProperties: false,
  };

  constructor(private readonly pathGuard: PathGuard) {}

  async execute(input: JsonObject, context: ToolContext) {
    const query = input.query;
    const pattern = input.glob === undefined ? '**/*' : input.glob;
    const regexMode = input.regex === true;
    const caseSensitive = input.case_sensitive !== false;
    if (typeof query !== 'string' || typeof pattern !== 'string') {
      throw new ToolFailure('INVALID_ARGUMENTS', 'query 和 glob 必须是字符串');
    }
    assertGlob(pattern);

    let matcher: RegExp | undefined;
    if (regexMode) {
      try {
        matcher = new RegExp(query, caseSensitive ? '' : 'i');
      } catch (error) {
        throw new ToolFailure('INVALID_ARGUMENTS', `正则表达式无效: ${(error as Error).message}`);
      }
    }

    const files = await fg(pattern, {
      cwd: context.rootDir,
      absolute: false,
      onlyFiles: true,
      dot: true,
      followSymbolicLinks: false,
      unique: true,
      ignore: IGNORE,
    });
    files.sort();

    const matches: string[] = [];
    for (const relativePath of files) {
      let guardedPath: { absolute: string };
      try {
        guardedPath = this.pathGuard.resolveExisting(relativePath);
      } catch {
        continue;
      }
      const absolutePath = guardedPath.absolute;
      let content: string;
      try {
        const bytes = await readFile(absolutePath);
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const found = matcher
          ? matcher.test(line)
          : (caseSensitive ? line.includes(query) : line.toLowerCase().includes(query.toLowerCase()));
        if (matcher) matcher.lastIndex = 0;
        if (found) matches.push(`${relativePath}:${index + 1}:${line}`);
      }
    }

    return createToolSuccess(matches.join('\n'), {
      count: matches.length,
      pattern,
      query,
    });
  }
}
