import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPermissionManagerFactory } from '../permission/factory.js';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import type { AgentDefinition } from './types.js';
import { SubAgentRunner } from './runner.js';

class ScriptProvider implements LLMProvider {
  readonly name = 'script';
  readonly model = 'script-model';
  readonly contextWindow = 128_000;
  readonly contextWindowIsDefault = false;
  readonly calls: ProviderRequest[] = [];

  constructor(
    private readonly scripts: Array<(request: ProviderRequest, emit: (event: StreamEvent) => void) => void>,
  ) {}

  async chat(request: ProviderRequest, emit: (event: StreamEvent) => void): Promise<void> {
    this.calls.push(structuredClone(request));
    this.scripts.shift()?.(request, emit);
  }
}

function definition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'general', description: '通用', disallowedTools: [], backgroundTools: ['read_file'],
    model: 'inherit', maxIterations: 5, permissionMode: 'allow', scope: 'builtin',
    entryPath: '/agents/general.md', body: '完成单一任务。',
    ...overrides,
  };
}

function done(emit: (event: StreamEvent) => void): void {
  emit({ type: 'done', content: '' });
}

test('定义式 Runner 从空历史和固定角色 System 启动', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'note.txt'), 'hello');
  const registry = createCoreToolRegistry(root);
  const provider = new ScriptProvider([
    (_request, emit) => {
      emit({ type: 'tool_call', call: { id: 'r1', name: 'read_file', arguments: { path: 'note.txt' } } });
      done(emit);
    },
    (_request, emit) => { emit({ type: 'text_delta', content: '读取完成' }); done(emit); },
  ]);
  const leases: string[] = [];
  const runner = new SubAgentRunner(
    registry,
    createPermissionManagerFactory(registry, { userHome: path.join(root, '.home') }),
    { skillManager: {
      beginExecution: () => { leases.push('begin'); },
      endExecution: () => { leases.push('end'); },
    } },
  );
  const outcome = await runner.run({
    kind: 'defined', definition: definition(), provider, task: '读取 note.txt', mode: 'act',
    foregroundTools: new Set(registry.names()), backgroundTools: new Set(['read_file']),
    isBackground: () => false,
  }, { taskId: 'sa-1', sessionId: 's1', parentTurnId: 'turn-1' },
  new AbortController().signal, () => undefined);

  assert.equal(outcome.reason, 'completed');
  assert.match(provider.calls[0].systemPrompt, /子 Agent 角色：general/);
  assert.equal(provider.calls[0].messages[0].role, 'user');
  assert.match(provider.calls[0].messages[0].content, /读取 note\.txt/);
  assert.equal(provider.calls[0].messages.some(message => message.content.includes('父对话')), false);
  assert.deepEqual(leases, ['begin', 'end']);
});

test('定义式 Runner 在流期间转后台后阻止副作用工具', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = createCoreToolRegistry(root);
  let background = false;
  const provider = new ScriptProvider([
    (request, emit) => {
      assert.ok(request.tools.some(tool => tool.name === 'write_file'));
      emit({ type: 'tool_call', call: {
        id: 'w1', name: 'write_file', arguments: { path: 'blocked.txt', content: 'no' },
      } });
      background = true;
      done(emit);
    },
    (_request, emit) => { emit({ type: 'text_delta', content: '已调整' }); done(emit); },
  ]);
  const runner = new SubAgentRunner(
    registry,
    createPermissionManagerFactory(registry, { userHome: path.join(root, '.home') }),
  );
  await runner.run({
    kind: 'defined', definition: definition(), provider, task: '尝试写入', mode: 'act',
    foregroundTools: new Set(registry.names()), backgroundTools: new Set(['read_file']),
    isBackground: () => background,
  }, { taskId: 'sa-2', sessionId: 's1' }, new AbortController().signal, () => undefined);

  const toolMessage = provider.calls[1].messages.find(message => message.role === 'tool');
  assert.match(toolMessage?.content ?? '', /TOOL_UNAVAILABLE/);
});

test('定义式 Runner 把非交互确认缺失归一化为普通权限拒绝', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'note.txt'), 'hello');
  const registry = createCoreToolRegistry(root);
  const provider = new ScriptProvider([
    (_request, emit) => {
      emit({ type: 'tool_call', call: { id: 'r1', name: 'read_file', arguments: { path: 'note.txt' } } });
      done(emit);
    },
    (_request, emit) => { emit({ type: 'text_delta', content: '权限不足' }); done(emit); },
  ]);
  const runner = new SubAgentRunner(
    registry,
    createPermissionManagerFactory(registry, { userHome: path.join(root, '.home') }),
  );
  await runner.run({
    kind: 'defined', definition: definition({ permissionMode: 'default' }), provider,
    task: '读取', mode: 'act', foregroundTools: new Set(['read_file']),
    backgroundTools: new Set(['read_file']), isBackground: () => false,
  }, { taskId: 'sa-3', sessionId: 's1' }, new AbortController().signal, () => undefined);

  const content = provider.calls[1].messages.find(message => message.role === 'tool')?.content ?? '';
  assert.match(content, /PERMISSION_DENIED/);
  assert.doesNotMatch(content, /PERMISSION_UNAVAILABLE/);
});

test('Fork Runner 保留父请求前缀、System 和固定工具顺序', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = createCoreToolRegistry(root);
  const provider = new ScriptProvider([
    (_request, emit) => { emit({ type: 'text_delta', content: 'Fork 完成' }); done(emit); },
  ]);
  const parent: ProviderRequest = {
    systemPrompt: '父 System',
    messages: [
      { role: 'user', content: '父对话' },
      { role: 'assistant', content: '父回答' },
    ],
    tools: registry.definitions().filter(tool => tool.name === 'search_code' || tool.name === 'read_file'),
  };
  const runner = new SubAgentRunner(
    registry,
    createPermissionManagerFactory(registry, { userHome: path.join(root, '.home') }),
  );
  await runner.run({
    kind: 'fork', provider, task: '继续分析', mode: 'plan', parentRequest: parent,
    toolDefinitions: parent.tools, maxIterations: 3, permissionMode: 'allow',
  }, { taskId: 'sa-fork', sessionId: 's1' }, new AbortController().signal, () => undefined);

  assert.equal(provider.calls[0].systemPrompt, parent.systemPrompt);
  assert.deepEqual(provider.calls[0].messages.slice(0, parent.messages.length), parent.messages);
  assert.deepEqual(provider.calls[0].tools.map(tool => tool.name), ['read_file', 'search_code']);
  assert.match(provider.calls[0].messages[parent.messages.length].content, /继续分析/);
});
