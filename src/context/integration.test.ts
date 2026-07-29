import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentLoop } from '../agent/loop.js';
import type { AgentEvent } from '../agent/types.js';
import { ChatManager } from '../chat/manager.js';
import { createPermissionManager } from '../permission/factory.js';
import type {
  LLMProvider,
  Message,
  ProviderRequest,
  StreamEvent,
} from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { COMPACT_BOUNDARY, loadSession } from '../session/session.js';
import { CONTEXT_SUMMARY_HEADINGS } from './constants.js';
import { ContextManager } from './manager.js';
import type { ContextEvent } from './types.js';

const done = (): StreamEvent => ({ type: 'done', content: '' });

function validSummary(request: ProviderRequest): string {
  const nonce = /<context-source id="([^"]+)">/.exec(request.messages[0]?.content ?? '')?.[1];
  assert.ok(nonce);
  const sections = CONTEXT_SUMMARY_HEADINGS.map(heading => `## ${heading}\n无`).join('\n');
  return `<context-draft id="${nonce}">分析草稿</context-draft>` +
    `<context-summary id="${nonce}">${sections}</context-summary>`;
}

class ScenarioProvider implements LLMProvider {
  readonly name = 'fake-offline';
  readonly model = 'fake-model';
  readonly contextWindowIsDefault = false;
  readonly requests: ProviderRequest[] = [];

  constructor(
    readonly contextWindow: number,
    private readonly handler: (
      request: ProviderRequest,
      emit: (event: StreamEvent) => void,
      index: number,
    ) => Promise<void> | void,
  ) {}

  async chat(request: ProviderRequest, emit: (event: StreamEvent) => void): Promise<void> {
    this.requests.push(structuredClone(request));
    await this.handler(request, emit, this.requests.length - 1);
  }
}

