import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPermissionManagerFactory } from '../permission/factory.js';
import type { LLMProvider } from '../provider/types.js';
import { ProjectRuntimeFactory } from '../runtime/project-runtime.js';
import type { AgentDefinition } from '../subagent/types.js';
import { IMMUTABLE_SUBAGENT_DENIED_TOOLS } from '../subagent/types.js';
import { resolveDefinedToolSnapshot } from '../subagent/tool-filter.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { resolveVisibleTools } from '../tool/visibility.js';
import type { ToolContext } from '../tool/types.js';
import { GitWorktreeClient } from '../worktree/git-client.js';
import { WorktreeInitializer } from '../worktree/initializer.js';
import { WorktreeManager } from '../worktree/manager.js';
import { WorktreeMetadataStore } from '../worktree/metadata-store.js';
import { WorktreePathGuard } from '../worktree/path-guard.js';
import { resolveWorktreeOptions } from '../worktree/types.js';
import { TeamApprovalService } from './approval-service.js';
import { CoroutineBackend } from './backend/coroutine.js';
import { TeamBackendManager } from './backend/manager.js';
import { TeamProcessRunner } from './backend/process-runner.js';
import { TeamCoordinator } from './coordinator.js';
import { CoordinatorShellPolicy } from './coordinator-shell.js';
import { MemberContextStore } from './context-store.js';
import { TeamIntegrationGit } from './integration-git.js';
import { TeamIntegrationManager } from './integration-manager.js';
import { TeamMailboxService } from './mailbox-service.js';
import { TeamMemberRunner } from './member-runner.js';
import { TeamMemberRuntimeResolver } from './member-runtime.js';
import { OperationJournal } from './operation-journal.js';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import { TeamTaskService } from './task-service.js';
import { createTeamTools } from './tools.js';
import {
  resolveTeamOptions,
  type LeadActor,
  type MemberActor,
  type TeamMemberRecord,
} from './types.js';

const EMPTY_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

function git(root: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function createGitRoot(t: test.TestContext): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-team-e2e-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init');
  git(root, 'config', 'user.name', 'BetterCode Test');
  git(root, 'config', 'user.email', 'bettercode@example.test');
  writeFileSync(path.join(root, '.gitignore'), '.bettercode/worktrees/\n.bettercode/worktree-state/\n');
  writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', '初始化');
  return root;
}

async function createWorktrees(t: test.TestContext, root: string): Promise<WorktreeManager> {
  const guard = new WorktreePathGuard(root);
  const gitClient = new GitWorktreeClient();
  const manager = new WorktreeManager(
    guard,
    new WorktreeMetadataStore(guard),
    gitClient,
    new WorktreeInitializer(guard, gitClient, resolveWorktreeOptions()),
  );
  await manager.initialize();
  t.after(() => manager.close());
  return manager;
}

function definition(name: string, tools: readonly string[]): AgentDefinition {
  return {
    name,
    description: `${name} 角色`,
    tools,
    disallowedTools: [],
    backgroundTools: [],
    model: 'inherit',
    maxIterations: 3,
    permissionMode: 'allow',
    isolation: 'none',
    scope: 'project',
    entryPath: `/${name}.md`,
    body: '完成分派任务并报告结果。',
  };
}

function provider(): LLMProvider {
  return {
    name: 'fake',
    model: 'fake',
    contextWindow: 128_000,
    contextWindowIsDefault: false,
    chat: async (_request, onEvent) => {
      onEvent({ type: 'text_delta', content: '任务完成' });
      onEvent({ type: 'done', content: '' });
    },
  };
}

async function execute(
  coordinator: TeamCoordinator,
  actor: () => LeadActor | MemberActor | undefined,
  tool: Parameters<ReturnType<TeamCoordinator['toolHandler']>['execute']>[0],
  input: Parameters<ReturnType<TeamCoordinator['toolHandler']>['execute']>[1],
  rootDir: string,
) {
  const context = {
    rootDir,
    signal: new AbortController().signal,
    maxOutputBytes: 64 * 1024,
  } as ToolContext;
  const result = await coordinator.toolHandler(actor).execute(tool, input, context);
  assert.equal(result.ok, true, result.error?.message);
  return JSON.parse(result.output) as Record<string, unknown>;
}

