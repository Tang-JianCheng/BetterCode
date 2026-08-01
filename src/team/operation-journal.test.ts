import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { OperationJournal } from './operation-journal.js';
import { TeamPathGuard } from './path-guard.js';

const options = { lockTimeoutMs: 1_000, retryIntervalMs: 5, staleLockMs: 200 };

test('操作日志识别未配对副作用并支持 Lead 解决', async t => {
  const home = mkdtempSync(path.join(tmpdir(), 'bettercode-team-journal-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const guard = new TeamPathGuard(home);
  const journal = new OperationJournal(guard, 'alpha', 'worker', options);
  const first = await journal.start({
    toolCallId: 'call-1', toolName: 'write_file', arguments: { path: 'a', api_key: 'secret-value' },
    taskId: 'task-0001', contextRevision: 1,
  });
  const second = await journal.start({
    toolCallId: 'call-2', toolName: 'run_command', arguments: { command: 'git status' },
    taskId: 'task-0001', contextRevision: 1,
  });
  await journal.finish(second, true, 'ok');
  assert.deepEqual(journal.uncertain(), [first]);
  await journal.resolve(first, '已人工确认文件未写入');
  assert.deepEqual(journal.uncertain(), []);
  const file = path.join(guard.team('alpha').operationsDir, 'worker.jsonl');
  assert.doesNotMatch(readFileSync(file, 'utf8'), /secret-value/);
});
