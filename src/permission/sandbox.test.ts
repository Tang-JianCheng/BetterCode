import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PathGuard } from '../tool/path-guard.js';
import type { Tool } from '../tool/types.js';
import { SandboxPolicy } from './sandbox.js';

function makeTool(
  targetKind: Tool['permission']['targetKind'],
  targetArgument = 'target',
): Tool {
  return {
    name: `test_${targetKind}`,
    effect: 'read_only',
    description: 'test tool',
    inputSchema: { type: 'object' },
    permission: {
      targetArgument,
      targetKind,
      pathIntent: targetKind === 'path' ? 'existing' : undefined,
      risk: 'read',
    },
    async execute() {
      throw new Error('不应执行');
    },
  };
}

function makeArgumentsTool(): Tool {
  return {
    name: 'mcp_test_tool_deadbeef',
    effect: 'side_effect',
    description: 'test MCP tool',
    inputSchema: { type: 'object' },
    permission: { targetKind: 'arguments', risk: 'execute' },
    async execute() {
      throw new Error('不应执行');
    },
  };
}

test('sandbox normalizes project paths, globs and command targets', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-sandbox-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'inside.txt'), 'ok');
  const sandbox = new SandboxPolicy(new PathGuard(root));

  assert.equal(sandbox.resolveSubject(makeTool('path'), { target: './inside.txt' }).target, 'inside.txt');
  assert.equal(sandbox.resolveSubject(makeTool('path'), { target: 'nested/new.txt' }).target, 'nested/new.txt');
  assert.equal(sandbox.resolveSubject(makeTool('glob'), { target: 'src/**/*.ts' }).target, 'src/**/*.ts');
  assert.equal(sandbox.resolveSubject(makeTool('command'), { target: 'git status ' }).target, 'git status ');
  assert.throws(() => sandbox.resolveSubject(makeTool('path'), { target: '../outside.txt' }), /项目根目录/);
  assert.throws(() => sandbox.resolveSubject(makeTool('glob'), { target: '../**' }), /项目根目录/);
});

test('sandbox rejects external and dangling symlink targets', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-sandbox-root-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'bettercode-sandbox-outside-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'external-file'));
  symlinkSync(outside, path.join(root, 'external-dir'));
  symlinkSync(path.join(outside, 'missing.txt'), path.join(root, 'dangling'));
  const sandbox = new SandboxPolicy(new PathGuard(root));
  const tool = makeTool('path');

  assert.throws(() => sandbox.resolveSubject(tool, { target: 'external-file' }), /项目根目录/);
  assert.throws(() => sandbox.resolveSubject(tool, { target: 'external-dir/new.txt' }), /项目根目录/);
  assert.throws(() => sandbox.resolveSubject(tool, { target: 'dangling' }), /悬空符号链接/);
});

test('sandbox serializes complete MCP arguments deterministically', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-sandbox-arguments-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sandbox = new SandboxPolicy(new PathGuard(root));
  const tool = makeArgumentsTool();

  const first = sandbox.resolveSubject(tool, { path: 'a/b', nested: { z: 1, a: true } });
  const second = sandbox.resolveSubject(tool, { nested: { a: true, z: 1 }, path: 'a/b' });
  assert.equal(first.target, second.target);
  assert.equal(first.target, '{"nested":{"a":true,"z":1},"path":"a/b"}');

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => sandbox.resolveSubject(tool, circular), /权限参数对象无效/u);
});