test('长期协程团队完成消息、审批、Worktree 隔离和上下文恢复', async t => {
  const root = createGitRoot(t);
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-team-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const worktrees = await createWorktrees(t, root);
  const guard = new TeamPathGuard(home);
  const repository = new TeamRepository(guard);
  const tasks = new TeamTaskService(guard, repository);
  const options = resolveTeamOptions();
  let coordinator: TeamCoordinator | undefined;
  const mailbox = new TeamMailboxService(guard, repository, options.mailbox, {
    wake: (team, member) => coordinator!.wake(team, member),
  });
  const approvals = new TeamApprovalService(guard, repository, tasks, mailbox);
  const registry = createCoreToolRegistry(root);
  for (const tool of createTeamTools({ execute: async () => ({ ok: true, output: '{}', metadata: {} }) })) {
    registry.register(tool);
  }
  const definitions = new Map([
    ['reader', definition('reader', ['read_file'])],
    ['writer', definition('writer', ['write_file'])],
  ]);
  const fakeProvider = provider();
  const definitionSource = {
    get: (name: string) => definitions.get(name),
    getSnapshot: () => ({ revision: 1, definitions, disabledNames: new Set<string>(), diagnostics: [] }),
    resolveProviderName: () => undefined,
  };
  const runtimeResolver = new TeamMemberRuntimeResolver(registry, definitionSource, {
    has: () => true,
    resolve: () => fakeProvider,
  });
  const runner = new TeamMemberRunner({
    runtimeFactory: new ProjectRuntimeFactory(
      registry,
      createPermissionManagerFactory(registry, { userHome: home }),
      { userHome: home },
    ),
    runtimeResolver,
    repository,
    tasks,
    mailbox,
    approvals,
    contexts: new MemberContextStore(guard),
    journal: (team, member) => new OperationJournal(guard, team, member, options.mailbox),
    worktrees,
  });
  const coroutine = new CoroutineBackend({
    run: async (_input, signal) => new Promise<void>(resolve => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    }),
  });
  coordinator = new TeamCoordinator({
    projectRoot: root,
    repositoryId: root,
    resolved: options,
    definitions: definitionSource,
    repository,
    tasks,
    mailbox,
    approvals,
    integrations: {
      start: async () => { throw new Error('本场景不执行集成'); },
      status: () => { throw new Error('本场景不执行集成'); },
      continue: async () => { throw new Error('本场景不执行集成'); },
      abort: async () => { throw new Error('本场景不执行集成'); },
    },
    backends: new TeamBackendManager([coroutine]),
    guard,
    worktrees,
  });
  coordinator.createTeam('alpha', 'session');
  const lead = () => coordinator!.leadActor('session');
  await execute(coordinator, lead, 'team_member', {
    action: 'create', member: 'reader', role: 'reader', backend: 'coroutine', requires_approval: false,
  }, root);
  await execute(coordinator, lead, 'team_member', {
    action: 'create', member: 'writer', role: 'writer', backend: 'coroutine', requires_approval: true,
  }, root);
  const writeTask = await execute(coordinator, lead, 'team_task', {
    action: 'create', title: '实现功能', description: '在隔离目录完成代码', dependencies: [],
  }, root);
  const readTask = await execute(coordinator, lead, 'team_task', {
    action: 'create', title: '验证结果', description: '读取并验证实现', dependencies: [writeTask.id],
  }, root);
  await execute(coordinator, lead, 'team_task', {
    action: 'assign', task_id: writeTask.id, member: 'writer',
  }, root);
  await execute(coordinator, lead, 'team_task', {
    action: 'assign', task_id: readTask.id, member: 'reader',
  }, root);
  const generation = lead()!.generation;
  const writer = () => ({ kind: 'member', team: 'alpha', member: 'writer', generation } as const);
  const reader = () => ({ kind: 'member', team: 'alpha', member: 'reader', generation } as const);
  await execute(coordinator, writer, 'team_message', {
    action: 'send', recipient: 'reader', body: '准备接手后续验证', summary: '交接验证',
  }, root);
  const readerMessages = await execute(coordinator, reader, 'team_message', { action: 'read' }, root);
  assert.equal((readerMessages as unknown as unknown[]).length, 1);
  const approval = await execute(coordinator, writer, 'team_approval', {
    action: 'submit', task_id: writeTask.id, plan: '在 Worktree 中修改并验证', expected_operations: ['write_file'],
  }, root);
  await execute(coordinator, lead, 'team_approval', {
    action: 'decide', approval_id: approval.id, decision: 'approve', comment: '同意执行',
  }, root);
  await runner.run({ team: 'alpha', member: 'writer', taskId: String(writeTask.id), provider: fakeProvider, signal: new AbortController().signal });
  const writerRecord = repository.getMember('alpha', 'writer')!;
  assert.notEqual(writerRecord.rootDir, root);
  assert.equal(tasks.get('alpha', String(writeTask.id))?.state, 'completed');
  assert.equal(tasks.get('alpha', String(readTask.id))?.state, 'ready');
  assert.equal(repository.getMember('alpha', 'reader')?.currentTaskId, readTask.id);
  await runner.run({ team: 'alpha', member: 'reader', taskId: String(readTask.id), provider: fakeProvider, signal: new AbortController().signal });
  assert.equal(repository.getMember('alpha', 'reader')?.rootDir, root);
  const contextStore = new MemberContextStore(guard);
  assert.equal(contextStore.read('alpha', 'reader')?.revision, 1);
  tasks.reopen(lead()!, String(readTask.id));
  tasks.assign(lead()!, String(readTask.id), 'reader');
  await runner.run({ team: 'alpha', member: 'reader', taskId: String(readTask.id), provider: fakeProvider, signal: new AbortController().signal });
  assert.equal(contextStore.read('alpha', 'reader')?.revision, 2);

  const ordinarySubAgent = resolveDefinedToolSnapshot({
    registryNames: registry.names(),
    definition: definition('ordinary', registry.names()),
    deniedTools: new Set(IMMUTABLE_SUBAGENT_DENIED_TOOLS),
  });
  assert.equal([...ordinarySubAgent.foreground].some(name => name.startsWith('team_')), false);
  await coordinator.archiveTeam('alpha');
  assert.equal(repository.getMember('alpha', 'writer')?.worktreeName, undefined);
  assert.equal(repository.get('alpha')?.team.state, 'archived');
});

