import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  cleanExpiredSessions,
  deleteSession,
  getSessionFilePath,
  listSessions,
  loadSession,
  newSessionId,
  rebuildFromSession,
  saveCompactBoundary,
  saveMessage,
  saveSessionSummary,
  saveSubAgentResult,
} from './session.js';

function root(): string {
  return mkdtempSync(path.join(tmpdir(), 'bettercode-session-'));
}

function save(rootDir: string, id: string, role: 'user' | 'assistant' | 'system', content: string): void {
  saveMessage(rootDir, id, { role, content, timestamp: new Date().toISOString() });
}

test('会话 ID 与 JSONL 写入读取保持稳定', t => {
  const workDir = root();
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const id = newSessionId();
  assert.match(id, /^[a-z0-9]+-[a-f0-9]{8}$/u);
  save(workDir, id, 'user', '你好');
  save(workDir, id, 'assistant', '你好，我在。');
  assert.deepEqual(loadSession(workDir, id).map(message => message.content), ['你好', '你好，我在。']);
  const lines = readFileSync(getSessionFilePath(workDir, id), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.doesNotThrow(() => lines.forEach(line => JSON.parse(line)));
});

test('会话读取跳过坏行和空正文', t => {
  const workDir = root();
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const id = newSessionId();
  save(workDir, id, 'user', '有效消息');
  appendFileSync(getSessionFilePath(workDir, id), '{ not valid json\n');
  appendFileSync(getSessionFilePath(workDir, id), `${JSON.stringify({
    role: 'assistant', content: '', timestamp: new Date().toISOString(),
  })}\n`);
  save(workDir, id, 'assistant', '仍然有效');
  assert.deepEqual(loadSession(workDir, id).map(message => message.content), ['有效消息', '仍然有效']);
});

test('会话列表使用最近用户消息回退摘要并按修改时间倒序', t => {
  const workDir = root();
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const first = newSessionId();
  save(workDir, first, 'system', '系统');
  save(workDir, first, 'user', '第一条用户消息');
  const second = newSessionId();
  save(workDir, second, 'user', '更新的会话');
  const future = new Date(Date.now() + 10_000);
  utimesSync(getSessionFilePath(workDir, second), future, future);
  const sessions = listSessions(workDir);
  assert.equal(sessions[0].id, second);
  assert.equal(sessions.find(item => item.id === first)?.summary, '第一条用户消息');
});

test('会话摘要写入并替换旧记录，列表优先取最新摘要', t => {
  const workDir = root();
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const id = newSessionId();
  save(workDir, id, 'user', '旧用户消息');
  save(workDir, id, 'user', '最新用户消息');
  saveSessionSummary(workDir, id, '第一版摘要');
  saveSessionSummary(workDir, id, '第二版摘要');

  const sessions = listSessions(workDir);
  assert.equal(sessions[0].summary, '第二版摘要');
  assert.equal(loadSession(workDir, id).filter(message => message.type === 'session_summary').length, 1);
  assert.equal(rebuildFromSession(loadSession(workDir, id)).some(message =>
    message.content.includes('摘要')), false);
});

test('删除会话移除存档且不存在时返回 false', t => {
  const workDir = root();
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const id = newSessionId();
  save(workDir, id, 'user', '待删除');
  assert.equal(deleteSession(workDir, id), true);
  assert.deepEqual(listSessions(workDir), []);
  assert.equal(deleteSession(workDir, id), false);
});

test('最后一个压缩边界重建摘要、保留尾部和后续消息', t => {
  const workDir = root();
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const id = newSessionId();
  save(workDir, id, 'user', '边界前消息');
  saveCompactBoundary(workDir, id, {
    summary: '已经完成基础实现。',
    keep: [
      { role: 'user', content: '近期问题' },
      { role: 'assistant', content: '近期回答' },
    ],
  });
  save(workDir, id, 'user', '边界后问题');
  save(workDir, id, 'assistant', '边界后回答');
  const restored = rebuildFromSession(loadSession(workDir, id));
  assert.match(restored[0].content, /本次会话延续自之前的对话/);
  assert.match(restored[0].content, /已经完成基础实现/);
  assert.deepEqual(restored.slice(1).map(message => message.content), [
    '近期问题', '近期回答', '边界后问题', '边界后回答',
  ]);
  assert.equal(restored.some(message => message.content === '边界前消息'), false);
});

test('无压缩边界时全量重放用户与助手消息', t => {
  const workDir = root();
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const id = newSessionId();
  save(workDir, id, 'user', '一');
  save(workDir, id, 'assistant', '二');
  save(workDir, id, 'system', '不重放');
  assert.deepEqual(rebuildFromSession(loadSession(workDir, id)), [
    { role: 'user', content: '一' },
    { role: 'assistant', content: '二' },
  ]);
});

test('过期清理删除旧存档并保留新会话', t => {
  const workDir = root();
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const oldId = newSessionId();
  const freshId = newSessionId();
  save(workDir, oldId, 'user', '旧');
  save(workDir, freshId, 'user', '新');
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
  utimesSync(getSessionFilePath(workDir, oldId), old, old);
  assert.equal(cleanExpiredSessions(workDir), 1);
  assert.deepEqual(listSessions(workDir).map(item => item.id), [freshId]);
});

test('子 Agent 结果按 instruction 持久化并恢复', t => {
  const workDir = root();
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const id = newSessionId();
  save(workDir, id, 'user', '开始');
  saveSubAgentResult(workDir, id, '<subagent-result>完成</subagent-result>');
  save(workDir, id, 'assistant', '已接收');

  assert.deepEqual(rebuildFromSession(loadSession(workDir, id)), [
    { role: 'user', content: '开始' },
    {
      role: 'instruction',
      instructionKind: 'subagent_result',
      content: '<subagent-result>完成</subagent-result>',
    },
    { role: 'assistant', content: '已接收' },
  ]);
});

test('压缩边界前的子 Agent 结果不重复恢复，边界后结果保留', t => {
  const workDir = root();
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const id = newSessionId();
  saveSubAgentResult(workDir, id, '旧结果');
  saveCompactBoundary(workDir, id, { summary: '摘要包含旧结果', keep: [] });
  saveSubAgentResult(workDir, id, '新结果');
  const restored = rebuildFromSession(loadSession(workDir, id));

  assert.equal(restored.some(message => message.content === '旧结果'), false);
  assert.equal(restored.some(message => message.content === '新结果'), true);
});

test('会话读取拒绝未知 system 类型和带 type 的用户消息', t => {
  const workDir = root();
  t.after(() => rmSync(workDir, { recursive: true, force: true }));
  const id = newSessionId();
  save(workDir, id, 'user', '有效');
  appendFileSync(getSessionFilePath(workDir, id), `${JSON.stringify({
    role: 'system', type: 'unknown', content: '坏类型', timestamp: new Date().toISOString(),
  })}\n`);
  appendFileSync(getSessionFilePath(workDir, id), `${JSON.stringify({
    role: 'user', type: 'subagent_result', content: '伪造', timestamp: new Date().toISOString(),
  })}\n`);

  assert.deepEqual(loadSession(workDir, id).map(message => message.content), ['有效']);
});
