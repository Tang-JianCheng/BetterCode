import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LLMProvider } from '../provider/types.js';
import { createPermissionManagerFactory } from '../permission/factory.js';
import { ProjectRuntimeFactory } from '../runtime/project-runtime.js';
import type { AgentDefinition } from '../subagent/types.js';
import { ToolRegistry } from '../tool/registry.js';
import type { Tool } from '../tool/types.js';
import { TeamApprovalService } from './approval-service.js';
import { MemberContextStore } from './context-store.js';
import { TeamMailboxService } from './mailbox-service.js';
import { TeamMemberRunner } from './member-runner.js';
import { TeamMemberRuntimeResolver } from './member-runtime.js';
import { OperationJournal } from './operation-journal.js';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import { TeamTaskService } from './task-service.js';
import { resolveTeamOptions, type TeamMemberRecord } from './types.js';

const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

async function fixture(t: test.TestContext) {
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-member-runner-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const guard = new TeamPathGuard(home);
  const repository = new TeamRepository(guard);
  const snapshot = repository.create({ name: 'alpha', repositoryId: 'repo', projectRoot: home });
  const member: TeamMemberRecord = {
    version: 1, revision: 0, name: 'alice', role: 'reader', roleRevision: 1, state: 'idle', backend: 'coroutine',
    requiresApproval: false, rootDir: home, contextPath: guard.contextFile('alpha', 'alice'), generation: snapshot.team.generation,
    usage, createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(),
  };
  repository.writeMember('alpha', member, 0);
  const tasks = new TeamTaskService(guard, repository);
  const lead = { kind: 'lead', team: 'alpha', sessionId: 's', generation: snapshot.team.generation } as const;
  const task = tasks.create(lead, { title: '读取状态', description: '完成只读检查' });
  tasks.assign(lead, task.id, 'alice');
  const options = resolveTeamOptions();
  const mailbox = new TeamMailboxService(guard, repository, options.mailbox);
  const approvals = new TeamApprovalService(guard, repository, tasks, mailbox);
  const registry = new ToolRegistry(home);
  registry.register({
    name: 'write_file', effect: 'side_effect', description: '', inputSchema: {},
    permission: { targetKind: 'arguments', risk: 'write' },
    execute: async () => ({ ok: true, output: '', metadata: {} }),
  } as Tool);
  const definition = {
    name: 'reader', tools: [], disallowedTools: [], backgroundTools: [], model: 'inherit', permissionMode: 'allow',
    maxIterations: 3, isolation: 'none', body: '完成只读任务。', scope: 'project', entryPath: '', description: '',
  } as AgentDefinition;
  const writer = { ...definition, name: 'writer', tools: ['write_file'] } as AgentDefinition;
  const definitions = {
    get: (name: string) => name === 'writer' ? writer : definition,
    getSnapshot: () => ({ revision: 1, definitions: new Map<string, AgentDefinition>(), disabledNames: new Set<string>(), diagnostics: [] }),
    resolveProviderName: () => undefined,
  };
  const provider: LLMProvider = {
    name: 'fake', model: 'fake', contextWindow: 128_000, contextWindowIsDefault: false,
    chat: async (_request, onEvent) => {
      onEvent({ type: 'text_delta', content: '任务完成' });
      onEvent({ type: 'done', content: '' });
    },
  };
  const resolver = new TeamMemberRuntimeResolver(registry, definitions, { has: () => true, resolve: () => provider });
  const runner = new TeamMemberRunner({
    runtimeFactory: new ProjectRuntimeFactory(registry, createPermissionManagerFactory(registry), { userHome: home }),
    runtimeResolver: resolver, repository, tasks, mailbox, approvals, contexts: new MemberContextStore(guard),
    journal: (team, name) => new OperationJournal(guard, team, name, options.mailbox),
  });
  return { runner, repository, tasks, provider, taskId: task.id, generation: snapshot.team.generation, guard };
}

