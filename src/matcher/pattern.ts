import { Minimatch } from 'minimatch';

export type PatternSyntax = 'auto' | 'exact' | 'glob' | 'regex';
export type PatternTargetMode = 'path' | 'literal';

export interface CompiledPattern {
  kind: 'exact' | 'glob' | 'regex';
  literalLength: number;
  matches(value: string): boolean;
}

export class PatternCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatternCompileError';
  }
}

function protectSlashes(value: string, mode: PatternTargetMode): string {
  return mode === 'literal' ? value.replaceAll('/', '\uE000') : value;
}

function literalLength(pattern: string): number {
  let length = 0;
  let escaped = false;
  for (const character of pattern) {
    if (escaped) {
      length += 1;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (!'*?[]'.includes(character)) {
      length += 1;
    }
  }
  if (escaped) length += 1;
  return length;
}

export function compilePattern(input: {
  pattern: string;
  syntax: PatternSyntax;
  targetMode: PatternTargetMode;
}): CompiledPattern {
  if (!input.pattern.length) throw new PatternCompileError('匹配模式不能为空');

  if (input.syntax === 'exact') {
    return {
      kind: 'exact',
      literalLength: [...input.pattern].length,
      matches: value => value === input.pattern,
    };
  }

  if (input.syntax === 'regex') {
    let expression: RegExp;
    try {
      expression = new RegExp(input.pattern, 'u');
    } catch (error) {
      throw new PatternCompileError(
        `正则表达式无效: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {
      kind: 'regex',
      literalLength: [...input.pattern].length,
      matches: value => expression.test(value),
    };
  }

  let matcher: Minimatch;
  try {
    matcher = new Minimatch(protectSlashes(input.pattern, input.targetMode), {
      dot: true,
      matchBase: false,
      nocase: false,
      nobrace: true,
      nocomment: true,
      noext: true,
      nonegate: true,
      windowsPathsNoEscape: false,
    });
  } catch (error) {
    throw new PatternCompileError(
      `glob 无效: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const kind = input.syntax === 'glob' || matcher.hasMagic() ? 'glob' : 'exact';
  return {
    kind,
    literalLength: literalLength(input.pattern),
    matches: value => matcher.match(protectSlashes(value, input.targetMode)),
  };
}
