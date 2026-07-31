import { stableStringifyJson } from '../tool/stable-json.js';
import type { HookEventContext, HookEventName } from './types.js';

const BLOCKED_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

const COMMON_FIELDS = new Set(['event', 'projectRoot', 'session.id', 'timestamp']);
const EVENT_FIELDS: Record<HookEventName, ReadonlySet<string>> = {
  system_start: new Set(['system.reason']),
  system_stop: new Set(['system.reason']),
  session_start: new Set(['session.reason']),
  session_end: new Set(['session.reason']),
  turn_start: new Set(['turn.id', 'turn.mode', 'turn.task']),
  turn_end: new Set(['turn.id', 'turn.mode', 'turn.task', 'turn.stopReason']),
  user_message: new Set(['turn.id', 'turn.mode', 'turn.task', 'message.role', 'message.content']),
  assistant_message: new Set([
    'turn.id',
    'turn.mode',
    'turn.task',
    'message.role',
    'message.content',
    'message.toolCalls',
  ]),
  pre_tool_use: new Set([
    'turn.id',
    'turn.mode',
    'turn.task',
    'tool.id',
    'tool.name',
    'tool.arguments',
  ]),
  post_tool_use: new Set([
    'turn.id',
    'turn.mode',
    'turn.task',
    'tool.id',
    'tool.name',
    'tool.arguments',
    'tool.result',
    'tool.result.ok',
    'tool.result.output',
    'tool.result.error',
    'tool.result.error.code',
    'tool.result.error.message',
    'tool.result.metadata',
  ]),
};

function hasDynamicPrefix(event: HookEventName, field: string): boolean {
  if ((event === 'pre_tool_use' || event === 'post_tool_use') && field.startsWith('tool.arguments.')) {
    return true;
  }
  return event === 'post_tool_use' && field.startsWith('tool.result.metadata.');
}

export function validateHookField(event: HookEventName, field: string): void {
  if (!field.trim()) throw new Error('Hook 字段不能为空');
  const segments = field.split('.');
  if (segments.some(segment => !segment || BLOCKED_SEGMENTS.has(segment))) {
    throw new Error(`Hook 字段路径无效: ${field}`);
  }
  if (!COMMON_FIELDS.has(field) && !EVENT_FIELDS[event].has(field) && !hasDynamicPrefix(event, field)) {
    throw new Error(`事件 ${event} 不支持字段: ${field}`);
  }
}

export type HookFieldReadResult =
  | { found: true; value: unknown }
  | { found: false };

export function readHookField(context: HookEventContext, field: string): HookFieldReadResult {
  let current: unknown = context;
  for (const segment of field.split('.')) {
    if (BLOCKED_SEGMENTS.has(segment) || typeof current !== 'object' || current === null ||
        !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current === undefined ? { found: false } : { found: true, value: current };
}

export function formatHookField(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Hook 字段数字必须是有限值');
    return String(value);
  }
  if (typeof value === 'boolean' || value === null) return String(value);
  return stableStringifyJson(value);
}