test('成员自然完成后保存上下文、完成任务并回到空闲', async t => {
  const { runner, repository, tasks, provider, taskId, generation, guard } = await fixture(t);
  const outcome = await runner.run({ team: 'alpha', member: 'alice', taskId, provider, signal: new AbortController().signal });
  assert.equal(outcome.reason, 'completed');
  assert.equal(tasks.get('alpha', taskId)?.state, 'completed');
  assert.equal(repository.getMember('alpha', 'alice')?.state, 'idle');
  const context = new MemberContextStore(guard).read('alpha', 'alice', generation);
  assert.equal(context?.messages.at(-1)?.role, 'assistant');
  assert.equal(context?.lastSafeIteration, 1);
});

test('成员恢复运行时把已保存历史继续传给模型', async t => {
  const { runner, repository, tasks, provider, taskId, guard, generation } = await fixture(t);
  await runner.run({ team: 'alpha', member: 'alice', taskId, provider, signal: new AbortController().signal });
  const lead = { kind: 'lead', team: 'alpha', sessionId: 's', generation } as const;
  tasks.reopen(lead, taskId);
  tasks.assign(lead, taskId, 'alice');
  let messageCount = 0;
  const resumeProvider = { ...provider, chat: async (request: Parameters<LLMProvider['chat']>[0], onEvent: Parameters<LLMProvider['chat']>[1]) => {
    messageCount = request.messages.length;
    onEvent({ type: 'text_delta', content: '再次完成' });
    onEvent({ type: 'done', content: '' });
  } };
  await runner.run({ team: 'alpha', member: 'alice', taskId, provider: resumeProvider, signal: new AbortController().signal });
  assert.ok(messageCount >= 3);
  assert.equal(new MemberContextStore(guard).read('alpha', 'alice')?.revision, 2);
  assert.equal(repository.getMember('alpha', 'alice')?.state, 'idle');
});

test('共享根目录上下文不能在角色新增写工具后直接恢复', async t => {
  const { runner, repository, tasks, provider, taskId, generation } = await fixture(t);
  await runner.run({ team: 'alpha', member: 'alice', taskId, provider, signal: new AbortController().signal });
  const current = repository.getMember('alpha', 'alice')!;
  repository.writeMember('alpha', { ...current, role: 'writer' }, current.revision);
  const lead = { kind: 'lead', team: 'alpha', sessionId: 's', generation } as const;
  tasks.reopen(lead, taskId);
  tasks.assign(lead, taskId, 'alice');
  await assert.rejects(
    () => runner.run({ team: 'alpha', member: 'alice', taskId, provider, signal: new AbortController().signal }),
    /新增副作用工具|共享根目录/,
  );
});

test('新运行代次可以继承安全上下文并拒绝未确认副作用', async t => {
  const { runner, repository, tasks, provider, taskId, guard, generation } = await fixture(t);
  await runner.run({ team: 'alpha', member: 'alice', taskId, provider, signal: new AbortController().signal });
  const lead = { kind: 'lead', team: 'alpha', sessionId: 's', generation } as const;
  tasks.reopen(lead, taskId);
  tasks.assign(lead, taskId, 'alice');
  repository.activate('alpha', 'next-session', 'repo');
  const nextGeneration = repository.get('alpha')!.team.generation;
  await runner.run({ team: 'alpha', member: 'alice', taskId, provider, signal: new AbortController().signal });
  assert.equal(new MemberContextStore(guard).read('alpha', 'alice')?.generation, nextGeneration);

  const current = repository.getMember('alpha', 'alice')!;
  const nextLead = { kind: 'lead', team: 'alpha', sessionId: 'next-session', generation: nextGeneration } as const;
  tasks.reopen(nextLead, taskId);
  tasks.assign(nextLead, taskId, 'alice');
  repository.writeMember('alpha', { ...current, state: 'interrupted', currentTaskId: taskId }, current.revision);
  const journal = new OperationJournal(guard, 'alpha', 'alice', resolveTeamOptions().mailbox);
  await journal.start({ toolCallId: 'call-1', toolName: 'write_file', arguments: {}, taskId, contextRevision: 2 });
  await assert.rejects(
    () => runner.run({ team: 'alpha', member: 'alice', taskId, provider, signal: new AbortController().signal }),
    /未确认的副作用操作/,
  );
  assert.equal(repository.getMember('alpha', 'alice')?.state, 'interrupted');
});
