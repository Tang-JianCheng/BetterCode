import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChatManager } from '../chat/manager.js';
import { createPermissionManager, createPermissionManagerFactory } from '../permission/factory.js';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { loadSession } from '../session/session.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { AgentDefinitionManager } from './definition-manager.js';
import { AgentTool } from './agent-tool.js';
import { SubAgentCoordinator } from './coordinator.js';
import { SubAgentResultInbox } from './result-inbox.js';
import { SubAgentRunner } from './runner.js';
import { SubAgentTaskManager } from './task-manager.js';
import { resolveSubAgentOptions } from './types.js';

class ScriptProvider implements LLMProvider {
  readonly contextWindow = 128_000;
  readonly contextWindowIsDefault = false;
  readonly calls: ProviderRequest[] = [];
  readonly scripts: Array<(request: ProviderRequest, emit: (event: StreamEvent) => void) => Promise<void> | void> = [];

  constructor(readonly name: string, readonly model: string) {}

  async chat(request: ProviderRequest, emit: (event: StreamEvent) => void): Promise<void> {
    this.calls.push(structuredClone(request));
    const script = this.scripts.shift();
    if (!script) throw new Error(`${this.name} 没有更多测试响应`);
    await script(request, emit);
  }
}

async function collect(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of stream) {}
}

test('后台子 Agent 完成后只在下一次自然请求回流并持久化', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-subagent-integration-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const builtin = path.join(root, 'agents');
  mkdirSync(builtin, { recursive: true });
  writeFileSync(path.join(builtin, 'general.md'), `---
name: general
description: 后台测试角色
disallowed_tools: []
background_tools: [read_file]
model: haiku
max_iterations: 5
permission_mode: allow
---
完成任务并返回结果。
`);
  const registry = createCoreToolRegistry(root);
  registry.register(new AgentTool(), { system: true });
  const options = resolveSubAgentOptions();
  const definitions = new AgentDefinitionManager(registry, root, {
    builtinDirectory: builtin,
    modelAliases: { haiku: 'child' },
    providerNames: ['main', 'child'],
    deniedTools: options.deniedTools,
  });
  definitions.initialize();
  const main = new ScriptProvider('main', 'main-model');
  const child = new ScriptProvider('child', 'child-model');
  let childFinished!: () => void;
  const childDone = new Promise<void>(resolve => { childFinished = resolve; });
  main.scripts.push(
    (_request, emit) => {
      emit({ type: 'tool_call', call: {
        id: 'agent-1', name: 'agent',
        arguments: { type: 'defined', role: 'general', task: '后台检查', background: true },
      } });
      emit({ type: 'done', content: '' });
    },
    async (request, emit) => {
      assert.equal(request.messages.some(message =>
        message.role === 'instruction' && message.instructionKind === 'subagent_result'), false);
      await childDone;
      emit({ type: 'text_delta', content: '主轮已结束' });
      emit({ type: 'done', content: '' });
    },
    (request, emit) => {
      assert.equal(request.messages.filter(message =>
        message.role === 'instruction' && message.instructionKind === 'subagent_result').length, 1);
      emit({ type: 'text_delta', content: '已接收后台结果' });
      emit({ type: 'done', content: '' });
    },
  );
  child.scripts.push((_request, emit) => {
    emit({ type: 'usage', usage: {
      inputTokens: 12, outputTokens: 4, totalTokens: 16,
      cacheCreationInputTokens: 3, cacheReadInputTokens: 5,
    } });
    emit({ type: 'text_delta', content: '后台检查完成' });
    emit({ type: 'done', content: '' });
    childFinished();
  });
  const tasks = new SubAgentTaskManager(options.foregroundTimeoutMs, options.retainedTasks);
  const inbox = new SubAgentResultInbox();
  const runner = new SubAgentRunner(
    registry,
    createPermissionManagerFactory(registry, { userHome: path.join(root, '.permission-home') }),
  );
  const coordinator = new SubAgentCoordinator(
    registry,
    definitions,
    {
      has: name => name === 'main' || name === 'child',
      resolve: name => name === 'child' ? child : main,
    },
    runner,
    tasks,
    inbox,
    options,
    { defaultProvider: () => main },
  );
  const permission = createPermissionManager(
    registry,
    'allow',
    { userHome: path.join(root, '.permission-home') },
  );
  const chat = new ChatManager(
    registry, permission, {}, {}, {}, { sessionPersistence: true }, {}, undefined,
    { coordinator, inbox },
  );
  const sessionId = chat.getSessionId();

  await collect(chat.run('启动后台检查', main));
  assert.equal(main.calls.length, 2);
  assert.equal(child.calls.length, 1);
  const backgroundTask = chat.listSubAgentTasks()[0];
  assert.equal(backgroundTask.state, 'completed');
  assert.equal(backgroundTask.usage.cacheReadInputTokens, 5);
  assert.equal(loadSession(root, sessionId).some(message => message.type === 'subagent_result'), false);

  await collect(chat.run('继续处理', main));
  assert.equal(main.calls.length, 3);
  assert.equal(chat.getHistory().filter(message =>
    message.role === 'instruction' && message.instructionKind === 'subagent_result').length, 1);
  assert.equal(loadSession(root, sessionId).filter(message => message.type === 'subagent_result').length, 1);

  await chat.close();
  await coordinator.close();
  await definitions.close();
});
