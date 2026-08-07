import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { McpConfigLoader } from './config-loader.js';

function makeFixture(t: test.TestContext): { root: string; home: string; outside: string } {
  const base = mkdtempSync(path.join(tmpdir(), 'bettercode-mcp-config-'));
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  const outside = path.join(base, 'outside');
  mkdirSync(root);
  mkdirSync(home);
  mkdirSync(outside);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { root, home, outside };
}

function writeConfig(base: string, content: string): string {
  const directory = path.join(base, '.bettercode');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'mcp.yaml');
  writeFileSync(file, content, 'utf8');
  return file;
}

function writeCompatibilityConfig(root: string, config: unknown): string {
  const file = path.join(root, '.mcp.json');
  writeFileSync(file, JSON.stringify(config), 'utf8');
  return file;
}

test('MCP config merges layers and fully overrides servers by name', t => {
  const { root, home } = makeFixture(t);
  writeConfig(home, `servers:
  shared:
    transport: stdio
    command: user-command
    args: [user]
  user-only:
    transport: stdio
    command: user-only
`);
  writeConfig(root, `servers:
  project-only:
    transport: http
    url: http://127.0.0.1:1234/mcp
  shared:
    transport: stdio
    command: project-command
`);

  const loaded = new McpConfigLoader(root, { userHome: home }).load();
  assert.deepEqual(loaded.servers.map(server => server.name), [
    'project-only', 'shared', 'user-only',
  ]);
  const shared = loaded.servers.find(server => server.name === 'shared');
  assert.equal(shared?.transport, 'stdio');
  if (shared?.transport === 'stdio') {
    assert.equal(shared.command, 'project-command');
    assert.deepEqual(shared.args, []);
  }
  assert.deepEqual(loaded.diagnostics, []);
});

test('MCP config bridges project .mcp.json stdio and HTTP servers', t => {
  const { root, home } = makeFixture(t);
  writeCompatibilityConfig(root, {
    mcpServers: {
      local: {
        command: 'node',
        args: ['server.js'],
        env: { TOKEN: '${TOKEN}' },
      },
      remote: {
        type: 'http',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer ${TOKEN}' },
      },
    },
  });

  const loaded = new McpConfigLoader(root, {
    userHome: home,
    env: { TOKEN: 'demo' },
  }).load();

  assert.deepEqual(loaded.servers.map(server => server.name), ['local', 'remote']);
  const local = loaded.servers.find(server => server.name === 'local');
  assert.equal(local?.transport, 'stdio');
  if (local?.transport === 'stdio') {
    assert.deepEqual(local.args, ['server.js']);
    assert.equal(local.env.TOKEN, 'demo');
  }
  const remote = loaded.servers.find(server => server.name === 'remote');
  assert.equal(remote?.transport, 'http');
  if (remote?.transport === 'http') {
    assert.equal(remote.url, 'https://example.test/mcp');
    assert.equal(remote.headers.Authorization, 'Bearer demo');
  }
  assert.deepEqual(loaded.diagnostics, []);
});

test('native project YAML overrides compatibility JSON and user config', t => {
  const { root, home } = makeFixture(t);
  writeConfig(home, `servers:
  shared:
    transport: stdio
    command: user-command
`);
  writeCompatibilityConfig(root, {
    mcpServers: {
      shared: { command: 'compat-command' },
      compatOnly: { command: 'compat-only' },
    },
  });
  writeConfig(root, `servers:
  shared:
    transport: stdio
    command: native-command
`);

  const loaded = new McpConfigLoader(root, { userHome: home }).load();

  assert.deepEqual(loaded.servers.map(server => server.name), ['compatOnly', 'shared']);
  const shared = loaded.servers.find(server => server.name === 'shared');
  assert.equal(shared?.transport, 'stdio');
  if (shared?.transport === 'stdio') assert.equal(shared.command, 'native-command');
  assert.deepEqual(loaded.diagnostics, []);
});

test('compatibility JSON isolates malformed files and invalid sibling servers', t => {
  const { root, home } = makeFixture(t);
  writeConfig(home, `servers:
  user:
    transport: stdio
    command: user-command
`);
  writeFileSync(path.join(root, '.mcp.json'), '{broken', 'utf8');

  const malformed = new McpConfigLoader(root, { userHome: home }).load();
  assert.deepEqual(malformed.servers.map(server => server.name), ['user']);
  assert.equal(malformed.diagnostics.length, 1);
  assert.equal(malformed.diagnostics[0].message, 'JSON 解析失败');

  writeCompatibilityConfig(root, {
    mcpServers: {
      valid: { transport: 'stdio', command: 'node' },
      missing: { type: 'http', url: 'https://example.test', headers: { Token: '${MISSING}' } },
      invalid: { type: 'sse', url: 'https://example.test' },
    },
  });
  const isolated = new McpConfigLoader(root, { userHome: home }).load();
  assert.deepEqual(isolated.servers.map(server => server.name), ['user', 'valid']);
  assert.equal(isolated.diagnostics.length, 2);
  assert.equal(isolated.diagnostics.some(item => item.code === 'ENV_MISSING'), true);
  assert.equal(isolated.diagnostics.some(item => item.serverName === 'invalid'), true);
});

