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

test('Worktree 配置解析规则与安全边界', async t => {
  const file = await withConfig(t);
  await writeFile(file, `providers:
  - name: test
    protocol: openai
    model: model
    base_url: https://example.test
    api_key: key
worktrees:
  retention_days: 9
  cleanup_interval_ms: 120000
  copy_files:
    - source: .env.local
      required: true
  symlinks:
    - source: node_modules
      target: node_modules
`);
  const config = loadConfig(file);
  assert.equal(config.worktrees?.retention_days, 9);
  assert.equal(config.worktrees?.cleanup_interval_ms, 120_000);
  assert.equal(config.worktrees?.copy_files?.[0].required, true);
  for (const source of ['/tmp/file', '../file', 'a\\b']) {
    await writeFile(file, `providers:
  - name: test
    protocol: openai
    model: model
    base_url: https://example.test
    api_key: key
worktrees:
  copy_files:
    - source: ${JSON.stringify(source)}
`);
    assert.throws(() => loadConfig(file), /相对路径|正斜杠|不能包含/);
  }
});

test('团队配置解析双锁、运行边界和终端模板', async t => {
  const file = await withConfig(t);
  await writeFile(file, `providers:
  - name: test
    protocol: openai
    model: model
    base_url: https://example.test
    api_key: key
teams:
  coordinator:
    enabled: true
  mailbox:
    lock_timeout_ms: 6000
    retry_interval_ms: 60
    stale_lock_ms: 40000
  runtime:
    heartbeat_interval_ms: 1500
    heartbeat_timeout_ms: 9000
    stop_timeout_ms: 12000
    inbox_poll_interval_ms: 2500
  integration:
    timeout_ms: 240000
    validation_commands: [pnpm check]
  custom_terminals:
    - name: custom-pane
      detect: { command: custom, args: [detect] }
      spawn: { command: custom, args: [spawn, "{worker_descriptor}", "{cwd}"] }
      wake: { command: custom, args: [wake, "{pane_id}"] }
`);
  const config = loadConfig(file);
  assert.equal(config.teams?.coordinator?.enabled, true);
  assert.equal(config.teams?.mailbox?.stale_lock_ms, 40_000);
  assert.equal(config.teams?.runtime?.heartbeat_timeout_ms, 9_000);
  assert.deepEqual(config.teams?.integration?.validation_commands, ['pnpm check']);
  assert.equal(config.teams?.custom_terminals?.[0].name, 'custom-pane');
});

test('团队配置拒绝危险关系和未知占位符', async t => {
  const cases = [
    ['teams:\n  unknown: true\n', /未知字段/],
    ['teams:\n  mailbox:\n    retry_interval_ms: 100\n    stale_lock_ms: 100\n', /必须大于/],
    ['teams:\n  runtime:\n    heartbeat_interval_ms: 5000\n    heartbeat_timeout_ms: 5000\n', /必须大于/],
    [
      'teams:\n  custom_terminals:\n    - name: pane\n      detect: { command: x }\n      spawn: { command: x, args: ["{secret}"] }\n      wake: { command: x }\n',
      /未知占位符/,
    ],
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

test('cc_switch 配置解析与缺省 enabled', async t => {
  const file = await withConfig(t);
  await writeFile(file, `providers:
  - name: test
    protocol: openai
    model: model
    base_url: https://example.test
    api_key: key
cc_switch:
  claude:
    name: cc-switch.claude
    model: claude-sonnet-5-20251001
    thinking: false
    context_window: 200000
`);
  const config = loadConfig(file);
  assert.equal(config.cc_switch?.enabled, true);
  assert.equal(config.cc_switch?.claude?.name, 'cc-switch.claude');
  assert.equal(config.cc_switch?.claude?.model, 'claude-sonnet-5-20251001');
  assert.equal(config.cc_switch?.claude?.thinking, false);
  assert.equal(config.cc_switch?.claude?.context_window, 200_000);
});

test('cc_switch 配置拒绝未知字段、非法类型和越界值', async t => {
  const cases = [
    ['cc_switch:\n  enabled: maybe\n', /布尔值/],
    ['cc_switch:\n  unknown: true\n', /未知字段/],
    ['cc_switch:\n  claude:\n    unknown: true\n', /未知字段/],
    ['cc_switch:\n  claude:\n    name: ""\n', /非空字符串/],
    ['cc_switch:\n  claude:\n    thinking: yes\n', /布尔值/],
    ['cc_switch:\n  claude:\n    context_window: 0\n', /1 到 10000000 的整数/],
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
