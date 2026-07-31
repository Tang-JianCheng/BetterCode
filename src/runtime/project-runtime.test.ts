import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPermissionManagerFactory } from '../permission/factory.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { ProjectRuntimeFactory } from './project-runtime.js';

test('ProjectRuntimeFactory 按绝对根目录隔离工具、缓存、指令和记忆', async t => {
  const parent = mkdtempSync(path.join(tmpdir(), 'bettercode-runtime-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const leftRoot = path.join(parent, 'left');
  const rightRoot = path.join(parent, 'right');
  for (const [root, content] of [[leftRoot, 'left'], [rightRoot, 'right']] as const) {
    mkdirSync(path.join(root, '.bettercode', 'memory'), { recursive: true });
    writeFileSync(path.join(root, 'same.txt'), content);
    writeFileSync(path.join(root, 'AGENTS.md'), `${content} 指令`);
    writeFileSync(path.join(root, '.bettercode', 'memory', `${content}.md`), `---\nname: ${content}\ndescription: ${content}\ntype: project\n---\n${content} 记忆\n`);
  }
  const source = createCoreToolRegistry(leftRoot);
  const factory = new ProjectRuntimeFactory(source, createPermissionManagerFactory(source), {
    userHome: path.join(parent, 'home'),
  });
  const left = factory.create(leftRoot, 'allow');
  const right = factory.create(rightRoot, 'allow');
  const signal = new AbortController().signal;
  const leftResult = await left.registry.execute({ id: 'l', name: 'read_file', arguments: { path: 'same.txt' } }, signal, left.executionState);
  const rightResult = await right.registry.execute({ id: 'r', name: 'read_file', arguments: { path: 'same.txt' } }, signal, right.executionState);
  assert.equal(leftResult.output, 'left');
  assert.equal(rightResult.output, 'right');
  assert.match(left.supplemental.customInstructions ?? '', /left 指令/);
  assert.doesNotMatch(left.supplemental.customInstructions ?? '', /right 指令/);
  assert.match(right.supplemental.longTermMemory ?? '', /\[right\]/);
  assert.doesNotMatch(right.supplemental.longTermMemory ?? '', /\[left\]/);
  await left.close();
  const afterClose = await right.registry.execute({ id: 'r2', name: 'read_file', arguments: { path: 'same.txt' } }, signal, right.executionState);
  assert.equal(afterClose.output, 'right');
  await right.close();
});
