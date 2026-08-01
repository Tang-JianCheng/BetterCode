import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TeamError } from './errors.js';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import type { TeamMemberRecord } from './types.js';

const usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

function setup(t: test.TestContext) {
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-team-repository-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const guard = new TeamPathGuard(home);
  return { home, guard, repository: new TeamRepository(guard) };
}

test('团队仓库创建多个团队并按会话切换', t => {
  const { repository } = setup(t);
  repository.create({ name: 'alpha', repositoryId: 'repo-1', projectRoot: '/tmp/repo' });
  repository.create({ name: 'beta', repositoryId: 'repo-1', projectRoot: '/tmp/repo' });
  assert.deepEqual(repository.list().map(item => item.team.name), ['alpha', 'beta']);
  repository.activate('alpha', 'session-1', 'repo-1');
  assert.equal(repository.activeForSession('session-1')?.team.name, 'alpha');
  repository.activate('beta', 'session-1', 'repo-1');
  assert.equal(repository.activeForSession('session-1')?.team.name, 'beta');
  assert.equal(repository.get('alpha')?.team.name, 'alpha');
});

test('团队激活校验仓库与归档状态', t => {
  const { repository } = setup(t);
  repository.create({ name: 'alpha', repositoryId: 'repo-1', projectRoot: '/tmp/repo' });
  assert.throws(() => repository.activate('alpha', 'session', 'repo-2'), (error: unknown) =>
    error instanceof TeamError && error.code === 'TEAM_REPOSITORY_MISMATCH');
  repository.archive('alpha');
  assert.throws(() => repository.activate('alpha', 'session', 'repo-1'), (error: unknown) =>
    error instanceof TeamError && error.code === 'TEAM_ARCHIVED');
  repository.restore('alpha');
  assert.equal(repository.activate('alpha', 'session', 'repo-1').team.state, 'active');
});

test('新运行代次把遗留运行成员标记为中断', t => {
  const { guard, repository } = setup(t);
  const team = repository.create({ name: 'alpha', repositoryId: 'repo-1', projectRoot: '/tmp/repo' }).team;
  const now = new Date().toISOString();
  const member: TeamMemberRecord = {
    version: 1,
    revision: 0,
    name: 'worker',
    role: 'general',
    roleRevision: 1,
    state: 'running',
    backend: 'coroutine',
    requiresApproval: false,
    rootDir: '/tmp/repo',
    contextPath: guard.contextFile('alpha', 'worker'),
    generation: team.generation,
    usage,
    createdAt: now,
    lastActiveAt: now,
  };
  repository.writeMember('alpha', member, 0);
  const activated = repository.activate('alpha', 'session', 'repo-1');
  assert.equal(activated.team.generation, 1);
  assert.equal(activated.members[0].state, 'interrupted');
  assert.equal(activated.members[0].generation, 1);
});

test('损坏团队被隔离且不影响其他团队', t => {
  const { guard, repository } = setup(t);
  repository.create({ name: 'alpha', repositoryId: 'repo-1', projectRoot: '/tmp/repo' });
  repository.create({ name: 'beta', repositoryId: 'repo-1', projectRoot: '/tmp/repo' });
  writeFileSync(guard.team('beta').teamFile, '{ bad json');
  const listed = repository.list();
  assert.deepEqual(listed.map(item => item.team.name), ['alpha']);
  assert.equal(repository.getDiagnostics().some(item => item.source === 'beta'), true);
});
