import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { MemoryGovernor } from './governor.js';
import { MemoryManager } from './manager.js';

function fixture(): { root: string; home: string; manager: MemoryManager } {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-govern-'));
  const home = path.join(root, 'home');
  mkdirSync(home);
  return { root, home, manager: new MemoryManager(root, { userHome: home }) };
}

function seedSessions(root: string, count: number): void {
  const dir = path.join(root, '.bettercode', 'sessions');
  mkdirSync(dir, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    writeFileSync(path.join(dir, `s-${index}.jsonl`), '{"role":"user","content":"x"}\n');
  }
}

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly contextWindow = 128_000;
  readonly contextWindowIsDefault = false;
  requests: ProviderRequest[] = [];

  constructor(private readonly responses: string[]) {}

  async chat(request: ProviderRequest, emit: (event: StreamEvent) => void): Promise<void> {
    this.requests.push(request);
    const text = this.responses.shift() ?? '';
    emit({ type: 'text_delta', content: text });
    emit({ type: 'done', content: '' });
  }
}

test('门控：无记忆直接跳过，不调 LLM', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new FakeProvider(['{"actions":[]}']);
  const governor = new MemoryGovernor(manager);
  const result = await governor.maybeRun(provider);
  assert.equal(result.ran, false);
  assert.equal(result.reason, 'no_memory_files');
  assert.equal(provider.requests.length, 0);
});

test('门控：会话数不足跳过', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manager.saveMemory({ name: 'note', description: 'd', type: 'project', content: '正文' });
  const provider = new FakeProvider(['{"actions":[]}']);
  const governor = new MemoryGovernor(manager);
  const result = await governor.maybeRun(provider);
  assert.equal(result.ran, false);
  assert.equal(result.reason, 'insufficient_sessions');
  assert.equal(provider.requests.length, 0);
});

test('门控：24 小时时间门拦截近期整理', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manager.saveMemory({ name: 'note', description: 'd', type: 'project', content: '正文' });
  writeFileSync(
    path.join(manager.projectDir, '.governance.json'),
    JSON.stringify({ lastGovernedAt: new Date().toISOString(), runCount: 1 }),
  );
  seedSessions(root, 5);
  const provider = new FakeProvider(['{"actions":[]}']);
  const governor = new MemoryGovernor(manager);
  const result = await governor.maybeRun(provider);
  assert.equal(result.ran, false);
  assert.equal(result.reason, 'interval_not_elapsed');
  assert.equal(provider.requests.length, 0);
});

test('门控：10 分钟扫描节流拦截频繁尝试', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manager.saveMemory({ name: 'note', description: 'd', type: 'project', content: '正文' });
  writeFileSync(
    path.join(manager.projectDir, '.governance.json'),
    JSON.stringify({ lastAttemptAt: new Date().toISOString(), runCount: 0 }),
  );
  seedSessions(root, 5);
  const provider = new FakeProvider(['{"actions":[]}']);
  const governor = new MemoryGovernor(manager);
  const result = await governor.maybeRun(provider);
  assert.equal(result.ran, false);
  assert.equal(result.reason, 'scan_throttled');
  assert.equal(provider.requests.length, 0);
});

test('门控：治理锁占用时跳过', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manager.saveMemory({ name: 'note', description: 'd', type: 'project', content: '正文' });
  seedSessions(root, 5);
  writeFileSync(
    path.join(manager.projectDir, '.governance.lock'),
    JSON.stringify({ pid: 9999, timestamp: Date.now() }),
  );
  const provider = new FakeProvider(['{"actions":[]}']);
  const governor = new MemoryGovernor(manager);
  const result = await governor.maybeRun(provider);
  assert.equal(result.ran, false);
  assert.equal(result.reason, 'lock_busy');
  assert.equal(provider.requests.length, 0);
});

test('状态持久化：整理后更新 lastGovernedAt 与 runCount', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manager.saveMemory({ name: 'note', description: 'd', type: 'project', content: '正文' });
  const provider = new FakeProvider(['{"actions":[]}']);
  const governor = new MemoryGovernor(manager);
  await governor.run(provider);
  const state = governor.state();
  assert.equal(state.runCount, 1);
  assert.ok(state.lastGovernedAt);
  assert.ok(Date.now() - Date.parse(state.lastGovernedAt!) < 5_000);
});