function root(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-context-integration-'));
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

test('大工具结果在同一 Agent 下一轮落盘并在关闭时清理', async t => {
  const project = root();
  t.after(() => rmSync(project, { recursive: true, force: true }));
  writeFileSync(path.join(project, 'large.txt'), 'large-result\n'.repeat(500));
  const registry = createCoreToolRegistry(project);
  const permission = createPermissionManager(registry, 'allow', { userHome: path.join(project, '.home') });
  const context = new ContextManager(project, {
    singleToolResultTokens: 100,
    toolBatchTokens: 5_000,
    toolPreviewTokens: 20,
  });
  const provider = new ScenarioProvider(128_000, (_request, emit, index) => {
    if (index === 0) {
      emit({
        type: 'tool_call',
        call: { id: 'read-large', name: 'read_file', arguments: { path: 'large.txt' } },
      });
    } else {
      emit({ type: 'text_delta', content: '已处理大型结果' });
    }
    emit(done());
  });
  const events: AgentEvent[] = [];
  const outcome = await new AgentLoop(registry, permission, {}, {}, context).execute({
    history: [],
    userMessage: '读取大文件',
    mode: 'act',
    provider,
    signal: new AbortController().signal,
  }, event => events.push(event));

  assert.equal(outcome.reason, 'completed');
  assert.equal(provider.requests.length, 2);
  const toolResult = provider.requests[1].messages.find(message => message.role === 'tool');
  assert.ok(toolResult?.role === 'tool' && toolResult.contextReference);
  assert.match(toolResult?.content ?? '', /工具结果已落盘/);
  assert.equal(events.some(event => event.type === 'context_offloaded'), true);
  const relativePath = toolResult?.role === 'tool' ? toolResult.contextReference?.relativePath : undefined;
  assert.ok(relativePath && existsSync(path.join(project, relativePath)));

  await context.close();
  const contextRoot = path.join(project, '.bettercode/context');
  const sessions = existsSync(contextRoot)
    ? readdirSync(contextRoot).filter(name => name.startsWith('session-'))
    : [];
  assert.deepEqual(sessions, []);
});

test('长历史自动摘要后才发送正常模型请求', async t => {
  const project = root();
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const registry = createCoreToolRegistry(project);
  const permission = createPermissionManager(registry, 'allow', { userHome: path.join(project, '.home') });
  const context = new ContextManager(project, {
    recentHistoryTokens: 1,
    recentHistoryMessages: 1,
    automaticReserveTokens: 10_000,
    manualReserveTokens: 1_000,
  });
  const provider = new ScenarioProvider(20_000, (request, emit) => {
    if (request.tools.length === 0) emit({ type: 'text_delta', content: validSummary(request) });
    else emit({ type: 'text_delta', content: '压缩后完成' });
    emit(done());
  });
  const events: AgentEvent[] = [];
  const outcome = await new AgentLoop(registry, permission, {}, {}, context).execute({
    history: [
      { role: 'user', content: '最早要求' },
      { role: 'assistant', content: 'old-model-output '.repeat(2_800) },
    ],
    userMessage: '继续任务',
    mode: 'act',
    provider,
    signal: new AbortController().signal,
  }, event => events.push(event));

  assert.equal(outcome.reason, 'completed');
  assert.equal(provider.requests.length, 2);
  assert.deepEqual(provider.requests.map(request => request.tools.length === 0), [true, false]);
  assert.equal(provider.requests[1].messages.some(message =>
    message.role === 'instruction' && message.instructionKind === 'context_summary'), true);
  const summaryEvent = events.findIndex(event =>
    event.type === 'context_progress' && event.stage === 'summarizing');
  const requestEvent = events.findIndex(event =>
    event.type === 'progress' && event.stage === 'requesting_model');
  assert.ok(summaryEvent >= 0 && requestEvent > summaryEvent);
  assert.deepEqual(
    outcome.history.filter(message => message.role === 'user').map(message => message.content),
    ['最早要求', '继续任务'],
  );
});

test('摘要三次失败后熔断，手动成功恢复自动能力', async t => {
  const project = root();
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const manager = new ContextManager(project, {
    recentHistoryTokens: 1,
    recentHistoryMessages: 1,
    automaticReserveTokens: 10_000,
    manualReserveTokens: 1_000,
  });
  let valid = false;
  const provider = new ScenarioProvider(20_000, (request, emit) => {
    emit({ type: 'text_delta', content: valid ? validSummary(request) : '非法摘要' });
    emit(done());
  });
  const history: Message[] = [
    { role: 'user', content: '最早要求' },
    { role: 'assistant', content: 'old-model-output '.repeat(2_800) },
    { role: 'user', content: '最新要求' },
  ];
  const invoke = (trigger: 'automatic' | 'manual', events: ContextEvent[] = []) => manager.manage({
    history,
    runtimeMessages: [],
    systemPrompt: '稳定提示',
    tools: [],
    provider,
    trigger,
    iteration: 1,
    signal: new AbortController().signal,
    emit: event => events.push(event),
  });

  for (let index = 0; index < 3; index += 1) {
    assert.equal((await invoke('automatic')).status, 'blocked');
  }
  assert.equal(manager.getStatus().circuitOpen, true);
  const callsAtCircuit = provider.requests.length;
  const blocked = await invoke('automatic');
  assert.equal(blocked.status === 'blocked' && blocked.code, 'CONTEXT_CIRCUIT_OPEN');
  assert.equal(provider.requests.length, callsAtCircuit);

  valid = true;
  assert.equal((await invoke('manual')).status, 'ready');
  assert.equal(manager.getStatus().circuitOpen, false);
  assert.equal(manager.getStatus().consecutiveSummaryFailures, 0);
});

test('ChatManager 手动压缩不增加用户轮次并保留计划', async t => {
  const project = root();
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const registry = createCoreToolRegistry(project);
  const permission = createPermissionManager(registry, 'allow', { userHome: path.join(project, '.home') });
  const chat = new ChatManager(registry, permission, {}, {}, {
    recentHistoryTokens: 1,
    recentHistoryMessages: 1,
    automaticReserveTokens: 1_000,
    manualReserveTokens: 500,
  });
  const first = new ScenarioProvider(20_000, (_request, emit) => {
    emit({ type: 'text_delta', content: 'old-plan-output '.repeat(1_000) });
    emit(done());
  });
  await collect(chat.run('制定计划', first, { mode: 'plan' }));
  await collect(chat.run('补充要求', new ScenarioProvider(20_000, (_request, emit) => {
    emit({ type: 'text_delta', content: '收到' });
    emit(done());
  })));
  const turnCount = chat.turnCount;
  const plan = chat.getLatestPlan();
  const summaryProvider = new ScenarioProvider(20_000, (request, emit) => {
    emit({ type: 'text_delta', content: validSummary(request) });
    emit(done());
  });
  const events = await collect(chat.compact(summaryProvider));

  assert.equal(chat.turnCount, turnCount);
  assert.deepEqual(chat.getLatestPlan(), plan);
  assert.equal(events.some(event => event.type === 'context_compacted'), true);
  assert.equal(chat.getHistory().some(message =>
    message.role === 'instruction' && message.instructionKind === 'context_summary'), true);
  const boundary = loadSession(project, chat.getSessionId()).find(message =>
    message.type === COMPACT_BOUNDARY);
  assert.ok(boundary);
  const payload = JSON.parse(boundary.content) as { summary?: string; keep?: unknown[] };
  assert.match(payload.summary ?? '', /context-summary/);
  assert.equal(Array.isArray(payload.keep), true);
  await chat.clear();
  assert.equal(chat.turnCount, 0);
  await chat.close();
  const closedEvents = await collect(chat.run('关闭后请求', summaryProvider));
  assert.equal(closedEvents.some(event =>
    event.type === 'stopped' && event.reason === 'context_error'), true);
});
