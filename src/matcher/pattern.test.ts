import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePattern, PatternCompileError } from './pattern.js';

test('公共匹配器支持显式精确、glob 和正则', () => {
  const exact = compilePattern({ pattern: 'src/a.ts', syntax: 'exact', targetMode: 'path' });
  const glob = compilePattern({ pattern: 'src/**/*.ts', syntax: 'glob', targetMode: 'path' });
  const regex = compilePattern({ pattern: '(^|\\s)git\\s+push($|\\s)', syntax: 'regex', targetMode: 'literal' });

  assert.equal(exact.matches('src/a.ts'), true);
  assert.equal(exact.matches('src/b.ts'), false);
  assert.equal(glob.matches('src/nested/a.ts'), true);
  assert.equal(glob.matches('test/a.ts'), false);
  assert.equal(regex.matches('git push origin main'), true);
  assert.equal(regex.matches('git status'), false);
  assert.throws(
    () => compilePattern({ pattern: '(', syntax: 'regex', targetMode: 'literal' }),
    PatternCompileError,
  );
});

test('权限兼容的 auto 模式保留字面 slash 和 glob 判断', () => {
  const exact = compilePattern({
    pattern: '{"path":"src/a.ts"}',
    syntax: 'auto',
    targetMode: 'literal',
  });
  const glob = compilePattern({ pattern: 'git *', syntax: 'auto', targetMode: 'literal' });

  assert.equal(exact.kind, 'exact');
  assert.equal(exact.matches('{"path":"src/a.ts"}'), true);
  assert.equal(glob.kind, 'glob');
  assert.equal(glob.matches('git status'), true);
  assert.equal(glob.matches('sudo git status'), false);
});
