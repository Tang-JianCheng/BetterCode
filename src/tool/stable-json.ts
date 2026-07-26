function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map(character => character.codePointAt(0)!);
  const rightPoints = [...right].map(character => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function normalizeJson(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON 数字必须是有限值');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`不支持的 JSON 值类型: ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError('JSON 参数不能包含循环引用');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => normalizeJson(item, ancestors));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('JSON 对象必须是普通对象');
    }
    const source = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(compareCodePoints)) {
      normalized[key] = normalizeJson(source[key], ancestors);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

export function stableStringifyJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value, new WeakSet<object>()));
}
