import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ToolResultTransformInput } from '../agent/loop.js';
import { createPermissionManagerFactory } from '../permission/factory.js';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import type { Tool } from '../tool/types.js';
import { createToolSuccess } from '../tool/types.js';
import { AgentDefinitionManager } from './definition-manager.js';
import { AgentTool } from './agent-tool.js';
import { SubAgentCoordinator } from './coordinator.js';
import { SubAgentResultInbox } from './result-inbox.js';
import { SubAgentRunner } from './runner.js';
import { SubAgentTaskManager } from './task-manager.js';
import { resolveSubAgentOptions } from './types.js';

class QueueProvider implements LLMProvider {
  readonly name = 'main';
  readonly model = 'main-model';
  readonly contextWindow = 128_000;
  readonly contextWindowIsDefault = false;
  readonly calls: ProviderRequest[] = [];
  readonly scripts: Array<(request: ProviderRequest, emit: (event: StreamEvent) => void) => Promise<void> | void> = [];

  async chat(request: ProviderRequest, emit: (event: StreamEvent) => void): Promise<void> {
    this.calls.push(structuredClone(request));
    await this.scripts.shift()?.(request, emit);
  }
}

function agentDocument(): string {
  return `---
name: general
description: 通用测试角色
disallowed_tools: []
background_tools: [read_file]
model: inherit
max_iterations: 5
permission_mode: allow
---
完成收到的测试任务。
`;
}

function setup(root: string, provider: QueueProvider, foregroundTimeoutMs = 1000) {
  const builtin = path.join(root, 'agents');
  mkdirSync(builtin, { recursive: true });
  writeFileSync(path.join(builtin, 'general.md'), agentDocument());
  const registry = createCoreToolRegistry(root);
  registry.register(new AgentTool(), { system: true });
  const loadSkill: Tool = {
    name: 'load_skill', effect: 'read_only', description: 'load',
    inputSchema: { type: 'object', additionalProperties: false },
    permission: { targetKind: 'arguments', risk: 'read' },
    async execute() { return createToolSuccess('loaded'); },
  };
  registry.register(loadSkill, { system: true });
  const options = resolveSubAgentOptions({ foreground_timeout_ms: foregroundTimeoutMs });
  const definitions = new AgentDefinitionManager(registry, root, {
    builtinDirectory: builtin,
    providerNames: ['main'],
    deniedTools: options.deniedTools,
  });
  definitions.initialize();
  const tasks = new SubAgentTaskManager(options.foregroundTimeoutMs, options.retainedTasks);
  const inbox = new SubAgentResultInbox();
  const runner = new SubAgentRunner(
    registry,
    createPermissionManagerFactory(registry, { userHome: path.join(root, '.home') }),
  );
  const coordinator = new SubAgentCoordinator(
    registry,
    definitions,
    { has: name => name === 'main', resolve: () => provider },
    runner,
    tasks,
    inbox,
    options,
    { defaultProvider: () => provider },
  );
  coordinator.setActiveSession('s1');
  return { registry, definitions, tasks, inbox, coordinator };
}

async function dispatchInput(
  registry: ReturnType<typeof createCoreToolRegistry>,
  provider: LLMProvider,
  arguments_: Record<string, unknown>,
): Promise<ToolResultTransformInput> {
  const call = { id: 'agent-call', name: 'agent', arguments: arguments_ };
  const result = await registry.execute(call);
  return {
    call,
    result,
    history: [{ role: 'user', content: '父历史' }],
    request: {
      history: [], userMessage: '父任务', mode: 'act', provider,
      signal: new AbortController().signal,
    },
    providerRequest: {
      systemPrompt: '父 System',
      messages: [{ role: 'user', content: '父历史' }],
      tools: registry.definitions(),
    },
    iteration: 1,
    emit: () => undefined,
  };
}

async function waitForTerminal(
  get: () => { state: string } | undefined,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current = get();
    if (current && ['completed', 'failed', 'cancelled'].includes(current.state)) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('等待子 Agent 终态超时');
}

