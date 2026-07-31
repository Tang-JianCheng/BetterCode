import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HookConfigError, HookConfigLoader } from './config-loader.js';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-hook-config-'));
}

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test('Hook 配置按用户、项目、本地顺序加载并展开 HTTP 环境变量', t => {
  const root = makeRoot();
  const home = path.join(root, 'home');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(path.join(home, '.bettercode', 'hooks.yaml'), `version: 1
hooks:
  - event: system_start
    action: { type: command, command: echo user }
`);
  write(path.join(root, '.bettercode', 'hooks.yaml'), `version: 1
hooks:
  - event: turn_start
    action: { type: prompt, prompt: project }
`);
  write(path.join(root, '.bettercode', 'hooks.local.yaml'), `version: 1
hooks:
  - event: post_tool_use
    action:
      type: http
      url: https://example.test/\${TOKEN}
`);

  const loaded = new HookConfigLoader(root, {
    userHome: home,
    env: { TOKEN: 'secret-value' },
  }).load();
  assert.deepEqual(loaded.rules.map(rule => rule.source.layer), ['user', 'project', 'local']);
  assert.equal(
    (loaded.rules[2].value.action as Record<string, unknown>).url,
    'https://example.test/secret-value',
  );
  assert.deepEqual(loaded.secretValues, ['secret-value']);
});

test('任一 Hook YAML 错误会让加载整体失败', t => {
  const root = makeRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(path.join(root, '.bettercode', 'hooks.yaml'), 'version: 1\nhooks: [\n');
  assert.throws(
    () => new HookConfigLoader(root, { userHome: path.join(root, 'home') }).load(),
    HookConfigError,
  );
});

test('项目 Hook 配置拒绝指向项目外的符号链接', t => {
  const root = makeRoot();
  const outside = makeRoot();
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  write(path.join(outside, 'hooks.yaml'), 'version: 1\nhooks: []\n');
  mkdirSync(path.join(root, '.bettercode'), { recursive: true });
  symlinkSync(path.join(outside, 'hooks.yaml'), path.join(root, '.bettercode', 'hooks.yaml'));
  assert.throws(
    () => new HookConfigLoader(root, { userHome: path.join(root, 'home') }).load(),
    /配置路径无效/,
  );
});