test('重启代次和 Coordinator 双锁共同保持恢复与权限边界', async t => {
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-team-restart-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const guard = new TeamPathGuard(home);
  const repository = new TeamRepository(guard);
  const team = repository.create({ name: 'alpha', repositoryId: 'repo', projectRoot: '/repo' }).team;
  const now = new Date().toISOString();
  for (const [name, state] of [['running', 'running'], ['approval', 'waiting_approval'], ['idle', 'idle']] as const) {
    repository.writeMember('alpha', {
      version: 1,
      revision: 0,
      name,
      role: 'reader',
      roleRevision: 1,
      state,
      backend: 'coroutine',
      requiresApproval: state === 'waiting_approval',
      rootDir: '/repo',
      contextPath: guard.contextFile('alpha', name),
      generation: team.generation,
      usage: EMPTY_USAGE,
      createdAt: now,
      lastActiveAt: now,
    }, 0);
  }
  const oldActor: MemberActor = { kind: 'member', team: 'alpha', member: 'running', generation: team.generation };
  const restored = repository.activate('alpha', 'new-session', 'repo');
  assert.equal(repository.getMember('alpha', 'running')?.state, 'interrupted');
  assert.equal(repository.getMember('alpha', 'approval')?.state, 'waiting_approval');
  assert.equal(repository.getMember('alpha', 'idle')?.state, 'idle');
  assert.ok(restored.team.generation > oldActor.generation);

  const combinations = [
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [true, true, true],
  ] as const;
  for (const [configured, environment, expected] of combinations) {
    assert.equal(resolveTeamOptions(
      { coordinator: { enabled: configured } },
      environment ? { BETTERCODE_COORDINATOR_MODE: '1' } : {},
    ).coordinator.active, expected);
  }
  const environment: NodeJS.ProcessEnv = { BETTERCODE_COORDINATOR_MODE: '1' };
  const resolved = resolveTeamOptions({ coordinator: { enabled: true } }, environment);
  delete environment.BETTERCODE_COORDINATOR_MODE;
  assert.equal(resolved.coordinator.active, true);
  const visible = resolveVisibleTools({
    allNames: ['read_file', 'write_file', 'run_command', 'agent', 'team_status', 'team_member'],
    effectOf: name => name === 'read_file' || name === 'team_status' ? 'read_only' : 'side_effect',
    team: { active: true, actor: 'lead', coordinator: true },
    mode: 'act',
  });
  assert.deepEqual([...visible], ['read_file', 'run_command', 'team_status', 'team_member']);
  const shell = new CoordinatorShellPolicy(() => ({ leadRoot: '/repo', memberRoots: [] }));
  assert.equal(shell.authorize('git status --short', '/repo'), undefined);
  assert.equal(shell.authorize('echo x > file', '/repo')?.ok, false);
});

