import assert from 'node:assert/strict';
import test from 'node:test';
import { stableStringifyJson } from './stable-json.js';

test('stable JSON sorts object keys recursively and preserves arrays', () => {
  const first = { z: 1, nested: { b: true, a: null }, list: [{ y: 2, x: 1 }, 'x'] };
  const second = { list: [{ x: 1, y: 2 }, 'x'], nested: { a: null, b: true }, z: 1 };
  assert.equal(stableStringifyJson(first), stableStringifyJson(second));
  assert.equal(
    stableStringifyJson(first),
    '{"list":[{"x":1,"y":2},"x"],"nested":{"a":null,"b":true},"z":1}',
  );
  assert.notEqual(stableStringifyJson({ list: [1, 2] }), stableStringifyJson({ list: [2, 1] }));
});

test('stable JSON rejects values outside the JSON data model', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const value of [
    { value: undefined },
    { value: () => undefined },
    { value: Symbol('x') },
    { value: 1n },
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    circular,
    new Date(),
  ]) {
    assert.throws(() => stableStringifyJson(value));
  }
});
