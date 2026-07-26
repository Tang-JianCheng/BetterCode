import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCoreToolRegistry } from '../tool/factory.js';
import { createToolSuccess, type Tool } from '../tool/types.js';
import { createMcpToolName } from './naming.js';
import { McpManager } from './manager.js';
import {
  McpStartupError,
  type LoadedMcpConfig,
  type McpRemoteTool,
  type McpServerConfig,
  type McpSession,
  type McpSessionFactory,
} from './types.js';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-mcp-manager-'));
}

function makeConfig(name: string): McpServerConfig {
  return {
    name,
    layer: 'project',
    file: '/project/.bettercode/mcp.yaml',
    transport: 'stdio',
    command: 'fixture',
    args: [],
    env: {},
    secretValues: [],
  };
}

function makeLoaded(names: string[], secretValues: string[] = []): LoadedMcpConfig {
  return {
    servers: names.map(makeConfig),
    diagnostics: [],
    secretValues,
  };
}

function makeTool(name: string, readOnly = true, inputSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: true,
}): McpRemoteTool {
  return { name, description: `${name} 工具`, inputSchema, readOnly };
}

interface SessionControl {
  session: McpSession;
  connectCount: number;
  listCount: number;
  callCount: number;
  closeCount: number;
}

function controlledSession(options: {
  name: string;
  tools?: McpRemoteTool[];
  delayMs?: number;
  connectError?: Error;
  listError?: Error;
  closeError?: Error;
}): SessionControl {
  const control: SessionControl = {
    connectCount: 0,
    listCount: 0,
    callCount: 0,
    closeCount: 0,
    session: undefined as unknown as McpSession,
  };
  let state: McpSession['state'] = 'new';
  control.session = {
    serverName: options.name,
    get state() { return state; },
    async connect() {
      control.connectCount += 1;
      if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
      if (options.connectError) throw options.connectError;
      state = 'connected';
    },
    async listTools() {
      control.listCount += 1;
      if (options.listError) throw options.listError;
      return options.tools ?? [];
    },
    async callTool(name, input) {
      control.callCount += 1;
      return {
        isError: false,
        textParts: [`${options.name}:${name}:${JSON.stringify(input)}`],
        attachments: [],
      };
    },
    async close() {
      control.closeCount += 1;
      state = 'closed';
      if (options.closeError) throw options.closeError;
    },
  };
  return control;
}

test('管理器并行发现并按 Server 和远端工具名稳定注册', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const controls = new Map([
    ['zeta', controlledSession({ name: 'zeta', delayMs: 35, tools: [makeTool('beta'), makeTool('alpha')] })],
    ['alpha', controlledSession({ name: 'alpha', delayMs: 35, tools: [makeTool('zulu')] })],
  ]);
  const factory: McpSessionFactory = config => controls.get(config.name)!.session;
  const registry = createCoreToolRegistry(root);
  const started = Date.now();
  const manager = new McpManager(root, makeLoaded(['zeta', 'alpha']), { sessionFactory: factory });

  const status = await manager.initialize(registry);
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 65, `发现过程未并行执行: ${elapsed}ms`);
  assert.deepEqual(status, {
    configuredServers: 2,
    connectedServers: 2,
    registeredTools: 3,
    diagnostics: [],
  });
  assert.deepEqual(registry.definitions().slice(6).map(item => item.name), [
    createMcpToolName('alpha', 'zulu'),
    createMcpToolName('zeta', 'alpha'),
    createMcpToolName('zeta', 'beta'),
  ]);

  const result = await registry.execute({
    id: 'call',
    name: createMcpToolName('zeta', 'alpha'),
    arguments: { value: 'ok' },
  });
  assert.equal(result.ok, true);
  assert.match(result.output, /zeta:alpha/);
  assert.equal(controls.get('zeta')?.callCount, 1);
  await manager.close();
});