test('真实 Git 集成只在事务全部成功后更新 Lead', async t => {
  const root = createGitRoot(t);
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-team-git-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const worktrees = await createWorktrees(t, root);
  const guard = new TeamPathGuard(home);
  const repository = new TeamRepository(guard);
  const team = repository.create({ name: 'alpha', repositoryId: root, projectRoot: root }).team;
  const lead: LeadActor = { kind: 'lead', team: 'alpha', sessionId: 'session', generation: team.generation };
  const tasks = new TeamTaskService(guard, repository);
  const addCompletedTask = async (memberName: string, file: string, content: string) => {
    const member: TeamMemberRecord = {
      version: 1,
      revision: 0,
      name: memberName,
      role: 'writer',
      roleRevision: 1,
      state: 'idle',
      backend: 'coroutine',
      requiresApproval: false,
      rootDir: root,
      contextPath: guard.contextFile('alpha', memberName),
      generation: lead.generation,
      usage: EMPTY_USAGE,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    repository.writeMember('alpha', member, 0);
    const task = tasks.create(lead, { title: memberName, description: memberName });
    tasks.assign(lead, task.id, memberName);
    const lease = await worktrees.acquire(`team/alpha/${memberName}`);
    writeFileSync(path.join(lease.cwd, file), content);
    git(lease.cwd, 'add', '.');
    git(lease.cwd, 'commit', '-m', `完成${memberName}`);
    const commit = git(lease.cwd, 'rev-parse', 'HEAD');
    const stored = repository.getMember('alpha', memberName)!;
    repository.writeMember('alpha', {
      ...stored,
      rootDir: lease.cwd,
      worktreeName: lease.name,
      worktreeBranch: lease.branch,
    }, stored.revision);
    await worktrees.exit(lease.leaseId);
    const actor: MemberActor = { kind: 'member', team: 'alpha', member: memberName, generation: lead.generation };
    tasks.report(actor, { taskId: task.id, state: 'running' });
    tasks.report(actor, { taskId: task.id, state: 'completed', branch: lease.branch, commit, resultSummary: '完成' });
    return task;
  };
  const first = await addCompletedTask('alice', 'alice.txt', 'alice\n');
  const before = git(root, 'rev-parse', 'HEAD');
  const manager = new TeamIntegrationManager(
    guard,
    repository,
    tasks,
    worktrees,
    new TeamIntegrationGit(new TeamProcessRunner(), '/usr/bin/git'),
    resolveTeamOptions().integration,
  );
  const completed = await manager.start(lead, [first.id]);
  assert.equal(completed.state, 'completed');
  assert.notEqual(git(root, 'rev-parse', 'HEAD'), before);
  assert.equal(repository.getMember('alpha', 'alice')?.worktreeName, undefined);

  const second = await addCompletedTask('bob', 'bob.txt', 'bob\n');
  const protectedHead = git(root, 'rev-parse', 'HEAD');
  const failing = new TeamIntegrationManager(
    guard,
    repository,
    tasks,
    worktrees,
    new TeamIntegrationGit(new TeamProcessRunner(), '/usr/bin/git'),
    { timeoutMs: 5_000, validationCommands: ['pnpm test'] },
    { run: async command => ({ command, ok: false, exitCode: 1, output: '验证失败' }) },
  );
  const failed = await failing.start(lead, [second.id]);
  assert.equal(failed.state, 'failed');
  assert.equal(git(root, 'rev-parse', 'HEAD'), protectedHead);
  const aborted = await failing.abort(lead, failed.id);
  assert.equal(aborted.state, 'aborted');
});
