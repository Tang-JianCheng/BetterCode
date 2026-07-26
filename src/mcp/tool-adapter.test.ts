import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ToolScheduler } from '../agent/tool-scheduler.js';
import { createPermissionManager } from '../permission/factory.js';
import { ToolRegistry } from '../tool/registry.js';
import type { JsonObject } from '../tool/types.js';
import { McpToolAdapter } from './tool-adapter.js';
import {
  McpSessionError,
  type McpRemoteCallResult,
  type McpRemoteTool,
  type McpSession,
} from './types.js';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-mcp-adapter-'));
}

function makeRemote(readOnly: boolean): McpRemoteTool {
  return {
    name: 'remote_echo',
    description: '远端回显',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    readOnly,
  };
}

function makeSession(
  callTool: McpSession['callTool'],
): McpSession {
  return {
    serverName: 'demo',
    state: 'connected',
    async connect() {},
    async listTools() { return []; },
    callTool,
    async close() {},
  };
}

const EMPTY_RESULT: McpRemoteCallResult = {
  isError: false,
  textParts: [],
  attachments: [],
};

test('MCP 适配器映射名称、描述、安全分类与权限画像', () => {
  const session = makeSession(async () => EMPTY_RESULT);
  const readRemote = makeRemote(true);
  const read = new McpToolAdapter('mcp_demo_read_12345678', 'demo', readRemote, session);
  const write = new McpToolAdapter('mcp_demo_write_12345678', 'demo', makeRemote(false), session);

  assert.equal(read.name, 'mcp_demo_read_12345678');
  assert.match(read.description, /MCP Server: demo/);
  assert.equal(read.effect, 'read_only');
  assert.deepEqual(read.permission, { targetKind: 'arguments', risk: 'read' });
  assert.equal(write.effect, 'side_effect');
  assert.deepEqual(write.permission, { targetKind: 'arguments', risk: 'execute' });
  assert.equal(read.inputSchema, readRemote.inputSchema);
});

test('MCP 适配器原样传递远端名称、参数对象与取消信号', async () => {
  const input: JsonObject = { nested: { value: 'ok' }, list: [1, 2] };
  const controller = new AbortController();
  let seenName = '';
  let seenInput: JsonObject | undefined;
  let seenSignal: AbortSignal | undefined;
  const session = makeSession(async (name, received, signal) => {
    seenName = name;
    seenInput = received;
    seenSignal = signal;
    return { ...EMPTY_RESULT, textParts: ['完成'] };
  });
  const adapter = new McpToolAdapter('mcp_demo_echo_12345678', 'demo', makeRemote(true), session);

  const result = await adapter.execute(input, {
    rootDir: '/tmp/project',
    signal: controller.signal,
    maxOutputBytes: 1024,
  });

  assert.equal(result.ok, true);
  assert.equal(result.output, '完成');
  assert.equal(seenName, 'remote_echo');
  assert.equal(seenInput, input);
  assert.equal(seenSignal, controller.signal);
  assert.deepEqual(result.metadata, {
    server: 'demo',
    remoteTool: 'remote_echo',
    attachmentCount: 0,
  });
});

test('MCP 适配器组合文本、稳定结构化结果和有限附件摘要', async () => {
  const session = makeSession(async () => ({
    isError: false,
    textParts: ['第一段', '第二段'],
    structuredContent: { z: 1, a: { y: true, x: false } },
    attachments: [
      { type: 'image', mimeType: 'image/png', size: 12 },
      { type: 'resource_link', uri: 'file:///report', name: '报告' },
    ],
  }));
  const adapter = new McpToolAdapter('mcp_demo_echo_12345678', 'demo', makeRemote(true), session);

  const result = await adapter.execute({ value: 'ok' }, {
    rootDir: '/tmp/project',
    signal: new AbortController().signal,
    maxOutputBytes: 1024,
  });

  assert.equal(result.ok, true);
  assert.match(result.output, /^第一段\n\n第二段/);
  assert.match(result.output, /结构化结果:\n\{"a":\{"x":false,"y":true\},"z":1\}/);
  assert.match(result.output, /附件摘要:/);
  assert.doesNotMatch(result.output, /base64/i);
});

test('MCP 适配器保留业务错误并映射会话错误', async () => {
  const business = new McpToolAdapter(
    'mcp_demo_business_12345678',
    'demo',
    makeRemote(false),
    makeSession(async () => ({
      isError: true,
      textParts: ['远端拒绝'],
      attachments: [],
    })),
  );
  const unavailable = new McpToolAdapter(
    'mcp_demo_unavailable_12345678',
    'demo',
    makeRemote(false),
    makeSession(async () => {
      throw new McpSessionError('MCP_SERVER_UNAVAILABLE', '连接已关闭');
    }),
  );
  const context = {
    rootDir: '/tmp/project',
    signal: new AbortController().signal,
    maxOutputBytes: 1024,
  };

  const businessResult = await business.execute({ value: 'x' }, context);
  const unavailableResult = await unavailable.execute({ value: 'x' }, context);

  assert.equal(businessResult.error?.code, 'MCP_TOOL_ERROR');
  assert.equal(businessResult.output, '远端拒绝');
  assert.equal(unavailableResult.error?.code, 'MCP_SERVER_UNAVAILABLE');
});

