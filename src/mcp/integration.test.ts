import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createCoreToolRegistry } from '../tool/factory.js';
import { createMcpManager } from './factory.js';
import { createMcpToolName } from './naming.js';

function makeFixture(t: test.TestContext): { root: string; home: string } {
  const base = mkdtempSync(path.join(tmpdir(), 'bettercode-mcp-integration-'));
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  mkdirSync(root);
  mkdirSync(home);
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return { root, home };
}

function writeProjectConfig(root: string, content: string): void {
  const directory = path.join(root, '.bettercode');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'mcp.yaml'), content, 'utf8');
}

function writeCompatibilityConfig(root: string, config: unknown): void {
  writeFileSync(path.join(root, '.mcp.json'), JSON.stringify(config), 'utf8');
}

function registryCall(name: string, arguments_: Record<string, unknown>) {
  return { id: randomUUID(), name, arguments: arguments_ };
}

test('stdio: 真实 Server 完成配置、发现、注册、并发调用、错误和关闭', async t => {
  const { root, home } = makeFixture(t);
  const tsxCli = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
  const fixture = fileURLToPath(new URL('./fixtures/stdio-server.ts', import.meta.url));
  writeProjectConfig(root, `servers:
  fixture:
    transport: stdio
    command: ${JSON.stringify(process.execPath)}
    args:
      - ${JSON.stringify(tsxCli)}
      - ${JSON.stringify(fixture)}
    env:
      BETTERCODE_MCP_FIXTURE_VALUE: \"\${FIXTURE_VALUE}\"
`);
  const registry = createCoreToolRegistry(root, { timeoutMs: 1_000 });
  const manager = createMcpManager(root, {
    userHome: home,
    env: { FIXTURE_VALUE: 'expanded-value' },
    connectTimeoutMs: 5_000,
    discoveryTimeoutMs: 5_000,
    callTimeoutMs: 2_000,
  });
  t.after(async () => { await manager.close(); });

  const status = await manager.initialize(registry);

  assert.equal(status.connectedServers, 1);
  assert.equal(status.registeredTools, 4);
  assert.deepEqual(status.diagnostics, []);
  const echoName = createMcpToolName('fixture', 'echo');
  const delayName = createMcpToolName('fixture', 'delay_echo');
  const errorName = createMcpToolName('fixture', 'business_error');
  const mediaName = createMcpToolName('fixture', 'media');
  assert.equal(registry.effectOf(echoName), 'read_only');
  assert.equal(registry.effectOf(errorName), 'side_effect');
  assert.deepEqual(registry.get(echoName)?.permission, { targetKind: 'arguments', risk: 'read' });

  const echo = await registry.execute(registryCall(echoName, {
    value: 'hello',
    expectedEnv: 'expanded-value',
  }));
  assert.equal(echo.ok, true);
  assert.match(echo.output, /"envMatches":true/);
  assert.match(echo.output, /结构化结果:\n\{"value":"hello"\}/);

  const [slow, fast] = await Promise.all([
    registry.execute(registryCall(delayName, { value: 'slow', delayMs: 40 })),
    registry.execute(registryCall(delayName, { value: 'fast', delayMs: 1 })),
  ]);
  assert.equal(slow.output, 'slow');
  assert.equal(fast.output, 'fast');

  const business = await registry.execute(registryCall(errorName, { message: 'expected error' }));
  assert.equal(business.error?.code, 'MCP_TOOL_ERROR');
  assert.equal(business.output, 'expected error');

  const media = await registry.execute(registryCall(mediaName, {}));
  assert.equal(media.ok, true);
  assert.match(media.output, /附件摘要/);
  assert.doesNotMatch(media.output, /Zml4dHVyZS1pbWFnZQ==/);

  const diagnostics = await manager.close();
  assert.deepEqual(diagnostics, []);
});

interface HttpFixture {
  url: string;
  close(): Promise<void>;
  authorizationHeaders: string[];
  sessionHeaders: Array<string | undefined>;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function createHttpMcpServer(): McpServer {
  const server = new McpServer({ name: 'bettercode-http-fixture', version: '1.0.0' });
  server.registerTool('echo', {
    description: 'HTTP 回显',
    inputSchema: { value: z.string() },
    annotations: { readOnlyHint: true },
  }, async ({ value }) => ({ content: [{ type: 'text', text: value }] }));
  server.registerTool('delay_echo', {
    description: 'HTTP 延迟回显',
    inputSchema: { value: z.string(), delayMs: z.number().int().min(0).max(2_000) },
    annotations: { readOnlyHint: true },
  }, async ({ value, delayMs }) => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return { content: [{ type: 'text', text: value }] };
  });
  return server;
}

