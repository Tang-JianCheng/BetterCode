import { escape } from 'minimatch';
import { compilePattern as compileTextPattern, PatternCompileError } from '../matcher/pattern.js';
import type { PermissionTargetKind } from '../tool/types.js';
import { isMcpToolName } from '../mcp/naming.js';
import type {
  PermissionPatternKind,
  PermissionRule,
  PermissionRuleLayer,
  RawPermissionRule,
} from './types.js';

export class PermissionRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionRuleError';
  }
}

function parseExpression(expression: string): { toolName: string; pattern?: string } {
  const trimmed = expression.trim();
  if (!trimmed) throw new PermissionRuleError('权限规则表达式不能为空');

  const openIndex = trimmed.indexOf('(');
  if (openIndex === -1) {
    if (trimmed.includes(')')) throw new PermissionRuleError(`权限规则括号不完整: ${expression}`);
    return { toolName: trimmed };
  }

  if (!trimmed.endsWith(')')) {
    throw new PermissionRuleError(`权限规则括号不完整: ${expression}`);
  }

  const toolName = trimmed.slice(0, openIndex).trim();
  const pattern = trimmed.slice(openIndex + 1, -1);
  if (!pattern) throw new PermissionRuleError(`权限规则模式不能为空: ${expression}`);
  return { toolName, pattern };
}

function compilePermissionPattern(pattern: string, targetKind: PermissionTargetKind): {
  kind: Exclude<PermissionPatternKind, 'tool'>;
  literalLength: number;
  matches: (target: string) => boolean;
} {
  try {
    const compiled = compileTextPattern({
      pattern,
      syntax: 'auto',
      targetMode: targetKind === 'command' || targetKind === 'value' || targetKind === 'arguments'
        ? 'literal'
        : 'path',
    });
    return {
      kind: compiled.kind as Exclude<PermissionPatternKind, 'tool'>,
      literalLength: compiled.literalLength,
      matches: compiled.matches,
    };
  } catch (error) {
    throw new PermissionRuleError(
      `权限规则 glob 无效: ${error instanceof PatternCompileError ? error.message : String(error)}`,
    );
  }
}

export function parsePermissionRule(
  raw: RawPermissionRule,
  layer: PermissionRuleLayer,
  order: number,
  knownTools: ReadonlyMap<string, PermissionTargetKind>,
): PermissionRule {
  if (raw.effect !== 'allow' && raw.effect !== 'deny') {
    throw new PermissionRuleError(`权限规则 effect 无效: ${String(raw.effect)}`);
  }

  const parsed = parseExpression(raw.expression);
  const targetKind = knownTools.get(parsed.toolName)
    ?? (isMcpToolName(parsed.toolName) ? 'arguments' : undefined);
  if (!/^[a-z][a-z0-9_]*$/u.test(parsed.toolName) || !targetKind) {
    throw new PermissionRuleError(`权限规则使用未知工具: ${parsed.toolName || '(空)'}`);
  }

  if (parsed.pattern === undefined) {
    return {
      ...raw,
      toolName: parsed.toolName,
      patternKind: 'tool',
      layer,
      order,
      literalLength: 0,
      matches: () => true,
    };
  }

  const compiled = compilePermissionPattern(parsed.pattern, targetKind);
  return {
    ...raw,
    toolName: parsed.toolName,
    pattern: parsed.pattern,
    patternKind: compiled.kind,
    layer,
    order,
    literalLength: compiled.literalLength,
    matches: compiled.matches,
  };
}

export function createExactPermissionExpression(toolName: string, target: string): string {
  return `${toolName}(${escape(target, { windowsPathsNoEscape: false })})`;
}
