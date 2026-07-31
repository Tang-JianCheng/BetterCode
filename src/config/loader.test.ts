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

test('子 Agent 模型档位和运行选项可选且严格校验', async t => {
  const file = await withConfig(t);
  await writeFile(file, `providers:
  - name: main
    protocol: openai
    model: model
    base_url: https://example.test
    api_key: key
  - name: fast
    protocol: openai
    model: fast-model
    base_url: https://example.test
    api_key: key
agent_models:
  haiku: fast
subagents:
  foreground_timeout_ms: 120000
  fork_max_iterations: 12
  retained_tasks: 20
  denied_tools: [run_command, run_command]
`);
  const config = loadConfig(file);
  assert.equal(config.agent_models?.haiku, 'fast');
  assert.equal(config.subagents?.foreground_timeout_ms, 120_000);
  assert.equal(config.subagents?.fork_max_iterations, 12);
  assert.deepEqual(config.subagents?.denied_tools, ['run_command']);
});

test('子 Agent 全局配置拒绝未知 Provider、字段和越界值', async t => {
  const cases = [
    ['agent_models:\n  haiku: missing\n', /不存在 Provider/],
    ['agent_models:\n  tiny: test\n', /未知档位/],
    ['subagents:\n  foreground_timeout_ms: 10\n', /1000 到 3600000/],
    ['subagents:\n  unknown: true\n', /未知字段/],
    ['subagents:\n  denied_tools: [""]\n', /非空字符串数组/],
  ] as const;
  for (const [extra, expected] of cases) {
    const file = await withConfig(t);
    await writeFile(file, `providers:
  - name: test
    protocol: openai
    model: model
    base_url: https://example.test
    api_key: key
${extra}`);
    assert.throws(() => loadConfig(file), expected);
  }
});
