import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpSdkSession } from './sdk-session.js';
import {
  McpSessionError,
  McpStartupError,
  type HttpMcpServerConfig,
  type McpSessionOptions,
  type StdioMcpServerConfig,
} from './types.js';

const OPTIONS: McpSessionOptions = {
  rootDir: '/tmp/bettercode-project',
  connectTimeoutMs: 101,
  discoveryTimeoutMs: 202,
  callTimeoutMs: 303,
  maxStderrBytes: 24,
};

function stdioConfig(secretValues: string[] = []): StdioMcpServerConfig {
  return {
    name: 'stdio-demo',
    layer: 'project',
    file: '/tmp/bettercode-project/.bettercode/mcp.yaml',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { BETTERCODE_TEST: 'configured' },
    secretValues,
  };
}

function httpConfig(secretValues: string[] = []): HttpMcpServerConfig {
  return {
    name: 'http-demo',
    layer: 'project',
    file: '/tmp/bettercode-project/.bettercode/mcp.yaml',
    transport: 'http',
    url: 'http://127.0.0.1:45678/mcp',
    headers: { Authorization: 'Bearer local-test' },
    secretValues,
  };
}

function fakeTransport(): Transport & { closeCount: number } {
  return {
    closeCount: 0,
    async start() {},
    async send() {},
    async close() { this.closeCount += 1; },
  };
}

interface FakeClient {
  onclose?: () => void;
  connect: (...args: unknown[]) => Promise<void>;
  listTools: (...args: unknown[]) => Promise<unknown>;
  callTool: (...args: unknown[]) => Promise<unknown>;
  close: () => Promise<void>;
}

function makeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    async connect() {},
    async listTools() { return { tools: [] }; },
    async callTool() { return { content: [] }; },
    async close() {},
    ...overrides,
  };
}

function makeSession(
  client: FakeClient,
  config: StdioMcpServerConfig | HttpMcpServerConfig = stdioConfig(),
  options: McpSessionOptions = OPTIONS,
  transport = fakeTransport(),
): McpSdkSession {
  return new McpSdkSession(config, options, {
    client: client as unknown as Client,
    transport,
  });
}

test('stdio transport 固定项目 cwd、安全默认环境、配置覆盖和 stderr 管道', () => {
  const session = new McpSdkSession(stdioConfig(), OPTIONS);
  const transport = (session as unknown as {
    transport: {
      _serverParams: {
        command: string;
        args: string[];
        cwd: string;
        env: Record<string, string>;
        stderr: string;
      };
      stderr: EventEmitter | null;
    };
  }).transport;

  assert.equal(transport._serverParams.command, 'node');
  assert.deepEqual(transport._serverParams.args, ['server.js']);
  assert.equal(transport._serverParams.cwd, OPTIONS.rootDir);
  assert.deepEqual(transport._serverParams.env, {
    ...getDefaultEnvironment(),
    BETTERCODE_TEST: 'configured',
  });
  assert.equal(transport._serverParams.stderr, 'pipe');
  assert.ok(transport.stderr);
});

test('HTTP transport 注入静态 header 并关闭自动重连', () => {
  const session = new McpSdkSession(httpConfig(), OPTIONS);
  const transport = (session as unknown as {
    transport: {
      _url: URL;
      _requestInit: { headers: Record<string, string> };
      _reconnectionOptions: { maxRetries: number };
    };
  }).transport;

  assert.equal(transport._url.href, 'http://127.0.0.1:45678/mcp');
  assert.deepEqual(transport._requestInit.headers, { Authorization: 'Bearer local-test' });
  assert.equal(transport._reconnectionOptions.maxRetries, 0);
});

test('connect 传递 transport、取消信号和连接超时并维护状态', async () => {
  const transport = fakeTransport();
  const controller = new AbortController();
  let received: unknown[] = [];
  const client = makeClient({
    async connect(...args) { received = args; },
  });
  const session = makeSession(client, stdioConfig(), OPTIONS, transport);

  await session.connect(controller.signal);
  await session.connect(controller.signal);

  assert.equal(session.state, 'connected');
  assert.equal(received[0], transport);
  assert.deepEqual(received[1], {
    signal: controller.signal,
    timeout: OPTIONS.connectTimeoutMs,
    maxTotalTimeout: OPTIONS.connectTimeoutMs,
  });
});