async function startHttpFixture(): Promise<HttpFixture> {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const servers = new Set<McpServer>();
  const authorizationHeaders: string[] = [];
  const sessionHeaders: Array<string | undefined> = [];
  const httpServer = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    authorizationHeaders.push(String(request.headers.authorization ?? ''));
    const sessionId = request.headers['mcp-session-id'];
    sessionHeaders.push(typeof sessionId === 'string' ? sessionId : undefined);
    if (request.method === 'GET') {
      response.writeHead(405, { Allow: 'POST, DELETE' }).end('Method Not Allowed');
      return;
    }
    try {
      const body = request.method === 'POST' ? await readJsonBody(request) : undefined;
      let transport = typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
      if (!transport && request.method === 'POST' && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          onsessioninitialized: id => {
            transports.set(id, transport!);
          },
        });
        const mcpServer = createHttpMcpServer();
        servers.add(mcpServer);
        await mcpServer.connect(transport);
      }
      if (!transport) {
        response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Missing or invalid session' },
          id: null,
        }));
        return;
      }
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
          id: null,
        }));
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('无法获取 HTTP 测试端口');
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    authorizationHeaders,
    sessionHeaders,
    async close() {
      await Promise.allSettled([...servers].map(server => server.close()));
      await Promise.allSettled([...transports.values()].map(transport => transport.close()));
      await new Promise<void>((resolve, reject) => {
        httpServer.close(error => error ? reject(error) : resolve());
        httpServer.closeAllConnections();
      });
    },
  };
}

test('HTTP: 真实 Streamable HTTP 保持 header、session、并发配对且断线不重连', async t => {
  const { root, home } = makeFixture(t);
  const fixture = await startHttpFixture();
  let fixtureClosed = false;
  t.after(async () => {
    if (!fixtureClosed) await fixture.close();
  });
  writeCompatibilityConfig(root, {
    mcpServers: {
      remote: {
        type: 'http',
        url: fixture.url,
        headers: { Authorization: 'Bearer ${HTTP_TOKEN}' },
      },
    },
  });
  const registry = createCoreToolRegistry(root);
  const manager = createMcpManager(root, {
    userHome: home,
    env: { HTTP_TOKEN: 'tkn-1234' },
    connectTimeoutMs: 5_000,
    discoveryTimeoutMs: 5_000,
    callTimeoutMs: 2_000,
  });
  t.after(async () => { await manager.close(); });

  const status = await manager.initialize(registry);
  assert.equal(status.connectedServers, 1);
  assert.equal(status.registeredTools, 2);
  assert.deepEqual(status.diagnostics, []);

  const echoName = createMcpToolName('remote', 'echo');
  const delayName = createMcpToolName('remote', 'delay_echo');
  const echo = await registry.execute(registryCall(echoName, { value: 'http-ok' }));
  assert.equal(echo.output, 'http-ok');
  const [slow, fast] = await Promise.all([
    registry.execute(registryCall(delayName, { value: 'slow-http', delayMs: 30 })),
    registry.execute(registryCall(delayName, { value: 'fast-http', delayMs: 1 })),
  ]);
  assert.equal(slow.output, 'slow-http');
  assert.equal(fast.output, 'fast-http');
  assert.ok(fixture.authorizationHeaders.length >= 4);
  assert.equal(fixture.authorizationHeaders.every(value => value === 'Bearer tkn-1234'), true);
  const assignedSessions = fixture.sessionHeaders.filter((value): value is string => Boolean(value));
  assert.ok(assignedSessions.length >= 3);
  assert.equal(new Set(assignedSessions).size, 1);

  await fixture.close();
  fixtureClosed = true;
  const unavailable = await registry.execute(registryCall(echoName, { value: 'after-close' }));
  assert.equal(unavailable.error?.code, 'MCP_SERVER_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(unavailable), /tkn-1234/);
  assert.deepEqual(await manager.close(), []);
});
