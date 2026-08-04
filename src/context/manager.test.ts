import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  LLMProvider,
  Message,
  ProviderRequest,
  StreamEvent,
  TokenUsage,
} from '../provider/types.js';
import type { ToolDefinition } from '../tool/types.js';
import { CONTEXT_SUMMARY_HEADINGS } from './constants.js';
import { ContextManager } from './manager.js';
import type { ContextEvent, ContextTrigger } from './types.js';

function validSummary(request: ProviderRequest): string {
  const nonce = /<context-source id="([^"]+)">/.exec(request.messages[0]?.content ?? '')?.[1];
  assert.ok(nonce);
  const sections = CONTEXT_SUMMARY_HEADINGS.map(heading => `## ${heading}\n无`).join('\n');
  return `<context-draft id="${nonce}">分析</context-draft>` +
    `<context-summary id="${nonce}">${sections}</context-summary>`;
}

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly contextWindow = 20_000;
  readonly contextWindowIsDefault = false;
  requests: ProviderRequest[] = [];
  mode: 'valid' | 'invalid' = 'valid';

  async chat(request: ProviderRequest, emit: (event: StreamEvent) => void): Promise<void> {
    this.requests.push(request);
    const content = this.mode === 'valid' ? validSummary(request) : '非法摘要';
    emit({ type: 'text_delta', content });
    emit({ type: 'done', content: '' });
  }
}

const options = {
  recentHistoryTokens: 1,
  recentHistoryMessages: 1,
  automaticReserveTokens: 10_000,
  manualReserveTokens: 1_000,
};

function history(): Message[] {
  return [
    { role: 'user', content: '最早用户要求' },
    { role: 'assistant', content: 'old-model-output '.repeat(2_800) },
    { role: 'user', content: '最新用户要求' },
  ];
}

async function createManager(t: test.TestContext): Promise<ContextManager> {
  const root = await mkdtemp(path.join(tmpdir(), 'bettercode-manager-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new ContextManager(root, options);
}

async function manage(
  manager: ContextManager,
  provider: LLMProvider,
  messages: readonly Message[],
  trigger: ContextTrigger,
  events: ContextEvent[] = [],
) {
  return manager.manage({
    history: messages,
    runtimeMessages: [{ role: 'instruction', instructionKind: 'runtime', content: '运行环境' }],
    systemPrompt: '稳定提示',
    tools: [],
    provider,
    trigger,
    iteration: 1,
    signal: new AbortController().signal,
    emit: event => events.push(event),
  });
}

test('自动管理低于阈值时直接返回完整请求并记录 usage 锚点', async t => {
  const manager = await createManager(t);
  const provider = new FakeProvider();
  const events: ContextEvent[] = [];
  const result = await manage(
    manager,
    provider,
    [{ role: 'user', content: '短消息' }],
    'automatic',
    events,
  );
  assert.equal(result.status, 'ready');
  assert.equal(provider.requests.length, 0);
  assert.deepEqual(events.filter(event => event.type === 'context_progress').map(event => event.stage), [
    'lightweight',
    'estimating',
    'estimating',
  ]);
  if (result.status !== 'ready') return;
  assert.equal(result.request.messages.at(-1)?.role, 'instruction');
  const usage: TokenUsage = {
    inputTokens: 500,
    outputTokens: 5,
    totalTokens: 505,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  manager.recordUsage(result.request, usage);
  assert.equal(manager.getStatus().consecutiveSummaryFailures, 0);
});

test('自动重量摘要保留用户原文并写回单一摘要边界', async t => {
  const manager = await createManager(t);
  const provider = new FakeProvider();
  const result = await manage(manager, provider, history(), 'automatic');
  assert.equal(result.status, 'ready');
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(provider.requests[0].tools, []);
  const users = result.history.filter(message => message.role === 'user').map(message => message.content);
  assert.deepEqual(users, ['最早用户要求', '最新用户要求']);
  assert.equal(result.history.filter(message =>
    message.role === 'instruction' && message.instructionKind === 'context_summary').length, 1);
  assert.equal(result.history.filter(message =>
    message.role === 'instruction' && message.instructionKind === 'context_boundary').length, 1);
});

test('摘要连续失败三次后自动熔断，手动成功恢复', async t => {
  const manager = await createManager(t);
  const provider = new FakeProvider();
  provider.mode = 'invalid';
  for (let count = 1; count <= 3; count += 1) {
    const result = await manage(manager, provider, history(), 'automatic');
    assert.equal(result.status, 'blocked');
    assert.equal(manager.getStatus().consecutiveSummaryFailures, count);
  }
  assert.equal(manager.getStatus().circuitOpen, true);
  const fourth = await manage(manager, provider, history(), 'automatic');
  assert.equal(fourth.status, 'blocked');
  assert.equal(fourth.status === 'blocked' && fourth.code, 'CONTEXT_CIRCUIT_OPEN');
  assert.equal(provider.requests.length, 3);

  provider.mode = 'valid';
  const recovered = await manage(manager, provider, history(), 'manual');
  assert.equal(recovered.status, 'ready');
  assert.equal(manager.getStatus().consecutiveSummaryFailures, 0);
  assert.equal(manager.getStatus().circuitOpen, false);
});

test('手动无内容、取消、clear 和 close 保持状态一致', async t => {
  const manager = await createManager(t);
  const provider = new FakeProvider();
  const skipped = await manage(manager, provider, [{ role: 'user', content: '只有用户消息' }], 'manual');
  assert.equal(skipped.status, 'skipped');

  const controller = new AbortController();
  controller.abort();
  const cancelled = await manager.manage({
    history: history(),
    runtimeMessages: [],
    systemPrompt: '稳定提示',
    tools: [],
    provider,
    trigger: 'manual',
    iteration: 0,
    signal: controller.signal,
    emit: () => undefined,
  });
  assert.equal(cancelled.status, 'cancelled');
  await manager.clear();
  assert.deepEqual(manager.getStatus(), {
    consecutiveSummaryFailures: 0,
    circuitOpen: false,
    offloadedResults: 0,
  });
  await manager.close();
  await manager.close();
  const closed = await manage(manager, provider, [], 'automatic');
  assert.equal(closed.status, 'blocked');
});

test('estimateUsageBreakdown 按类别估算并汇总', async t => {
  const manager = await createManager(t);
  const tool = (name: string): ToolDefinition => ({
    name,
    description: '工具',
    inputSchema: { type: 'object' },
  });
  const breakdown = manager.estimateUsageBreakdown({
    systemPrompt: '系统提示',
    systemTools: [tool('read_file')],
    mcpTools: [tool('mcp_demo_tool_12345678')],
    fullReminder: '<system-reminder>\n## 已激活的 Skill\n### review\n检查事实\n## 环境信息\nroot\n</system-reminder>',
    baseReminder: '<system-reminder>\n## 环境信息\nroot\n</system-reminder>',
    messages: [{ role: 'user', content: '你好' }],
  });
  assert.equal(breakdown.systemToolCount, 1);
  assert.equal(breakdown.mcpToolCount, 1);
  assert.equal(breakdown.mcpToolEntries.length, 1);
  assert.equal(breakdown.skillsTokens > 0, true);
  assert.equal(
    breakdown.usedTokens,
    breakdown.systemPromptTokens + breakdown.systemToolsTokens +
      breakdown.mcpToolsTokens + breakdown.skillsTokens + breakdown.messagesTokens,
  );
});
