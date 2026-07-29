import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  discoverInstructions,
  loadInstructions,
  MAX_INCLUDE_DEPTH,
} from './instructions.js';

function fixture(): { root: string; workDir: string; home: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-instructions-'));
  const workDir = path.join(root, 'packages/app');
  const home = path.join(root, 'home');
  mkdirSync(path.join(root, '.git'));
  mkdirSync(workDir, { recursive: true });
  mkdirSync(path.join(home, '.bettercode'), { recursive: true });
  return { root, workDir, home };
}

test('指令按用户全局、项目层级和本地覆盖顺序加载', t => {
  const { root, workDir, home } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(home, '.bettercode/BETTERCODE.md'), '用户全局');
  writeFileSync(path.join(root, 'AGENTS.md'), '仓库规则');
  writeFileSync(path.join(root, 'packages/BETTERCODE.md'), '包规则');
  writeFileSync(path.join(workDir, 'BETTERCODE.local.md'), '本地覆盖');
  const sources = discoverInstructions(workDir, { userHome: home });
  assert.deepEqual(sources.map(source => source.content), [
    '用户全局', '仓库规则', '包规则', '本地覆盖',
  ]);
  const combined = loadInstructions(workDir, { userHome: home });
  assert.ok(combined.indexOf('用户全局') < combined.indexOf('本地覆盖'));
  assert.match(combined, /instructions from/);
});

test('相对、用户目录和绝对 include 会展开并标注来源', t => {
  const { root, workDir, home } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(workDir, 'rules'));
  writeFileSync(path.join(workDir, 'rules/project.md'), '项目内规则');
  writeFileSync(path.join(home, 'user.md'), '用户规则');
  const absolute = path.join(root, 'absolute.md');
  writeFileSync(absolute, '绝对规则');
  writeFileSync(path.join(workDir, 'BETTERCODE.md'), [
    '@./rules/project.md',
    '@/not-found.md',
    '@~/user.md',
    `@${absolute}`,
  ].join('\n'));
  const content = loadInstructions(workDir, { userHome: home });
  assert.match(content, /included from \.\/rules\/project\.md/);
  assert.match(content, /项目内规则/);
  assert.match(content, /用户规则/);
  assert.match(content, /绝对规则/);
  assert.match(content, /@\/not-found\.md/);
});

test('include 循环、深度上限和代码块保持原引用', t => {
  const { root, workDir, home } = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(workDir, 'A.md'), '@./B.md');
  writeFileSync(path.join(workDir, 'B.md'), '@./A.md');
  writeFileSync(path.join(workDir, 'BETTERCODE.md'), [
    '@./A.md',
    '```text',
    '@./not-real.md',
    '```',
    '@@./escaped.md',
    '@someone',
  ].join('\n'));
  const content = loadInstructions(workDir, { userHome: home });
  assert.match(content, /@\.\/A\.md/);
  assert.match(content, /```text\n@\.\/not-real\.md\n```/);
  assert.match(content, /@@\.\/escaped\.md/);
  assert.match(content, /@someone/);

  for (let index = 0; index <= MAX_INCLUDE_DEPTH; index += 1) {
    writeFileSync(path.join(workDir, `depth-${index}.md`),
      index === MAX_INCLUDE_DEPTH ? '最深内容' : `@./depth-${index + 1}.md`);
  }
  writeFileSync(path.join(workDir, 'BETTERCODE.local.md'), '@./depth-0.md');
  const deep = loadInstructions(workDir, { userHome: home });
  assert.doesNotMatch(deep, /最深内容/);
  assert.match(deep, new RegExp(`@\\./depth-${MAX_INCLUDE_DEPTH}\\.md`));
});
