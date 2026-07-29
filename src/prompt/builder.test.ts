import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSystemPrompt } from './builder.js';
import { SYSTEM_PROMPT_SECTIONS } from './sections.js';
import type { PromptSection } from './types.js';

test('system prompt builds seven fixed modules in priority order', () => {
  const prompt = buildSystemPrompt();
  const headings = [...prompt.matchAll(/^## (.+)$/gm)].map(match => match[1]);

  assert.deepEqual(headings, [
    '身份', '系统约束', '任务模式', '动作执行', '工具使用', '语气风格', '文本输出',
  ]);
  assert.equal(prompt.startsWith('## 身份\n'), true);
  assert.equal(prompt.endsWith('内部编排细节。'), true);
  assert.equal(prompt.includes('\n\n\n## '), false);
});

test('system prompt is deterministic and does not mutate custom sections', () => {
  const custom: PromptSection[] = [
    { id: 'low', priority: 1, title: '低', content: '低优先级' },
    { id: 'high', priority: 9, title: '高', content: '高优先级' },
  ];
  const original = structuredClone(custom);

  assert.equal(buildSystemPrompt(), buildSystemPrompt());
  assert.equal(buildSystemPrompt(custom), '## 高\n高优先级\n\n## 低\n低优先级');
  assert.deepEqual(custom, original);
  assert.equal(Object.isFrozen(SYSTEM_PROMPT_SECTIONS), true);
});

test('system prompt rejects invalid sections', () => {
  const valid = { id: 'one', priority: 1, title: '标题', content: '内容' };

  assert.throws(() => buildSystemPrompt([valid, { ...valid }]), /ID 重复/);
  assert.throws(() => buildSystemPrompt([{ ...valid, title: ' ' }]), /标题不能为空/);
  assert.throws(() => buildSystemPrompt([{ ...valid, content: ' ' }]), /内容不能为空/);
  assert.throws(() => buildSystemPrompt([{ ...valid, priority: Number.NaN }]), /优先级无效/);
});

test('system prompt contains stable safety and tool rules without dynamic context', () => {
  const prompt = buildSystemPrompt();

  assert.match(prompt, /BetterCode/);
  assert.match(prompt, /专用工具/);
  assert.match(prompt, /编辑或覆盖现有文件前必须先读取/);
  assert.match(prompt, /项目根目录和当前工作目录/);
  assert.match(prompt, /工具失败后根据结构化错误调整/);
  assert.match(prompt, /<system-reminder>.*运行期元指令/);
  assert.doesNotMatch(prompt, /Users\/|2026-\d{2}-\d{2}|当前任务模式：(?:act|plan)/);
});

test('system prompt 可选指令与记忆分区按优先级加入', () => {
  const prompt = buildSystemPrompt(undefined, {
    customInstructions: '项目使用中文注释',
    memorySection: '用户偏好简体中文',
  });
  assert.match(prompt, /## 长期记忆\n用户偏好简体中文/);
  assert.match(prompt, /## 自定义指令\n项目使用中文注释/);
  assert.ok(prompt.indexOf('## 文本输出') < prompt.indexOf('## 长期记忆'));
  assert.ok(prompt.indexOf('## 长期记忆') < prompt.indexOf('## 自定义指令'));
});