test('Coordinator 把定义式前台最终文本转换为工具结果', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-coordinator-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new QueueProvider();
  provider.scripts.push((_request, emit) => {
    emit({ type: 'text_delta', content: '子任务完成' });
    emit({ type: 'done', content: '' });
  });
  const system = setup(root, provider);
  const input = await dispatchInput(system.registry, provider, {
    type: 'defined', role: 'general', task: '检查项目',
  });
  const result = await system.coordinator.transformToolResult(input, {
    sessionId: 's1', permissionMode: 'default', parentTurnId: 'turn-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.output, '子任务完成');
  assert.equal(system.coordinator.list('s1')[0].state, 'completed');
  assert.equal(system.inbox.runtime('s1').prepare(), undefined);
  await system.coordinator.close();
  await system.definitions.close();
});

test('Coordinator 显式后台立即返回任务 ID 并在完成后进入收件箱', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-coordinator-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new QueueProvider();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  provider.scripts.push(async (_request, emit) => {
    await gate;
    emit({ type: 'text_delta', content: '后台完成' });
    emit({ type: 'done', content: '' });
  });
  const system = setup(root, provider);
  const input = await dispatchInput(system.registry, provider, {
    type: 'defined', role: 'general', task: '后台检查', background: true,
  });
  const result = await system.coordinator.transformToolResult(input, {
    sessionId: 's1', permissionMode: 'default',
  });
  const taskId = String(result.metadata.subagentTaskId);

  assert.equal(result.metadata.background, true);
  assert.match(result.output, new RegExp(taskId));
  release();
  await waitForTerminal(() => system.coordinator.get('s1', taskId));
  assert.deepEqual(system.inbox.runtime('s1').prepare()?.entries.map(entry => entry.taskId), [taskId]);
  await system.coordinator.close();
  await system.definitions.close();
});

test('Coordinator 强制 Fork 后台并移除 agent 与 load_skill', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-coordinator-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new QueueProvider();
  provider.scripts.push((_request, emit) => {
    emit({ type: 'text_delta', content: 'Fork 完成' });
    emit({ type: 'done', content: '' });
  });
  const system = setup(root, provider);
  const input = await dispatchInput(system.registry, provider, { type: 'fork', task: '并行分析' });
  const result = await system.coordinator.transformToolResult(input, {
    sessionId: 's1', permissionMode: 'allow',
  });
  const taskId = String(result.metadata.subagentTaskId);
  await waitForTerminal(() => system.coordinator.get('s1', taskId));

  assert.equal(result.metadata.backgroundReason, 'fork');
  assert.equal(provider.calls[0].systemPrompt, '父 System');
  assert.deepEqual(provider.calls[0].messages.slice(0, 1), input.providerRequest.messages);
  assert.equal(provider.calls[0].tools.some(tool => tool.name === 'agent' || tool.name === 'load_skill'), false);
  await system.coordinator.close();
  await system.definitions.close();
});

test('Coordinator 提供 Hook 入口并拒绝未知角色和失效会话', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-coordinator-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new QueueProvider();
  provider.scripts.push((_request, emit) => {
    emit({ type: 'text_delta', content: 'Hook 完成' });
    emit({ type: 'done', content: '' });
  });
  const system = setup(root, provider);
  const hook = await system.coordinator.runHookAgent({
    prompt: '检查', background: false, sessionId: 's1', mode: 'act',
    signal: new AbortController().signal,
  });
  assert.deepEqual(hook, { status: 'completed', output: 'Hook 完成' });

  const unknown = await system.coordinator.runHookAgent({
    role: 'missing', prompt: '检查', background: false, sessionId: 's1', mode: 'act',
    signal: new AbortController().signal,
  });
  assert.equal(unknown.status, 'failed');
  await system.coordinator.cancelSession('s1', '切换会话');
  const unavailable = await system.coordinator.runHookAgent({
    prompt: '检查', background: false, sessionId: 's1', mode: 'act',
    signal: new AbortController().signal,
  });
  assert.equal(unavailable.status, 'failed');
  await system.coordinator.close();
  await system.definitions.close();
});