test('去重合并：merge 生成新文件、删除源并保留作用域', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manager.saveMemory({ name: 'a-note', description: 'A', type: 'project', content: 'A 内容' });
  manager.saveMemory({ name: 'b-note', description: 'B', type: 'project', content: 'B 内容' });
  const provider = new FakeProvider([JSON.stringify({
    actions: [{
      action: 'merge',
      targets: ['a-note', 'b-note'],
      into: 'combined',
      description: '合并后的项目知识',
      content: '合并正文',
      reason: '内容重复',
    }],
  })]);
  const governor = new MemoryGovernor(manager);
  const result = await governor.run(provider);
  assert.deepEqual(result.executed.merged.sort(), ['a-note', 'b-note']);
  assert.equal(existsSync(path.join(manager.projectDir, 'combined.md')), true);
  assert.equal(existsSync(path.join(manager.projectDir, 'a-note.md')), false);
  assert.equal(existsSync(path.join(manager.projectDir, 'b-note.md')), false);
  assert.ok(result.archiveCount >= 2, '被合并源应归档');
  assert.match(readFileSync(path.join(manager.projectDir, 'MEMORY.md'), 'utf8'), /combined/u);
});

test('错误/过期删除：delete 移除文件并从索引消失', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manager.saveMemory({ name: 'stale-note', description: '过时', type: 'project', content: '旧内容' });
  const provider = new FakeProvider([JSON.stringify({
    actions: [{ action: 'delete', targets: ['stale-note'], reason: '内容已过时' }],
  })]);
  const governor = new MemoryGovernor(manager);
  const result = await governor.run(provider);
  assert.deepEqual(result.executed.deleted, ['stale-note']);
  assert.equal(existsSync(path.join(manager.projectDir, 'stale-note.md')), false);
  assert.doesNotMatch(readFileSync(path.join(manager.projectDir, 'MEMORY.md'), 'utf8'), /stale-note/u);
  const archives = readdirSync(path.join(manager.projectDir, '.archive'));
  assert.ok(archives.length > 0);
  assert.equal(existsSync(path.join(manager.projectDir, '.archive', archives[0], 'stale-note.md.bak')), true);
});

test('矛盾解决：update 覆盖目标文件', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manager.saveMemory({ name: 'topic', description: '旧描述', type: 'project', content: '旧正文' });
  const provider = new FakeProvider([JSON.stringify({
    actions: [{
      action: 'update',
      targets: ['topic'],
      description: '新描述',
      content: '新正文，矛盾已协调',
      reason: '与最新结论矛盾',
    }],
  })]);
  const governor = new MemoryGovernor(manager);
  const result = await governor.run(provider);
  assert.deepEqual(result.executed.updated, ['topic']);
  const updated = readFileSync(path.join(manager.projectDir, 'topic.md'), 'utf8');
  assert.match(updated, /新正文/);
  assert.match(updated, /新描述/u);
});

test('非法操作拒绝：MEMORY 与未知文件不删除，缺 content 的 merge 忽略', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manager.saveMemory({ name: 'ok-note', description: 'd', type: 'project', content: '保留' });
  const provider = new FakeProvider([JSON.stringify({
    actions: [
      { action: 'delete', targets: ['MEMORY', 'unknown-file'], reason: 'x' },
      { action: 'merge', targets: ['ok-note'], into: 'combined', reason: '缺 content' },
    ],
  })]);
  const governor = new MemoryGovernor(manager);
  const result = await governor.run(provider);
  assert.equal(existsSync(path.join(manager.projectDir, 'ok-note.md')), true, '合法文件不应被删除');
  assert.equal(existsSync(path.join(manager.projectDir, 'MEMORY.md')), true, '索引不应被删除');
  assert.equal(result.executed.deleted.length, 0);
  assert.equal(result.executed.merged.length, 0);
});

test('索引超限提示：超 200 行时返回被截断名单', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // 直接写 205 篇记忆文件（绕过 saveMemory 的逐次重建）
  mkdirSync(manager.projectDir, { recursive: true });
  for (let index = 0; index < 205; index += 1) {
    const name = `n-${String(index).padStart(3, '0')}`;
    writeFileSync(path.join(manager.projectDir, `${name}.md`), [
      '---',
      `name: ${name}`,
      `description: 第 ${index} 条`,
      'type: project',
      '---',
      '正文',
    ].join('\n'));
  }
  const provider = new FakeProvider([JSON.stringify({
    actions: [{ action: 'keep', targets: ['n-000'], reason: '保留' }],
  })]);
  const governor = new MemoryGovernor(manager);
  const result = await governor.run(provider);
  assert.equal(result.ran, true);
  assert.ok(result.indexOverflow?.overflow, '应报告索引超限');
  assert.equal(result.indexOverflow?.droppedNames.length, 5, '205 条应被截断 5 条');
});

test('keep 操作只计数不改文件', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manager.saveMemory({ name: 'stable', description: 'd', type: 'project', content: '正文' });
  const provider = new FakeProvider([JSON.stringify({
    actions: [{ action: 'keep', targets: ['stable'], reason: '仍然有效' }],
  })]);
  const governor = new MemoryGovernor(manager);
  const result = await governor.run(provider);
  assert.deepEqual(result.executed.kept, ['stable']);
  assert.equal(existsSync(path.join(manager.projectDir, 'stable.md')), true);
});
