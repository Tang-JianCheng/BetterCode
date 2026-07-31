import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentLoop } from '../agent/loop.js';
import { ToolScheduler } from '../agent/tool-scheduler.js';
import { createPermissionManager } from '../permission/factory.js';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { ToolRegistry } from '../tool/registry.js';
import { createToolSuccess, type Tool } from '../tool/types.js';
import type { HookRuntime, PreparedHookPromptBatch } from './types.js';

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake';
  readonly contextWindow = 128_000;
  readonly contextWindowIsDefault = false;
  readonly calls: ProviderRequest[] = [];
  constructor(private readonly responses: StreamEvent[][]) {}
  async chat(request: ProviderRequest, onEvent: (event: StreamEvent) => void): Promise<void> {
    this.calls.push(structuredClone(request));
    for (const event of this.responses.shift() ?? []) onEvent(event);
  }
}

function runtime(input: {
  deny?: boolean;
  prompt?: PreparedHookPromptBatch;
} = {}): HookRuntime & {
  before: number;
  after: number;
  assistants: number;
  commits: number;
  lastPostOutput?: string;
} {
  return {
    before: 0,
    after: 0,
    assistants: 0,
    commits: 0,
    async emitAssistantMessage() { this.assistants += 1; },
    async beforeToolUse() {
      this.before += 1;
      return input.deny
        ? {
            matched: 1,
            completed: 1,
            denied: {
              reason: 'policy blocked',
              source: { layer: 'project', file: '/project/hooks.yaml', index: 0, id: 'project:0' },
              actionType: 'command',
            },
          }
        : { matched: 0, completed: 0 };
    },
    async afterToolUse(_call, result) {
      this.after += 1;
      this.lastPostOutput = result.output;
    },
    preparePromptBatch() { return this.commits === 0 ? input.prompt : undefined; },
    commitPromptBatch() { this.commits += 1; },
  };
}

test('ToolScheduler 的 Hook 拒绝发生在权限与工具执行前', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-hook-scheduler-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = new ToolRegistry(root);
  let executions = 0;
  const tool: Tool = {
    name: 'write',
    description: 'write',
    effect: 'side_effect',
    inputSchema: { type: 'object', additionalProperties: false },
    permission: { targetKind: 'arguments', risk: 'write' },
    async execute() { executions += 1; return createToolSuccess('ok'); },
  };
  registry.register(tool);
  const hooks = runtime({ deny: true });
  const scheduler = new ToolScheduler(
    registry,
    createPermissionManager(registry, 'allow', { userHome: path.join(root, 'home') }),
    hooks,
  );
  const result = await scheduler.executeBatch([{ id: 'call', name: 'write', arguments: {} }], 1, {
    mode: 'act',
    initialUnknownToolStreak: 0,
    unknownToolLimit: 3,
    maxIterations: 10,
    signal: new AbortController().signal,
    onProgress: () => undefined,
  });
  assert.equal(result.results[0].result.error?.code, 'HOOK_DENIED');
  assert.equal(executions, 0);
  assert.equal(hooks.after, 0);
});

test('AgentLoop 只在真正请求 Provider 时消费一次 Hook Prompt', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-hook-loop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'note.txt'), 'hello');
  const registry = createCoreToolRegistry(root);
  const hooks = runtime({ prompt: { throughId: 1, content: '只在首个请求出现' } });
  const provider = new FakeProvider([
    [{
      type: 'tool_call',
      call: { id: 'read', name: 'read_file', arguments: { path: 'note.txt' } },
    }, { type: 'done', content: '' }],
    [{ type: 'text_delta', content: 'done' }, { type: 'done', content: '' }],
  ]);
  const loop = new AgentLoop(
    registry,
    createPermissionManager(registry, 'allow', { userHome: path.join(root, 'home') }),
    {},
    {},
    undefined,
    {},
    {
      hooks,
      transformToolResult: async input => ({ ...input.result, output: 'transformed result' }),
    },
  );
  await loop.execute({
    history: [],
    userMessage: 'read',
    mode: 'act',
    provider,
    signal: new AbortController().signal,
  }, () => undefined);

  assert.equal(provider.calls.length, 2);
  assert.match(JSON.stringify(provider.calls[0].messages), /只在首个请求出现/);
  assert.doesNotMatch(JSON.stringify(provider.calls[1].messages), /只在首个请求出现/);
  assert.equal(hooks.commits, 1);
  assert.equal(hooks.assistants, 2);
  assert.equal(hooks.before, 1);
  assert.equal(hooks.after, 1);
  assert.equal(hooks.lastPostOutput, 'transformed result');
});
