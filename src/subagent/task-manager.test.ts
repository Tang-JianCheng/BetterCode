import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentEvent, AgentOutcome } from '../agent/types.js';
import type { TokenUsage } from '../provider/types.js';
import { SubAgentTaskManager } from './task-manager.js';

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

function outcome(text = '完成'): AgentOutcome {
  return {
    reason: 'completed',
    iterations: 1,
    finalText: text,
    history: [],
    usage: { ...EMPTY_USAGE },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('任务管理器记录正常完成、异常和会话隔离', async () => {
  const manager = new SubAgentTaskManager(1_000, 10);
  const completed = manager.start({
    kind: 'defined', role: 'general', task: '完成任务', origin: 'tool', sessionId: 's1',
  }, async () => outcome('结果'));
  const failed = manager.start({
    kind: 'defined', role: 'general', task: '失败任务', origin: 'tool', sessionId: 's2',
  }, async () => { throw new Error('执行失败'); });

  const completedResult = await manager.waitForeground(completed.id, new AbortController().signal);
  const failedResult = await manager.waitForeground(failed.id, new AbortController().signal);

  assert.equal(completedResult.task.state, 'completed');
  assert.equal(completedResult.task.result, '结果');
  assert.equal(failedResult.task.state, 'failed');
  assert.match(failedResult.task.error?.message ?? '', /执行失败/);
  assert.equal(manager.get('s2', completed.id), undefined);
  assert.deepEqual(manager.list('s1').map(task => task.id), [completed.id]);
  await manager.close();
});

test('前台任务支持手动和超时转后台且不重启 operation', async () => {
  const manager = new SubAgentTaskManager(10, 10);
  const gate = deferred<AgentOutcome>();
  let runs = 0;
  const task = manager.start({
    kind: 'defined', role: 'general', task: '后台任务', origin: 'tool', sessionId: 's1',
  }, async () => {
    runs += 1;
    return gate.promise;
  });
  const parent = new AbortController();
  const waiting = manager.waitForeground(task.id, parent.signal);
  const moved = manager.moveForegroundToBackground('s1', 'manual');

  assert.equal(moved?.backgroundReason, 'manual');
  assert.equal((await waiting).status, 'backgrounded');
  parent.abort();
  gate.resolve(outcome('后台完成'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(manager.get('s1', task.id)?.state, 'completed');
  assert.equal(runs, 1);

  const timeoutGate = deferred<AgentOutcome>();
  const timeoutTask = manager.start({
    kind: 'defined', role: 'general', task: '超时任务', origin: 'tool', sessionId: 's1',
  }, async () => timeoutGate.promise);
  const timeoutResult = await manager.waitForeground(timeoutTask.id, new AbortController().signal);
  assert.equal(timeoutResult.status, 'backgrounded');
  assert.equal(timeoutResult.task.backgroundReason, 'timeout');
  timeoutGate.resolve(outcome());
  await manager.close();
});

test('父任务取消前台子任务，显式后台任务不占前台指针', async () => {
  const manager = new SubAgentTaskManager(1_000, 10);
  const explicit = manager.start({
    kind: 'fork', task: 'Fork', origin: 'tool', sessionId: 's1', background: 'fork',
  }, async signal => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return { ...outcome(''), reason: 'cancelled' };
  });
  assert.equal(manager.hasForeground('s1'), false);
  assert.equal((await manager.waitForeground(explicit.id, new AbortController().signal)).status, 'backgrounded');

  const foreground = manager.start({
    kind: 'defined', role: 'general', task: '前台', origin: 'tool', sessionId: 's1',
  }, async signal => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return { ...outcome(''), reason: 'cancelled' };
  });
  const parent = new AbortController();
  const waiting = manager.waitForeground(foreground.id, parent.signal);
  parent.abort();
  const result = await waiting;
  assert.equal(result.task.state, 'cancelled');
  await manager.close();
});

test('任务事件隔离监听器异常并累计用量，保留策略只淘汰终态', async () => {
  const manager = new SubAgentTaskManager(1_000, 1);
  const events: string[] = [];
  manager.subscribe(() => { throw new Error('监听器失败'); });
  manager.subscribe(event => events.push(event.type));
  const run = (sessionId: string) => manager.start({
    kind: 'defined', role: 'general', task: sessionId, origin: 'tool', sessionId,
  }, async (_signal, emit) => {
    const usage = { ...EMPTY_USAGE, inputTokens: 10, totalTokens: 10 };
    emit({ type: 'usage', iteration: 1, current: usage, cumulative: usage });
    emit({ type: 'progress', iteration: 1, maxIterations: 10, stage: 'requesting_model' });
    return { ...outcome(), usage };
  });
  const first = run('s1');
  await manager.waitForeground(first.id, new AbortController().signal);
  const second = run('s1');
  await manager.waitForeground(second.id, new AbortController().signal);

  assert.equal(manager.get('s1', first.id), undefined);
  assert.equal(manager.get('s1', second.id)?.usage.inputTokens, 10);
  assert.ok(events.includes('task_usage'));
  assert.ok(events.includes('task_progress'));
  await manager.close();
});

test('取消会话和关闭会等待运行任务收敛', async () => {
  const manager = new SubAgentTaskManager(1_000, 10);
  const starts: string[] = [];
  const make = (sessionId: string) => manager.start({
    kind: 'defined', role: 'general', task: sessionId, origin: 'tool', sessionId,
  }, async signal => {
    starts.push(sessionId);
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return { ...outcome(''), reason: 'cancelled' };
  });
  const first = make('s1');
  const second = make('s2');
  await new Promise(resolve => setTimeout(resolve, 0));
  await manager.cancelSession('s1', '切换会话');
  assert.equal(manager.get('s1', first.id)?.state, 'cancelled');
  assert.equal(manager.get('s2', second.id)?.state, 'running');
  await manager.close();
  assert.equal(manager.get('s2', second.id)?.state, 'cancelled');
  assert.deepEqual(starts.sort(), ['s1', 's2']);
});

test('每个会话只允许一个前台任务且重复转后台无副作用', async () => {
  const manager = new SubAgentTaskManager(1_000, 10);
  const gate = deferred<AgentOutcome>();
  const events: string[] = [];
  manager.subscribe(event => events.push(event.type));
  const first = manager.start({
    kind: 'defined', role: 'general', task: '第一项', origin: 'hook', sessionId: 's1',
  }, async () => gate.promise);

  assert.match(first.id, /^sa-/);
  assert.equal(manager.hasForeground('s1'), true);
  assert.throws(() => manager.start({
    kind: 'defined', role: 'general', task: '第二项', origin: 'hook', sessionId: 's1',
  }, async () => outcome()), /已有前台子 Agent/);
  assert.ok(manager.moveForegroundToBackground('s1', 'manual'));
  assert.equal(manager.moveForegroundToBackground('s1', 'manual'), undefined);
  assert.equal(events.filter(event => event === 'task_backgrounded').length, 1);
  gate.resolve(outcome());
  await manager.close();
});

test('任务管理器发布并保留 Worktree 生命周期状态', async () => {
  const manager = new SubAgentTaskManager(1_000, 10);
  const gate = deferred<AgentOutcome>();
  const events: string[] = [];
  manager.subscribe(event => { if (event.type === 'task_worktree') events.push(event.worktree.state); });
  const task = manager.start({
    kind: 'defined', role: 'reviewer', task: '隔离任务', origin: 'tool', sessionId: 's1', isolation: 'worktree',
  }, async () => gate.promise);
  assert.equal(task.worktree?.name, `reviewer/${task.id}`);
  manager.updateWorktree(task.id, {
    isolation: 'worktree', name: `reviewer/${task.id}`, path: '/worktree', branch: 'bettercode/worktree/reviewer/task',
    baseCommit: 'abc', state: 'active',
  });
  manager.updateWorktree(task.id, {
    isolation: 'worktree', name: `reviewer/${task.id}`, path: '/worktree', branch: 'bettercode/worktree/reviewer/task',
    baseCommit: 'abc', state: 'retained', reasons: ['存在未提交修改'],
  });
  assert.deepEqual(events, ['active', 'retained']);
  assert.equal(manager.get('s1', task.id)?.worktree?.state, 'retained');
  gate.resolve(outcome());
  await manager.waitForeground(task.id, new AbortController().signal);
  await manager.close();
});
