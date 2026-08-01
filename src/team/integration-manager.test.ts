import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GitWorktreeClient } from '../worktree/git-client.js';
import { WorktreeInitializer } from '../worktree/initializer.js';
import { WorktreeManager } from '../worktree/manager.js';
import { WorktreeMetadataStore } from '../worktree/metadata-store.js';
import { WorktreePathGuard } from '../worktree/path-guard.js';
import { resolveWorktreeOptions } from '../worktree/types.js';
import { TeamProcessRunner } from './backend/process-runner.js';
import { TeamIntegrationGit } from './integration-git.js';
import { TeamIntegrationManager, type IntegrationValidationRunner } from './integration-manager.js';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import { TeamTaskService } from './task-service.js';
import { resolveTeamOptions, type LeadActor, type MemberActor, type TeamMemberRecord } from './types.js';

function git(root: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8' }).trim();
}

async function fixture(t: test.TestContext, validator?: IntegrationValidationRunner) {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-integration-manager-'));
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-integration-home-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  git(root, 'init');
  git(root, 'config', 'user.name', 'BetterCode Test');
  git(root, 'config', 'user.email', 'bettercode@example.test');
  writeFileSync(path.join(root, '.gitignore'), '.bettercode/worktrees/\n.bettercode/worktree-state/\n');
  writeFileSync(path.join(root, 'base.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', '初始化');
  const worktreeGuard = new WorktreePathGuard(root);
  const worktreeClient = new GitWorktreeClient();
  const worktrees = new WorktreeManager(
    worktreeGuard,
    new WorktreeMetadataStore(worktreeGuard),
    worktreeClient,
    new WorktreeInitializer(worktreeGuard, worktreeClient, resolveWorktreeOptions()),
  );
  await worktrees.initialize();
  t.after(() => worktrees.close());
  const guard = new TeamPathGuard(home);
  const repository = new TeamRepository(guard);
  const team = repository.create({ name: 'alpha', repositoryId: root, projectRoot: root });
  const lead: LeadActor = { kind: 'lead', team: 'alpha', sessionId: 's', generation: team.team.generation };
  const tasks = new TeamTaskService(guard, repository);
  const options = resolveTeamOptions({ integration: { validation_commands: ['pnpm test'] } });
  const integration = new TeamIntegrationManager(
    guard,
    repository,
    tasks,
    worktrees,
    new TeamIntegrationGit(new TeamProcessRunner(), '/usr/bin/git'),
    options.integration,
    validator ?? { run: async command => ({ command, ok: true, exitCode: 0, output: 'ok' }) },
  );
  return { root, guard, repository, tasks, worktrees, integration, lead };
}

function addMember(repository: TeamRepository, guard: TeamPathGuard, lead: LeadActor, name: string): MemberActor {
  const now = new Date().toISOString();
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  const member: TeamMemberRecord = {
    version: 1, revision: 0, name, role: 'coder', roleRevision: 1, state: 'idle', backend: 'coroutine',
    requiresApproval: false, rootDir: '', contextPath: guard.contextFile('alpha', name), generation: lead.generation,
    usage, createdAt: now, lastActiveAt: now,
  };
  repository.writeMember('alpha', member, 0);
  return { kind: 'member', team: 'alpha', member: name, generation: lead.generation };
}

async function completeTask(input: {
  title: string;
  file: string;
  content: string;
  member: MemberActor;
  lead: LeadActor;
  tasks: TeamTaskService;
  repository: TeamRepository;
  worktrees: WorktreeManager;
  dependencies?: readonly string[];
}) {
  const task = input.tasks.create(input.lead, { title: input.title, description: input.title, dependencies: input.dependencies });
  input.tasks.assign(input.lead, task.id, input.member.member);
  const lease = await input.worktrees.acquire(`team/alpha/${input.member.member}`);
  writeFileSync(path.join(lease.cwd, input.file), input.content);
  git(lease.cwd, 'add', '.');
  git(lease.cwd, 'commit', '-m', input.title);
  const commit = git(lease.cwd, 'rev-parse', 'HEAD');
  const stored = input.repository.getMember('alpha', input.member.member)!;
  input.repository.writeMember('alpha', {
    ...stored,
    rootDir: lease.cwd,
    worktreeName: lease.name,
    worktreeBranch: lease.branch,
  }, stored.revision);
  await input.worktrees.exit(lease.leaseId);
  input.tasks.report(input.member, { taskId: task.id, state: 'running' });
  input.tasks.report(input.member, { taskId: task.id, state: 'completed', resultSummary: '完成', branch: lease.branch, commit });
  return task.id;
}

test('集成管理器按 DAG 顺序合并、验证并一次性更新 Lead', async t => {
  const calls: string[] = [];
  const validator: IntegrationValidationRunner = {
    run: async command => { calls.push(command); return { command, ok: true, exitCode: 0, output: 'ok' }; },
  };
  const fixtureValue = await fixture(t, validator);
  const alice = addMember(fixtureValue.repository, fixtureValue.guard, fixtureValue.lead, 'alice');
  const bob = addMember(fixtureValue.repository, fixtureValue.guard, fixtureValue.lead, 'bob');
  const first = await completeTask({ ...fixtureValue, title: '任务一', file: 'one.txt', content: 'one', member: alice });
  const second = await completeTask({ ...fixtureValue, title: '任务二', file: 'two.txt', content: 'two', member: bob, dependencies: [first] });
  const before = git(fixtureValue.root, 'rev-parse', 'HEAD');
  const record = await fixtureValue.integration.start(fixtureValue.lead, [second, first]);
  assert.equal(record.state, 'completed');
  assert.deepEqual(record.orderedTaskIds, [first, second]);
  assert.deepEqual(record.mergedTaskIds, [first, second]);
  assert.deepEqual(calls, ['pnpm test']);
  assert.notEqual(git(fixtureValue.root, 'rev-parse', 'HEAD'), before);
  assert.equal(existsSync(path.join(fixtureValue.root, 'one.txt')), true);
  assert.equal(fixtureValue.tasks.get('alpha', first)?.integrationId, record.id);
  assert.equal(fixtureValue.repository.getMember('alpha', 'alice')?.worktreeName, undefined);
});

test('集成管理器冲突暂停，解决后可以继续完成', async t => {
  const fixtureValue = await fixture(t);
  const alice = addMember(fixtureValue.repository, fixtureValue.guard, fixtureValue.lead, 'alice');
  const taskId = await completeTask({ ...fixtureValue, title: '成员修改', file: 'base.txt', content: 'member\n', member: alice });
  writeFileSync(path.join(fixtureValue.root, 'base.txt'), 'lead\n');
  git(fixtureValue.root, 'commit', '-am', 'Lead 修改');
  const before = git(fixtureValue.root, 'rev-parse', 'HEAD');
  const conflicted = await fixtureValue.integration.start(fixtureValue.lead, [taskId]);
  assert.equal(conflicted.state, 'conflicted');
  assert.deepEqual(conflicted.conflictFiles, ['base.txt']);
  assert.equal(git(fixtureValue.root, 'rev-parse', 'HEAD'), before);
  writeFileSync(path.join(conflicted.worktreeRoot, 'base.txt'), 'resolved\n');
  git(conflicted.worktreeRoot, 'add', 'base.txt');
  const completed = await fixtureValue.integration.continue(fixtureValue.lead, conflicted.id);
  assert.equal(completed.state, 'completed');
  assert.equal(existsSync(path.join(fixtureValue.root, 'base.txt')), true);
  assert.equal(fixtureValue.tasks.get('alpha', taskId)?.integrationId, completed.id);
});

test('验证失败保留 Lead HEAD，并可显式终止临时事务', async t => {
  const validator: IntegrationValidationRunner = {
    run: async command => ({ command, ok: false, exitCode: 1, output: '测试失败' }),
  };
  const fixtureValue = await fixture(t, validator);
  const alice = addMember(fixtureValue.repository, fixtureValue.guard, fixtureValue.lead, 'alice');
  const taskId = await completeTask({ ...fixtureValue, title: '失败任务', file: 'fail.txt', content: 'x', member: alice });
  const before = git(fixtureValue.root, 'rev-parse', 'HEAD');
  const failed = await fixtureValue.integration.start(fixtureValue.lead, [taskId]);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.validationResults[0]?.ok, false);
  assert.equal(git(fixtureValue.root, 'rev-parse', 'HEAD'), before);
  const aborted = await fixtureValue.integration.abort(fixtureValue.lead, failed.id);
  assert.equal(aborted.state, 'aborted');
  assert.equal(existsSync(failed.worktreeRoot), false);
});

test('Lead HEAD 在验证期间变化会阻止最终快进', async t => {
  let root = '';
  const validator: IntegrationValidationRunner = {
    run: async command => {
      writeFileSync(path.join(root, 'lead-late.txt'), 'late');
      git(root, 'add', '.');
      git(root, 'commit', '-m', 'Lead 并发修改');
      return { command, ok: true, exitCode: 0, output: 'ok' };
    },
  };
  const fixtureValue = await fixture(t, validator);
  root = fixtureValue.root;
  const alice = addMember(fixtureValue.repository, fixtureValue.guard, fixtureValue.lead, 'alice');
  const taskId = await completeTask({ ...fixtureValue, title: '并发任务', file: 'member.txt', content: 'x', member: alice });
  await assert.rejects(() => fixtureValue.integration.start(fixtureValue.lead, [taskId]), /HEAD/);
  assert.equal(existsSync(path.join(root, 'member.txt')), false);
});
