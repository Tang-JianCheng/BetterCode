import { formatHookField, readHookField, validateHookField } from './field.js';
import type {
  CompiledJsonTemplate,
  CompiledTextTemplate,
  HookEventContext,
  HookEventName,
} from './types.js';

const TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/gu;
const EXACT_TEMPLATE_PATTERN = /^\{\{\s*([^{}]+?)\s*\}\}$/u;

function readRequired(context: HookEventContext, field: string): unknown {
  const result = readHookField(context, field);
  if (!result.found) throw new Error(`Hook 模板字段不存在: ${field}`);
  return result.value;
}

export function compileTextTemplate(event: HookEventName, template: string): CompiledTextTemplate {
  if (!template.trim()) throw new Error('Hook 文本模板不能为空');
  const fields = [...template.matchAll(TEMPLATE_PATTERN)].map(match => match[1].trim());
  const remainder = template.replace(TEMPLATE_PATTERN, '');
  if (remainder.includes('{{') || remainder.includes('}}')) {
    throw new Error('Hook 文本模板括号不完整');
  }
  for (const field of fields) validateHookField(event, field);
  return {
    render(context) {
      return template.replace(TEMPLATE_PATTERN, (_match, rawField: string) =>
        formatHookField(readRequired(context, rawField.trim())));
    },
  };
}

export function compileJsonTemplate(event: HookEventName, value: unknown): CompiledJsonTemplate {
  if (typeof value === 'string') {
    const exact = value.match(EXACT_TEMPLATE_PATTERN);
    if (exact) {
      const field = exact[1].trim();
      validateHookField(event, field);
      return { render: context => readRequired(context, field) };
    }
    const text = compileTextTemplate(event, value);
    return { render: context => text.render(context) };
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return { render: () => value };
  }
  if (Array.isArray(value)) {
    const items = value.map(item => compileJsonTemplate(event, item));
    return { render: context => items.map(item => item.render(context)) };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, compileJsonTemplate(event, item)] as const);
    return {
      render(context) {
        return Object.fromEntries(entries.map(([key, item]) => [key, item.render(context)]));
      },
    };
  }
  throw new Error(`Hook JSON 模板包含不支持的值: ${typeof value}`);
}