test('管理器隔离连接、发现和非法 Schema 故障', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const secret = 'manager-secret-value';
  const controls = new Map([
    ['connect-fail', controlledSession({
      name: 'connect-fail',
      connectError: new McpStartupError('TRANSPORT_ERROR', `spawn failed ${secret}`),
    })],
    ['discover-fail', controlledSession({
      name: 'discover-fail',
      listError: new Error(`list failed ${secret}`),
    })],
    ['healthy', controlledSession({
      name: 'healthy',
      tools: [
        makeTool('broken', true, { type: 'invalid-schema-type' }),
        makeTool('working'),
      ],
    })],
  ]);
  const loaded = makeLoaded(['connect-fail', 'discover-fail', 'healthy'], [secret]);
  loaded.servers = loaded.servers.map(config => ({ ...config, secretValues: [secret] }));
  const manager = new McpManager(root, loaded, {
    sessionFactory: config => controls.get(config.name)!.session,
  });
  const registry = createCoreToolRegistry(root);

  const status = await manager.initialize(registry);

  assert.equal(status.connectedServers, 1);
  assert.equal(status.registeredTools, 1);
  assert.deepEqual(status.diagnostics.map(item => item.code).sort(), [
    'DISCOVERY_ERROR', 'TOOL_SCHEMA_ERROR', 'TRANSPORT_ERROR',
  ]);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(secret));
  assert.equal(controls.get('connect-fail')?.closeCount, 1);
  assert.equal(controls.get('discover-fail')?.closeCount, 1);
  assert.ok(registry.get(createMcpToolName('healthy', 'working')));
  assert.equal(registry.get(createMcpToolName('healthy', 'broken')), undefined);
  assert.equal(registry.definitions().slice(0, 6).length, 6);
  await manager.close();
});

test('管理器跳过本地名称冲突并保持其他工具可用', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = makeTool('echo');
  const localName = createMcpToolName('demo', remote.name);
  const existing: Tool = {
    name: localName,
    description: '预先注册',
    inputSchema: { type: 'object', additionalProperties: true },
    effect: 'read_only',
    permission: { targetKind: 'arguments', risk: 'read' },
    async execute() { return createToolSuccess('existing'); },
  };
  const registry = createCoreToolRegistry(root);
  registry.register(existing);
  const control = controlledSession({ name: 'demo', tools: [remote, makeTool('other')] });
  const manager = new McpManager(root, makeLoaded(['demo']), {
    sessionFactory: () => control.session,
  });

  const status = await manager.initialize(registry);

  assert.equal(status.registeredTools, 1);
  assert.equal(status.diagnostics[0]?.code, 'TOOL_NAME_CONFLICT');
  assert.equal(registry.get(localName), existing);
  assert.ok(registry.get(createMcpToolName('demo', 'other')));
  await manager.close();
});

test('管理器对空配置和重复初始化保持幂等', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = createCoreToolRegistry(root);
  let factoryCalls = 0;
  const manager = new McpManager(root, makeLoaded([]), {
    sessionFactory: () => {
      factoryCalls += 1;
      return controlledSession({ name: 'unused' }).session;
    },
  });

  const first = await manager.initialize(registry);
  const second = await manager.initialize(registry);

  assert.deepEqual(first, second);
  assert.equal(factoryCalls, 0);
  assert.equal(registry.definitions().length, 6);
  await manager.close();
  assert.deepEqual(await manager.initialize(registry), manager.getStatus());
});

test('管理器关闭所有成功会话并隔离、脱敏关闭错误', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const secret = 'close-secret-value';
  const healthy = controlledSession({ name: 'healthy' });
  const broken = controlledSession({ name: 'broken', closeError: new Error(`close ${secret}`) });
  const controls = new Map([['healthy', healthy], ['broken', broken]]);
  const loaded = makeLoaded(['healthy', 'broken'], [secret]);
  loaded.servers = loaded.servers.map(config => ({ ...config, secretValues: [secret] }));
  const manager = new McpManager(root, loaded, {
    sessionFactory: config => controls.get(config.name)!.session,
  });
  await manager.initialize(createCoreToolRegistry(root));

  const first = await manager.close();
  const second = await manager.close();

  assert.equal(healthy.closeCount, 1);
  assert.equal(broken.closeCount, 1);
  assert.equal(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.code, 'CLOSE_ERROR');
  assert.doesNotMatch(JSON.stringify(first), new RegExp(secret));
});

test('初始化期间关闭会等待发现结束并回收成功会话', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const control = controlledSession({ name: 'slow', delayMs: 20, tools: [makeTool('echo')] });
  const manager = new McpManager(root, makeLoaded(['slow']), {
    sessionFactory: () => control.session,
  });
  const initialization = manager.initialize(createCoreToolRegistry(root));

  const closing = manager.close();
  await Promise.all([initialization, closing]);

  assert.equal(control.connectCount, 1);
  assert.equal(control.closeCount, 1);
  assert.equal(control.session.state, 'closed');
});
