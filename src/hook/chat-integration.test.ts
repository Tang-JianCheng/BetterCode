import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChatManager } from '../chat/manager.js';
import { createPermissionManager } from '../permission/factory.js';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { compileHooks } from './compiler.js';
import { HookManager } from './manager.js';
import type { HookActionExecutor, HookEventContext, HookLogger, LoadedHookConfig } from './types.js';

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

test('ChatManager 发布完整系统、会话、轮次、消息和工具生命周期', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-hook-chat-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'note.txt'), 'hello');
  const events: string[] = [];
  const executor: HookActionExecutor = {
    async execute(_rule, context: HookEventContext) {
      events.push(context.event);
      return { status: 'success' };
    },
  };
  const logger: HookLogger = { write: () => undefined };
  const eventNames = [
    'system_start',
    'system_stop',
    'session_start',
    'session_end',
    'turn_start',
    'turn_end',
    'user_message',
    'assistant_message',
    'pre_tool_use',
    'post_tool_use',
  ] as const;
  const config: LoadedHookConfig = {
    secretValues: [],
    rules: eventNames.map((event, index) => ({
      source: { layer: 'project', file: '/project/hooks.yaml', index, id: `project:${index}` },
      value: { event, action: { type: 'command', command: 'record' } },
    })),
  };
  const hookManager = new HookManager(root, compileHooks(config), executor, logger);
  const registry = createCoreToolRegistry(root);
  const chat = new ChatManager(
    registry,
    createPermissionManager(registry, 'allow', { userHome: path.join(root, 'home') }),
    {},
    {},
    {},
    { sessionPersistence: false },
    {},
    hookManager,
  );
  await hookManager.startSystem(chat.getSessionId());
  await hookManager.startSession(chat.getSessionId(), 'startup');
  const provider = new FakeProvider([
    [{
      type: 'tool_call',
      call: { id: 'read', name: 'read_file', arguments: { path: 'note.txt' } },
    }, { type: 'done', content: '' }],
    [{ type: 'text_delta', content: 'done' }, { type: 'done', content: '' }],
  ]);
  for await (const _event of chat.run('read note', provider)) {
    // 消费完整事件流后才能结束轮次。
  }
  await chat.clear();
  await chat.close();
  await hookManager.close();

  assert.deepEqual(events, [
    'system_start',
    'session_start',
    'turn_start',
    'user_message',
    'assistant_message',
    'pre_tool_use',
    'post_tool_use',
    'assistant_message',
    'turn_end',
    'session_end',
    'session_start',
    'session_end',
    'system_stop',
  ]);
});