test('invalid project override disables server without restoring user definition', t => {
  const { root, home } = makeFixture(t);
  writeConfig(home, `servers:
  shared:
    transport: stdio
    command: user-command
  healthy:
    transport: stdio
    command: healthy
`);
  writeConfig(root, `servers:
  shared:
    transport: stdio
`);

  const loaded = new McpConfigLoader(root, { userHome: home }).load();
  assert.deepEqual(loaded.servers.map(server => server.name), ['healthy']);
  assert.equal(loaded.diagnostics.length, 1);
  assert.equal(loaded.diagnostics[0].serverName, 'shared');
  assert.equal(loaded.diagnostics[0].layer, 'project');
});

test('MCP config isolates malformed layers and invalid sibling servers', t => {
  const { root, home } = makeFixture(t);
  writeConfig(home, `servers:
  valid:
    transport: stdio
    command: node
  invalid:
    transport: http
    url: ftp://example.test/mcp
`);
  writeConfig(root, 'servers: [broken');

  const loaded = new McpConfigLoader(root, { userHome: home }).load();
  assert.deepEqual(loaded.servers.map(server => server.name), ['valid']);
  assert.equal(loaded.diagnostics.length, 2);
  assert.equal(loaded.diagnostics.some(item => item.serverName === 'invalid'), true);
  assert.equal(loaded.diagnostics.some(item => item.layer === 'project'), true);
});

test('MCP config expands secrets and disables only missing-variable server', t => {
  const { root, home } = makeFixture(t);
  writeConfig(home, `servers:
  local:
    transport: stdio
    command: node
    env:
      TOKEN: pre-\${TOKEN}-\${TOKEN}
  remote:
    transport: http
    url: https://example.test/mcp
    headers:
      Authorization: Bearer \${MISSING}
  healthy:
    transport: http
    url: http://127.0.0.1:8080/mcp
    headers:
      X-Key: \${TOKEN}
`);
  const secret = 'test-secret-value';
  const loaded = new McpConfigLoader(root, {
    userHome: home,
    env: { TOKEN: secret },
  }).load();

  assert.deepEqual(loaded.servers.map(server => server.name), ['healthy', 'local']);
  const local = loaded.servers.find(server => server.name === 'local');
  if (local?.transport === 'stdio') assert.equal(local.env.TOKEN, `pre-${secret}-${secret}`);
  const diagnostics = JSON.stringify(loaded.diagnostics);
  assert.match(diagnostics, /MISSING/u);
  assert.equal(diagnostics.includes(secret), false);
  assert.equal(diagnostics.includes('Bearer'), false);
});

test('MCP project config rejects symlink escape and keeps user layer', t => {
  const { root, home, outside } = makeFixture(t);
  writeConfig(home, `servers:
  user:
    transport: stdio
    command: node
`);
  const outsideFile = path.join(outside, 'mcp.yaml');
  writeFileSync(outsideFile, `servers:
  escaped:
    transport: stdio
    command: outside-secret
`, 'utf8');
  mkdirSync(path.join(root, '.bettercode'));
  symlinkSync(outsideFile, path.join(root, '.bettercode', 'mcp.yaml'));

  const loaded = new McpConfigLoader(root, { userHome: home }).load();
  assert.deepEqual(loaded.servers.map(server => server.name), ['user']);
  assert.equal(loaded.diagnostics.some(item => item.layer === 'project'), true);
  assert.equal(JSON.stringify(loaded.diagnostics).includes('outside-secret'), false);
});

test('MCP compatibility config rejects symlink escape and keeps user layer', t => {
  const { root, home, outside } = makeFixture(t);
  writeConfig(home, `servers:
  user:
    transport: stdio
    command: node
`);
  const outsideFile = path.join(outside, '.mcp.json');
  writeFileSync(outsideFile, JSON.stringify({
    mcpServers: { escaped: { command: 'outside-secret' } },
  }), 'utf8');
  symlinkSync(outsideFile, path.join(root, '.mcp.json'));

  const loaded = new McpConfigLoader(root, { userHome: home }).load();
  assert.deepEqual(loaded.servers.map(server => server.name), ['user']);
  assert.equal(loaded.diagnostics.some(item => item.file?.endsWith('.mcp.json')), true);
  assert.equal(JSON.stringify(loaded.diagnostics).includes('outside-secret'), false);
});

test('MCP server timeout_ms 在 yaml 与 .mcp.json 兼容层均生效且校验范围', t => {
  const { root, home } = makeFixture(t);
  writeConfig(home, `servers:
  slow:
    transport: stdio
    command: node
    timeout_ms: 90000
`);
  writeCompatibilityConfig(root, {
    mcpServers: {
      compat: { command: 'npx', args: ['x'], timeout_ms: 30000 },
    },
  });
  const loaded = new McpConfigLoader(root, { userHome: home }).load();
  const slow = loaded.servers.find(server => server.name === 'slow');
  const compat = loaded.servers.find(server => server.name === 'compat');
  assert.equal(slow?.timeoutMs, 90_000);
  assert.equal(compat?.timeoutMs, 30_000);
  assert.equal(loaded.diagnostics.length, 0);

  // 越界 timeout_ms 产生诊断
  writeConfig(home, `servers:
  bad:
    transport: stdio
    command: node
    timeout_ms: 999999
`);
  const bad = new McpConfigLoader(root, { userHome: home }).load();
  assert.equal(bad.servers.some(server => server.name === 'bad'), false);
  assert.match(bad.diagnostics[0]?.message ?? '', /timeout_ms/u);
});