test('connect 对 transport 和初始化错误分类并脱敏', async () => {
  const secret = 'sdk-connect-secret';
  const transportFailure = makeSession(makeClient({
    async connect() { throw new Error(`spawn ENOENT ${secret}`); },
  }), stdioConfig([secret]));
  const protocolFailure = makeSession(makeClient({
    async connect() { throw new Error(`bad initialize ${secret}`); },
  }), stdioConfig([secret]));

  await assert.rejects(transportFailure.connect(), (error: unknown) => {
    assert.ok(error instanceof McpStartupError);
    assert.equal(error.diagnosticCode, 'TRANSPORT_ERROR');
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });
  await assert.rejects(protocolFailure.connect(), (error: unknown) => {
    assert.ok(error instanceof McpStartupError);
    assert.equal(error.diagnosticCode, 'INITIALIZE_ERROR');
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });
});

test('listTools 汇总分页并仅信任显式 readOnlyHint', async () => {
  const requests: Array<[unknown, unknown]> = [];
  const client = makeClient({
    async listTools(params, options) {
      requests.push([params, options]);
      if (requests.length === 1) {
        return {
          tools: [{
            name: 'read',
            description: '只读',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
          }],
          nextCursor: 'page-2',
        };
      }
      return {
        tools: [
          { name: 'write', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
          { name: 'unknown', inputSchema: { type: 'object' } },
        ],
      };
    },
  });
  const session = makeSession(client);
  const controller = new AbortController();
  await session.connect();

  const tools = await session.listTools(controller.signal);

  assert.deepEqual(tools.map(tool => [tool.name, tool.readOnly]), [
    ['read', true], ['write', false], ['unknown', false],
  ]);
  assert.deepEqual(requests.map(request => request[0]), [undefined, { cursor: 'page-2' }]);
  assert.deepEqual(requests[0]?.[1], {
    signal: controller.signal,
    timeout: OPTIONS.discoveryTimeoutMs,
    maxTotalTimeout: OPTIONS.discoveryTimeoutMs,
  });
});

test('listTools 拒绝重复 cursor 和无界分页', async () => {
  const repeated = makeSession(makeClient({
    async listTools() { return { tools: [], nextCursor: 'same' }; },
  }));
  await repeated.connect();
  await assert.rejects(repeated.listTools(), (error: unknown) => {
    assert.ok(error instanceof McpStartupError);
    assert.equal(error.diagnosticCode, 'DISCOVERY_ERROR');
    assert.match(error.message, /重复 cursor/);
    return true;
  });

  let page = 0;
  const unbounded = makeSession(makeClient({
    async listTools() {
      page += 1;
      return { tools: [], nextCursor: `page-${page}` };
    },
  }));
  await unbounded.connect();
  await assert.rejects(unbounded.listTools(), /分页超过 100 页/);
  assert.equal(page, 100);
});

test('callTool 透传调用并转换文本、资源、结构化内容和媒体摘要', async () => {
  let received: unknown[] = [];
  const client = makeClient({
    async callTool(...args) {
      received = args;
      return {
        content: [
          { type: 'text', text: '正文' },
          { type: 'resource', resource: { uri: 'file:///text', mimeType: 'text/plain', text: '资源正文' } },
          { type: 'image', mimeType: 'image/png', data: Buffer.from('image').toString('base64') },
          { type: 'audio', mimeType: 'audio/wav', data: Buffer.from('audio').toString('base64') },
          { type: 'resource', resource: { uri: 'file:///blob', mimeType: 'application/octet-stream', blob: Buffer.from('blob').toString('base64') } },
          { type: 'resource_link', uri: 'file:///linked', name: 'linked', size: 9 },
        ],
        structuredContent: { answer: 42 },
        isError: true,
      };
    },
  });
  const session = makeSession(client);
  const controller = new AbortController();
  await session.connect();

  const result = await session.callTool('echo', { value: 'ok' }, controller.signal);

  assert.deepEqual(received, [
    { name: 'echo', arguments: { value: 'ok' } },
    undefined,
    {
      signal: controller.signal,
      timeout: OPTIONS.callTimeoutMs,
      maxTotalTimeout: OPTIONS.callTimeoutMs,
    },
  ]);
  assert.deepEqual(result.textParts, ['正文', '[资源 file:///text]\n资源正文']);
  assert.deepEqual(result.structuredContent, { answer: 42 });
  assert.equal(result.isError, true);
  assert.deepEqual(result.attachments, [
    { type: 'image', mimeType: 'image/png', size: 5 },
    { type: 'audio', mimeType: 'audio/wav', size: 5 },
    { type: 'resource', uri: 'file:///blob', mimeType: 'application/octet-stream', size: 4 },
    { type: 'resource_link', uri: 'file:///linked', name: 'linked', mimeType: undefined, size: 9 },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /aW1hZ2U=|YXVkaW8=|YmxvYg==/);
});

test('callTool 支持并发乱序完成且保留响应配对', async () => {
  const client = makeClient({
    async callTool(request) {
      const { name } = request as { name: string };
      await new Promise(resolve => setTimeout(resolve, name === 'slow' ? 20 : 1));
      return { content: [{ type: 'text', text: name }] };
    },
  });
  const session = makeSession(client);
  await session.connect();
  const signal = new AbortController().signal;

  const [slow, fast] = await Promise.all([
    session.callTool('slow', {}, signal),
    session.callTool('fast', {}, signal),
  ]);

  assert.deepEqual(slow.textParts, ['slow']);
  assert.deepEqual(fast.textParts, ['fast']);
});

test('callTool 区分取消、协议失败、断线和不可用状态', async () => {
  const secret = 'sdk-call-secret';
  const controller = new AbortController();
  const cancelled = makeSession(makeClient({
    async callTool(_request, _schema, options) {
      const signal = (options as { signal: AbortSignal }).signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    },
  }));
  await cancelled.connect();
  const pending = cancelled.callTool('wait', {}, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);

  const protocol = makeSession(makeClient({
    async callTool() { throw new Error(`invalid response ${secret}`); },
  }), stdioConfig([secret]));
  await protocol.connect();
  await assert.rejects(protocol.callTool('bad', {}, new AbortController().signal), (error: unknown) => {
    assert.ok(error instanceof McpSessionError);
    assert.equal(error.code, 'MCP_PROTOCOL_ERROR');
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });

  const disconnectedClient = makeClient();
  const disconnected = makeSession(disconnectedClient);
  await disconnected.connect();
  disconnectedClient.onclose?.();
  assert.equal(disconnected.state, 'unavailable');
  await assert.rejects(
    disconnected.callTool('late', {}, new AbortController().signal),
    (error: unknown) => error instanceof McpSessionError && error.code === 'MCP_SERVER_UNAVAILABLE',
  );
});

test('stderr 使用有界尾部缓冲且公开错误经过脱敏和单行截断', async () => {
  const secret = 'stderr-secret';
  const client = makeClient({
    async listTools() { throw new Error(`protocol ${secret}`); },
  });
  const session = makeSession(client, stdioConfig([secret]), { ...OPTIONS, maxStderrBytes: 16 });
  const capture = (session as unknown as { captureStderr(chunk: unknown): void }).captureStderr.bind(session);
  capture('discarded-prefix-');
  capture(`${secret}\nlast-line`);
  await session.connect();

  await assert.rejects(session.listTools(), (error: unknown) => {
    assert.ok(error instanceof McpStartupError);
    assert.doesNotMatch(error.message, new RegExp(secret));
    assert.doesNotMatch(error.message, /discarded-prefix/);
    assert.doesNotMatch(error.message, /\n/);
    return true;
  });
});

test('close 幂等，主动关闭与意外关闭状态可区分', async () => {
  let clientCloseCount = 0;
  const client = makeClient({
    async close() { clientCloseCount += 1; },
  });
  const transport = fakeTransport();
  const session = makeSession(client, stdioConfig(), OPTIONS, transport);
  await session.connect();

  const first = session.close();
  const second = session.close();
  assert.equal(first, second);
  await first;

  assert.equal(session.state, 'closed');
  assert.equal(clientCloseCount, 1);
  client.onclose?.();
  assert.equal(session.state, 'closed');
});
