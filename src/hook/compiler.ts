import { compilePattern } from '../matcher/pattern.js';
import { formatHookField, readHookField, validateHookField } from './field.js';
import { compileJsonTemplate, compileTextTemplate } from './template.js';
import type {
  CompiledHookAction,
  CompiledHookConditionGroup,
  CompiledHookRule,
  HookEventName,
  HookMatchKind,
  LoadedHookConfig,
} from './types.js';

const EVENTS = new Set<HookEventName>([
  'system_start',
  'system_stop',
  'session_start',
  'session_end',
  'turn_start',
  'turn_end',
  'user_message',
  'assistant_message',
  'pre_tool_use',
  'post_tool_use',
]);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

export class HookCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HookCompileError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw new HookCompileError(`${context}包含未知字段: ${unknown.join(', ')}`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HookCompileError(`${field} 必须是非空字符串`);
  return value;
}

function compileCondition(event: HookEventName, raw: unknown): CompiledHookConditionGroup | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new HookCompileError('if 必须是对象');
  onlyKeys(raw, ['all', 'any'], 'if ');
  const present = ['all', 'any'].filter(key => raw[key] !== undefined) as Array<'all' | 'any'>;
  if (present.length !== 1) throw new HookCompileError('if 必须且只能包含 all 或 any');
  const logic = present[0];
  const entries = raw[logic];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new HookCompileError(`if.${logic} 必须是非空数组`);
  }
  const conditions = entries.map((entry, index) => {
    if (!isRecord(entry)) throw new HookCompileError(`if.${logic}[${index}] 必须是对象`);
    onlyKeys(entry, ['field', 'match', 'value', 'negate'], `if.${logic}[${index}] `);
    const field = nonEmptyString(entry.field, `if.${logic}[${index}].field`);
    validateHookField(event, field);
    if (entry.match !== 'exact' && entry.match !== 'glob' && entry.match !== 'regex') {
      throw new HookCompileError(`if.${logic}[${index}].match 必须是 exact、glob 或 regex`);
    }
    const match = entry.match as HookMatchKind;
    const value = nonEmptyString(entry.value, `if.${logic}[${index}].value`);
    if (entry.negate !== undefined && typeof entry.negate !== 'boolean') {
      throw new HookCompileError(`if.${logic}[${index}].negate 必须是布尔值`);
    }
    const pattern = compilePattern({
      pattern: value,
      syntax: match,
      targetMode: field.endsWith('.path') || field === 'projectRoot' ? 'path' : 'literal',
    });
    return {
      matches(context: Parameters<CompiledHookConditionGroup['matches']>[0]): boolean {
        const result = readHookField(context, field);
        if (!result.found) return false;
        const matched = pattern.matches(formatHookField(result.value));
        return entry.negate === true ? !matched : matched;
      },
    };
  });
  return {
    logic,
    matches: context => logic === 'all'
      ? conditions.every(condition => condition.matches(context))
      : conditions.some(condition => condition.matches(context)),
  };
}

