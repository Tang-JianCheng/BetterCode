import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileHooks } from './compiler.js';
import { HookManager } from './manager.js';
import type {
  HookActionExecutor,
  HookActionResult,
  HookEventContext,
  HookLogEntry,
  HookLogger,
  LoadedHookConfig,
} from './types.js';

function makeRules(values: Record<string, unknown>[]) {
  const config: LoadedHookConfig = {
    secretValues: [],
    rules: values.map((value, index) => ({
      source: { layer: 'project', file: '/project/hooks.yaml', index, id: `project:${index}` },
      value,
    })),
  };
  return compileHooks(config);
}

class FakeLogger implements HookLogger {
  readonly entries: HookLogEntry[] = [];
  write(entry: HookLogEntry): void { this.entries.push(entry); }
}

class FakeExecutor implements HookActionExecutor {
  readonly calls: Array<{ command?: string; event: string }> = [];
  constructor(private readonly results: Record<string, HookActionResult> = {}) {}
  async execute(rule: Parameters<HookActionExecutor['execute']>[0], context: HookEventContext) {
    const command = rule.action.type === 'command' ? rule.action.command : undefined;
    this.calls.push({ command, event: context.event });
    if (rule.action.type === 'prompt') {
      return { status: 'success' as const, prompt: rule.action.prompt.render(context) };
    }
    return this.results[command ?? ''] ?? { status: 'success' as const };
  }
}

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-hook-manager-'));
}

test('HookManager 管理生命周期、once 和一次性 Prompt 批次', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const executor = new FakeExecutor();
  const manager = new HookManager(root, makeRules([
    { event: 'turn_start', once: true, action: { type: 'command', command: 'init' } },
    { event: 'user_message', action: { type: 'prompt', prompt: '任务：{{message.content}}' } },
  ]), executor, new FakeLogger());
  const signal = new AbortController().signal;
  await manager.startSystem('session', 'startup');
  await manager.startSession('session', 'startup');
  await manager.startTurn({ task: 'first', mode: 'act' }, signal);
  await manager.emitUserMessage('first', signal);
  await manager.endTurn('completed', signal);
  await manager.startTurn({ task: 'second', mode: 'act' }, signal);
  await manager.endTurn('completed', signal);

  assert.equal(executor.calls.filter(call => call.command === 'init').length, 1);
  const batch = manager.preparePromptBatch();
  assert.match(batch?.content ?? '', /任务：first/);
  manager.commitPromptBatch(batch!.throughId);
  assert.equal(manager.preparePromptBatch(), undefined);
  await manager.close();
});

test('HookManager 记录失败并返回第一个明确拒绝', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logger = new FakeLogger();
  const executor = new FakeExecutor({
    broken: { status: 'failed', code: 'COMMAND_FAILED', message: 'boom' },
    deny: { status: 'success', decision: { decision: 'deny', reason: 'blocked' } },
  });
  const manager = new HookManager(root, makeRules([
    { event: 'pre_tool_use', action: { type: 'command', command: 'broken' } },
    { event: 'pre_tool_use', action: { type: 'command', command: 'deny' } },
    { event: 'pre_tool_use', action: { type: 'command', command: 'never' } },
  ]), executor, logger);
  await manager.startSystem('session');
  await manager.startSession('session', 'startup');
  await manager.startTurn({ task: 'test', mode: 'act' }, new AbortController().signal);

  const result = await manager.beforeToolUse(
    { id: 'call', name: 'run_command', arguments: { command: 'git push' } },
    new AbortController().signal,
  );
  assert.equal(result.denied?.reason, 'blocked');
  assert.deepEqual(executor.calls.filter(call => call.event === 'pre_tool_use').map(call => call.command), [
    'broken', 'deny',
  ]);
  assert.equal(logger.entries[0].code, 'COMMAND_FAILED');
  await manager.close();
});

test('后台 Hook 不阻塞事件，once 失败后允许重试', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let releaseBackground: (() => void) | undefined;
  const backgroundGate = new Promise<void>(resolve => { releaseBackground = resolve; });
  let retryRuns = 0;
  const executor: HookActionExecutor = {
    async execute(rule) {
      if (rule.action.type !== 'command') return { status: 'success' };
      if (rule.action.command === 'background') {
        await backgroundGate;
        return { status: 'success' };
      }
      retryRuns += 1;
      return retryRuns === 1
        ? { status: 'failed', code: 'COMMAND_FAILED', message: 'first failure' }
        : { status: 'success' };
    },
  };
  const manager = new HookManager(root, makeRules([
    { event: 'turn_start', once: true, action: { type: 'command', command: 'retry' } },
    { event: 'post_tool_use', background: true, action: { type: 'command', command: 'background' } },
  ]), executor, new FakeLogger());
  const signal = new AbortController().signal;
  await manager.startSystem('session');
  await manager.startSession('session', 'startup');
  await manager.startTurn({ task: 'first', mode: 'act' }, signal);
  await manager.endTurn('completed', signal);
  await manager.startTurn({ task: 'second', mode: 'act' }, signal);
  await manager.afterToolUse(
    { id: 'call', name: 'read_file', arguments: { path: 'a' } },
    { ok: true, output: 'ok', metadata: {} },
    signal,
  );
  assert.equal(retryRuns, 2);
  releaseBackground?.();
  await manager.endTurn('completed', signal);
  await manager.close();
});

test('子 Agent Hook scope 隔离 Prompt 并保持捕获上下文', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manager = new HookManager(root, makeRules([
    { event: 'assistant_message', action: { type: 'prompt', prompt: '{{agent.id}}:{{message.content}}' } },
  ]), new FakeExecutor(), new FakeLogger());
  const first = manager.createAgentScope({
    id: 'sa-1', kind: 'defined', role: 'general', sessionId: 's1', parentTurnId: 'parent',
    turn: { id: 'parent', mode: 'act', task: '第一项' },
  });
  const second = manager.createAgentScope({
    id: 'sa-2', kind: 'fork', sessionId: 's1', parentTurnId: 'parent',
    turn: { id: 'parent', mode: 'plan', task: '第二项' },
  });
  const signal = new AbortController().signal;
  await first.emitAssistantMessage({ content: '甲', toolCalls: [] }, signal);
  await second.emitAssistantMessage({ content: '乙', toolCalls: [] }, signal);

  assert.equal(first.preparePromptBatch()?.content, 'sa-1:甲');
  assert.equal(second.preparePromptBatch()?.content, 'sa-2:乙');
  assert.equal(manager.preparePromptBatch(), undefined);
  first.close();
  assert.equal(first.preparePromptBatch(), undefined);
  assert.equal(second.preparePromptBatch()?.content, 'sa-2:乙');
  second.close();
  await manager.close();
});

test('子 Agent Hook scope 拒绝递归 agent 动作并记录失败', async t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logger = new FakeLogger();
  const executor = new FakeExecutor();
  const manager = new HookManager(root, makeRules([
    { event: 'post_tool_use', action: { type: 'agent', prompt: '再次委派' } },
  ]), executor, logger);
  const scope = manager.createAgentScope({
    id: 'sa-1', kind: 'defined', role: 'general', sessionId: 's1',
    turn: { id: 'parent', mode: 'act', task: '任务' },
  });
  await scope.afterToolUse(
    { id: 'call', name: 'read_file', arguments: { path: 'a' } },
    { ok: true, output: 'ok', metadata: {} },
    new AbortController().signal,
  );

  assert.equal(executor.calls.length, 0);
  assert.equal(logger.entries[0].code, 'NESTED_AGENT_FORBIDDEN');
  scope.close();
  await manager.close();
});
