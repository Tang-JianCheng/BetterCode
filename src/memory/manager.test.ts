import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { MemoryExtractor } from './extractor.js';
import { MemoryManager } from './manager.js';

function fixture(): { root: string; home: string; manager: MemoryManager } {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-memory-'));
  const home = path.join(root, 'home');
  mkdirSync(home);
  return { root, home, manager: new MemoryManager(root, { userHome: home }) };
}

class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly contextWindow = 128_000;
  readonly contextWindowIsDefault = false;
  requests: ProviderRequest[] = [];

  constructor(private readonly responses: Array<string | (() => Promise<string>)>) {}

  async chat(request: ProviderRequest, emit: (event: StreamEvent) => void): Promise<void> {
    this.requests.push(request);
    const response = this.responses.shift();
    const text = typeof response === 'function' ? await response() : response ?? 'NONE';
    emit({ type: 'text_delta', content: text });
    emit({ type: 'done', content: '' });
  }
}

test('记忆双路落盘、frontmatter 兼容和摘要注入', t => {
  const { root, home, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = manager.saveMemory({
    name: 'project-style',
    description: '项目使用中文注释',
    type: 'project',
    content: '新增注释必须使用中文。',
  });
  const user = manager.saveMemory({
    name: 'user-language',
    description: '用户偏好简体中文',
    type: 'user',
    content: '默认使用简体中文回复。',
  });
  assert.ok(project.startsWith(path.join(root, '.bettercode/memory')));
  assert.ok(user.startsWith(path.join(home, '.bettercode/memory')));
  assert.equal(manager.loadAll().length, 2);
  assert.match(manager.buildSystemReminder(), /project-style.*项目使用中文注释/);
  assert.match(manager.buildSystemReminder(), /user-language.*用户偏好简体中文/);

  const legacy = path.join(manager.projectDir, 'legacy.md');
  writeFileSync(legacy, '---\nname: legacy\ndescription: 旧格式\nmetadata:\n  type: reference\n---\n正文\n');
  assert.equal(manager.loadAll().find(memory => memory.name === 'legacy')?.type, 'reference');
});

test('记忆索引按名称排序并同时引用用户与项目笔记', t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  manager.saveMemory({ name: 'zeta', description: '最后', type: 'project', content: 'Z' });
  manager.saveMemory({ name: 'Alpha', description: '最先', type: 'feedback', content: 'A' });
  const index = readFileSync(path.join(manager.projectDir, 'MEMORY.md'), 'utf8');
  assert.ok(index.indexOf('[Alpha]') < index.indexOf('[zeta]'));
  assert.match(index, /~\/\.bettercode\/memory\/Alpha\.md/);
  assert.match(index, /\[zeta\]\(zeta\.md\)/);
});

test('MemoryExtractor 解析多块、空占位并禁止工具', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provider = new FakeProvider([[
    'MEMORY_NAME: preferred-language',
    'MEMORY_TYPE: user',
    'MEMORY_DESC: 用户偏好中文',
    'MEMORY_BODY:',
    '默认使用简体中文。',
    '---',
    'MEMORY_NAME: api-location',
    'MEMORY_TYPE: reference',
    'MEMORY_DESC: API 文件位置',
    'MEMORY_BODY:',
    '接口位于 src/api。',
  ].join('\n'), 'NONE']);
  const extractor = new MemoryExtractor(manager);
  assert.deepEqual(await extractor.extract('足够长的对话内容', provider), [
    'preferred-language', 'api-location',
  ]);
  assert.deepEqual(await extractor.extract('没有新内容', provider), []);
  assert.deepEqual(provider.requests.map(request => request.tools), [[], []]);
  assert.equal(existsSync(path.join(manager.userDir, 'preferred-language.md')), true);
  assert.equal(existsSync(path.join(manager.projectDir, 'api-location.md')), true);
});

test('MemoryExtractor 合并并发为当前运行加一次尾部运行', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const provider = new FakeProvider([
    async () => {
      await gate;
      return 'NONE';
    },
    'NONE',
  ]);
  const extractor = new MemoryExtractor(manager);
  const first = extractor.extract('第一段上下文', provider);
  await Promise.resolve();
  assert.deepEqual(await extractor.extract('第二段上下文', provider), []);
  assert.deepEqual(await extractor.extract('第三段最新上下文', provider), []);
  release?.();
  await first;
  assert.equal(provider.requests.length, 2);
  assert.match(provider.requests[1].messages[0].content, /第三段最新上下文/);
});

test('相关记忆选择只接受候选路径且最多五条', async t => {
  const { root, manager } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = Array.from({ length: 7 }, (_, index) => manager.saveMemory({
    name: `memory-${index}`,
    description: `描述 ${index}`,
    type: 'project',
    content: `正文 ${index}`,
  }));
  const provider = new FakeProvider([JSON.stringify({ paths: [...paths, '/outside.md'] })]);
  const selected = await manager.findRelevantMemories('查找项目记忆', provider);
  assert.equal(selected.length, 5);
  assert.equal(selected.every(item => paths.includes(item.path)), true);
});