test('Registry 继续统一裁决 MCP 输出上限、取消与超时', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const controller = new AbortController();
  const registry = new ToolRegistry(root, { timeoutMs: 20, maxOutputBytes: 80 });
  registry.register(new McpToolAdapter(
    'mcp_demo_long_12345678',
    'demo',
    makeRemote(true),
    makeSession(async () => ({ ...EMPTY_RESULT, textParts: ['x'.repeat(500)] })),
  ));
  registry.register(new McpToolAdapter(
    'mcp_demo_wait_12345678',
    'demo',
    makeRemote(true),
    makeSession(async (_name, _input, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve(EMPTY_RESULT), { once: true });
    })),
  ));

  const limited = await registry.execute({
    id: 'long',
    name: 'mcp_demo_long_12345678',
    arguments: { value: 'x' },
  });
  assert.equal(Buffer.byteLength(limited.output), 80);

  const pending = registry.execute({
    id: 'cancel',
    name: 'mcp_demo_wait_12345678',
    arguments: { value: 'x' },
  }, controller.signal);
  controller.abort();
  assert.equal((await pending).error?.code, 'CANCELLED');

  const timeout = await registry.execute({
    id: 'timeout',
    name: 'mcp_demo_wait_12345678',
    arguments: { value: 'x' },
  });
  assert.equal(timeout.error?.code, 'TIMEOUT');
});

test('MCP 工具接入完整参数权限目标和 Plan Mode 只读边界', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  const readName = 'mcp_demo_read_12345678';
  const writeName = 'mcp_demo_write_12345678';
  const permissiveSchema = { type: 'object', additionalProperties: true };
  registry.register(new McpToolAdapter(
    readName,
    'demo',
    { ...makeRemote(true), name: 'read', inputSchema: permissiveSchema },
    makeSession(async () => ({ ...EMPTY_RESULT, textParts: ['read'] })),
  ));
  registry.register(new McpToolAdapter(
    writeName,
    'demo',
    { ...makeRemote(false), name: 'write', inputSchema: permissiveSchema },
    makeSession(async () => ({ ...EMPTY_RESULT, textParts: ['write'] })),
  ));
  const permissionManager = createPermissionManager(
    registry,
    'default',
    { userHome: path.join(root, '.home') },
  );
  const readTool = registry.get(readName)!;
  let requestedTarget = '';
  const first = await permissionManager.authorize(
    { id: 'first', name: readName, arguments: { z: 1, a: 'src/a.ts' } },
    readTool,
    {
      signal: new AbortController().signal,
      onRequest: request => { requestedTarget = request.target; },
      decider: async () => 'allow_session',
    },
  );
  const second = await permissionManager.authorize(
    { id: 'second', name: readName, arguments: { a: 'src/a.ts', z: 1 } },
    readTool,
    {
      signal: new AbortController().signal,
      onRequest: () => { throw new Error('会话规则应避免再次确认'); },
    },
  );

  assert.equal(requestedTarget, '{"a":"src/a.ts","z":1}');
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(second.source, 'session_rule');
  assert.deepEqual(registry.definitions('read_only').map(item => item.name), [readName]);

  const plan = await new ToolScheduler(
    registry,
    createPermissionManager(registry, 'allow', { userHome: path.join(root, '.plan-home') }),
  ).executeBatch([
    { id: 'read', name: readName, arguments: {} },
    { id: 'write', name: writeName, arguments: {} },
  ], 1, {
    mode: 'plan',
    initialUnknownToolStreak: 0,
    unknownToolLimit: 3,
    maxIterations: 10,
    signal: new AbortController().signal,
    onProgress: () => undefined,
  });
  assert.equal(plan.results[0]?.result.output, 'read');
  assert.equal(plan.results[1]?.result.error?.code, 'TOOL_UNAVAILABLE');
});

test('调度器并发执行只读 MCP 工具并串行执行副作用 MCP 工具', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  const timeline: string[] = [];
  let activeReads = 0;
  let releaseReads: (() => void) | undefined;
  const readGate = new Promise<void>(resolve => { releaseReads = resolve; });

  for (const name of ['read_a', 'read_b']) {
    registry.register(new McpToolAdapter(
      `mcp_demo_${name}_12345678`,
      'demo',
      { ...makeRemote(true), name, inputSchema: { type: 'object', additionalProperties: false } },
      makeSession(async () => {
        timeline.push(`${name}:start`);
        activeReads += 1;
        if (activeReads === 2) releaseReads?.();
        await readGate;
        timeline.push(`${name}:end`);
        return { ...EMPTY_RESULT, textParts: [name] };
      }),
    ));
  }
  for (const name of ['write_a', 'write_b']) {
    registry.register(new McpToolAdapter(
      `mcp_demo_${name}_12345678`,
      'demo',
      { ...makeRemote(false), name, inputSchema: { type: 'object', additionalProperties: false } },
      makeSession(async () => {
        timeline.push(`${name}:start`);
        await new Promise(resolve => setTimeout(resolve, 1));
        timeline.push(`${name}:end`);
        return { ...EMPTY_RESULT, textParts: [name] };
      }),
    ));
  }
  const scheduler = new ToolScheduler(
    registry,
    createPermissionManager(registry, 'allow', { userHome: path.join(root, '.home') }),
  );

  const result = await scheduler.executeBatch([
    { id: 'w1', name: 'mcp_demo_write_a_12345678', arguments: {} },
    { id: 'r1', name: 'mcp_demo_read_a_12345678', arguments: {} },
    { id: 'w2', name: 'mcp_demo_write_b_12345678', arguments: {} },
    { id: 'r2', name: 'mcp_demo_read_b_12345678', arguments: {} },
  ], 1, {
    mode: 'act',
    initialUnknownToolStreak: 0,
    unknownToolLimit: 3,
    maxIterations: 10,
    signal: new AbortController().signal,
    onProgress: () => undefined,
  });

  assert.equal(result.results.every(item => item.result.ok), true);
  assert.deepEqual(timeline.slice(-4), [
    'write_a:start', 'write_a:end', 'write_b:start', 'write_b:end',
  ]);
  assert.ok(timeline.indexOf('read_b:start') < timeline.indexOf('read_a:end'));
});
