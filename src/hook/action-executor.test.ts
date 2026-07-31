import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileHooks } from './compiler.js';
import { DefaultHookActionExecutor } from './action-executor.js';
import type { HookEventContext, LoadedHookConfig } from './types.js';

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
    context,
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