function compileAction(event: HookEventName, raw: unknown): CompiledHookAction {
  if (!isRecord(raw)) throw new HookCompileError('action 必须是对象');
  if (raw.type === 'command') {
    onlyKeys(raw, ['type', 'command'], 'command action ');
    return { type: 'command', command: nonEmptyString(raw.command, 'action.command') };
  }
  if (raw.type === 'prompt') {
    onlyKeys(raw, ['type', 'prompt'], 'prompt action ');
    return {
      type: 'prompt',
      prompt: compileTextTemplate(event, nonEmptyString(raw.prompt, 'action.prompt')),
    };
  }
  if (raw.type === 'agent') {
    onlyKeys(raw, ['type', 'prompt'], 'agent action ');
    return {
      type: 'agent',
      prompt: compileTextTemplate(event, nonEmptyString(raw.prompt, 'action.prompt')),
    };
  }
  if (raw.type === 'http') {
    onlyKeys(raw, ['type', 'method', 'url', 'headers', 'body'], 'http action ');
    const method = raw.method === undefined ? 'POST' : nonEmptyString(raw.method, 'action.method').toUpperCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Z-]+$/u.test(method)) throw new HookCompileError('action.method 无效');
    const url = nonEmptyString(raw.url, 'action.url');
    try {
      const staticUrl = url.replace(/\{\{[^{}]+\}\}/gu, 'value');
      const parsed = new URL(staticUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('协议无效');
    } catch {
      throw new HookCompileError('action.url 必须是有效的 HTTP 或 HTTPS 地址');
    }
    let headers: Record<string, ReturnType<typeof compileTextTemplate>> = {};
    if (raw.headers !== undefined) {
      if (!isRecord(raw.headers)) throw new HookCompileError('action.headers 必须是字符串 map');
      headers = Object.fromEntries(Object.entries(raw.headers).map(([name, value]) => {
        const normalized = name.toLowerCase();
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) {
          throw new HookCompileError(`action.headers 名称无效: ${name}`);
        }
        if (normalized === 'host' || normalized === 'content-length') {
          throw new HookCompileError(`action.headers 不允许设置 ${name}`);
        }
        return [normalized, compileTextTemplate(event, nonEmptyString(value, `action.headers.${name}`))];
      }));
    }
    return {
      type: 'http',
      method,
      url: compileTextTemplate(event, url),
      headers,
      ...(raw.body === undefined ? {} : { body: compileJsonTemplate(event, raw.body) }),
    };
  }
  throw new HookCompileError(`未知 Hook action type: ${String(raw.type)}`);
}

export function compileHooks(config: LoadedHookConfig): CompiledHookRule[] {
  return config.rules.map(({ source, value }) => {
    const prefix = `${source.layer} Hook 配置 ${source.file} 第 ${source.index + 1} 条规则`;
    try {
      onlyKeys(value, ['event', 'if', 'action', 'once', 'background', 'timeout_ms'], '规则 ');
      if (typeof value.event !== 'string' || !EVENTS.has(value.event as HookEventName)) {
        throw new HookCompileError(`未知 Hook event: ${String(value.event)}`);
      }
      const event = value.event as HookEventName;
      if (value.once !== undefined && typeof value.once !== 'boolean') {
        throw new HookCompileError('once 必须是布尔值');
      }
      if (value.background !== undefined && typeof value.background !== 'boolean') {
        throw new HookCompileError('background 必须是布尔值');
      }
      const once = value.once ?? false;
      const background = value.background ?? false;
      const timeoutMs = value.timeout_ms ?? DEFAULT_TIMEOUT_MS;
      if (!Number.isInteger(timeoutMs) || (timeoutMs as number) < 1 || (timeoutMs as number) > MAX_TIMEOUT_MS) {
        throw new HookCompileError(`timeout_ms 必须是 1 到 ${MAX_TIMEOUT_MS} 的整数`);
      }
      const action = compileAction(event, value.action);
      if (event === 'pre_tool_use' && once) throw new HookCompileError('pre_tool_use 不允许 once');
      if (event === 'pre_tool_use' && background) throw new HookCompileError('pre_tool_use 不允许 background');
      if (event === 'pre_tool_use' && action.type === 'agent') {
        throw new HookCompileError('pre_tool_use 不允许 agent 动作');
      }
      if (action.type === 'prompt' && background) throw new HookCompileError('prompt 动作不允许 background');
      if (event === 'system_stop' && action.type === 'prompt') {
        throw new HookCompileError('system_stop 不允许 prompt 动作');
      }
      if ((action.type === 'prompt' || action.type === 'agent') && value.timeout_ms !== undefined) {
        throw new HookCompileError(`${action.type} 动作不允许 timeout_ms`);
      }
      return Object.freeze({
        source,
        event,
        condition: compileCondition(event, value.if),
        action,
        once,
        background,
        timeoutMs: timeoutMs as number,
      });
    } catch (error) {
      throw new HookCompileError(`${prefix}无效: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
