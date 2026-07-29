import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from './loader.js';

async function withConfig(t: test.TestContext, contextWindow?: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'bettercode-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'config.yaml');
  await writeFile(file, `providers:\n  - name: test\n    protocol: openai\n    model: model\n${contextWindow === undefined ? '' : `    context_window: ${contextWindow}\n`}    base_url: https://example.test\n    api_key: key\n`);
  return file;
}

test('Provider 上下文窗口支持显式值和缺省值', async t => {
  const explicit = loadConfig(await withConfig(t, '128000'));
  assert.equal(explicit.providers[0].context_window, 128_000);
  const missing = loadConfig(await withConfig(t));
  assert.equal(missing.providers[0].context_window, undefined);
});

test('Provider 上下文窗口拒绝零、负数、小数和字符串', async t => {
  for (const value of ['0', '-1', '1.5', '"128000"']) {
    const file = await withConfig(t, value);
    assert.throws(() => loadConfig(file), /test.*context_window.*正整数/);
  }
});
