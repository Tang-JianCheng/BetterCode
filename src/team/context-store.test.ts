import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MemberContextStore } from './context-store.js';
import { TeamError } from './errors.js';
import { TeamPathGuard } from './path-guard.js';
import type { MemberContextSnapshot } from './types.js';

const usage = { inputTokens: 1, outputTokens: 2, totalTokens: 3, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

test('成员上下文按 revision 与 generation 保存恢复', t => {
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-team-context-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const store = new MemberContextStore(new TeamPathGuard(home));
  const snapshot: MemberContextSnapshot = {
    version: 1, revision: 0, team: 'alpha', member: 'worker', generation: 2,
    roleRevision: 1, systemPromptHash: 'hash', messages: [{ role: 'user', content: '任务' }],
    usage, lastSafeIteration: 1, uncertainOperationIds: [], updatedAt: new Date().toISOString(),
  };
  const saved = store.write(snapshot, 0);
  assert.equal(saved.revision, 1);
  assert.deepEqual(store.read('alpha', 'worker', 2)?.messages, snapshot.messages);
  assert.throws(() => store.read('alpha', 'worker', 3), (error: unknown) =>
    error instanceof TeamError && error.code === 'TEAM_CONFLICT');
});
