import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileHooks } from './compiler.js';
import { DefaultHookActionExecutor } from './action-executor.js';
import type { HookEventContext, LoadedHookConfig } from './types.js';
import type { HookAgentRunner } from '../subagent/types.js';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-hook-action-'));
}

function compile(value: Record<string, unknown>) {
  const config: LoadedHookConfig = {
    secretValues: [],
    rules: [{
      source: { layer: 'project', file: '/project/hooks.yaml', index: 0, id: 'project:0' },
      value,
    }],
  };
  return compileHooks(config)[0];
}

const context: HookEventContext = {
  event: 'pre_tool_use',
  projectRoot: '/project',
  session: { id: 'session' },
  timestamp: '2026-07-31T00:00:00.000Z',
  turn: { id: 'turn', mode: 'act', task: 'test' },
  tool: { id: 'call', name: 'run_command', arguments: { command: 'git push' } },
};

test('命令动作从 stdin 读取上下文并返回结构化拒绝', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'hook.mjs');
  writeFileSync(script, `let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const context = JSON.parse(input);
process.stdout.write(JSON.stringify({ decision: context.tool.name === 'run_command' ? 'deny' : 'allow', reason: 'blocked' }));
`);
  const rule = compile({
    event: 'pre_tool_use',
    action: { type: 'command', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}` },
  });
  const result = await new DefaultHookActionExecutor(root).execute(
    rule,
    { ...context, projectRoot: root },
    new AbortController().signal,
  );
  assert.deepEqual(result.status === 'success' ? result.decision : undefined, {
    decision: 'deny',
    reason: 'blocked',
  });
});

test('HTTP 动作发送事件 JSON 并解析统一拒绝协议', async t => {
  let received = '';
  const server = createServer((request, response) => {
    request.setEncoding('utf8');
    request.on('data', chunk => { received += chunk; });
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"decision":"deny","reason":"remote policy"}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const rule = compile({
    event: 'pre_tool_use',
    action: { type: 'http', url: `http://127.0.0.1:${address.port}/hook` },
  });
  const result = await new DefaultHookActionExecutor('/project').execute(
    rule,
    context,
    new AbortController().signal,
  );
  assert.match(received, /run_command/);
  assert.deepEqual(result.status === 'success' ? result.decision : undefined, {
    decision: 'deny',
    reason: 'remote policy',
  });
});

test('Agent 动作调用真实运行器并支持角色、同步和后台结果', async () => {
  const calls: Parameters<HookAgentRunner['runHookAgent']>[0][] = [];
  const runner: HookAgentRunner = {
    async runHookAgent(input) {
      calls.push(input);
      return input.background
        ? { status: 'backgrounded', taskId: 'sa-background' }
        : { status: 'completed', output: '检查完成' };
    },
  };
  const scopedContext: HookEventContext = {
    ...context,
    event: 'post_tool_use',
    tool: { ...context.tool!, result: { ok: true, output: 'ok', metadata: {} } },
  };
  const foreground = compile({
    event: 'post_tool_use', action: { type: 'agent', role: 'reviewer', prompt: '检查 {{tool.name}}' },
  });
  const background = compile({
    event: 'post_tool_use', background: true, action: { type: 'agent', prompt: '后台检查' },
  });
  const executor = new DefaultHookActionExecutor('/project', runner);

  assert.deepEqual(await executor.execute(foreground, scopedContext, new AbortController().signal), {
    status: 'success', output: '检查完成',
  });
  assert.deepEqual(await executor.execute(background, scopedContext, new AbortController().signal), {
    status: 'success', output: '子 Agent 已转后台: sa-background',
  });
  assert.equal(calls[0].role, 'reviewer');
  assert.equal(calls[0].prompt, '检查 run_command');
  assert.equal(calls[1].role, 'general');
  assert.equal(calls[1].background, true);
});

test('Agent 动作缺少运行器或执行失败时返回 AGENT_FAILED', async () => {
  const rule = compile({ event: 'turn_start', action: { type: 'agent', prompt: '检查' } });
  const turnContext: HookEventContext = { ...context, event: 'turn_start', tool: undefined };
  const unavailable = await new DefaultHookActionExecutor('/project').execute(
    rule, turnContext, new AbortController().signal,
  );
  assert.equal(unavailable.status === 'failed' ? unavailable.code : '', 'AGENT_FAILED');

  const failed = await new DefaultHookActionExecutor('/project', {
    async runHookAgent() {
      return { status: 'failed', code: 'SUBAGENT_FAILED', message: '失败' };
    },
  }).execute(rule, turnContext, new AbortController().signal);
  assert.deepEqual(failed, { status: 'failed', code: 'AGENT_FAILED', message: '失败' });
});
