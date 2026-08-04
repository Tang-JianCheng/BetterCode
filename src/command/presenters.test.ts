import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandRegistry } from './registry.js';
import {
  buildCommandErrorPresentation,
  buildContextUsagePresentation,
  buildHelpPresentation,
  buildMemoryPresentation,
  buildStatusPresentation,
  presentationToPlainText,
} from './presenters.js';

function registry(): CommandRegistry {
  const result = new CommandRegistry();
  result.register({
    name: 'help', aliases: ['h'], description: '显示帮助', usage: '/help [命令]',
    argumentHint: '[命令]', type: 'local', handler() {},
  });
  result.register({
    name: 'plan', aliases: [], description: '进入计划模式', usage: '/plan',
    type: 'ui', handler() {},
  });
  result.register({
    name: 'hidden', aliases: [], description: '隐藏', usage: '/hidden',
    type: 'local', hidden: true, handler() {},
  });
  return result;
}

test('帮助 presenter 生成命令目录与单命令详情', () => {
  const all = buildHelpPresentation(registry());
  assert.equal(all.kind, 'document');
  assert.match(presentationToPlainText(all), /命令目录.*\/help \[命令\].*\/plan/su);
  assert.doesNotMatch(presentationToPlainText(all), /hidden/u);

  const one = buildHelpPresentation(registry(), '/help');
  assert.equal(one.kind, 'document');
  assert.match(presentationToPlainText(one), /别名: \/h/u);
  const missing = buildHelpPresentation(registry(), 'missing');
  assert.equal(missing.kind, 'notice');
  assert.equal(missing.kind === 'notice' ? missing.tone : '', 'danger');
});

test('状态与记忆 presenter 保留结构化数据', () => {
  const memory = {
    userDirectory: '/home/.bettercode/memory', projectDirectory: '/repo/.bettercode/memory',
    userCount: 2, projectCount: 3,
  };
  const status = buildStatusPresentation({
    provider: { name: 'deepseek', model: 'deepseek-chat' },
    agentMode: 'plan', permissionMode: 'default', sessionId: 's1', memory,
    activeSkills: ['review'],
  });
  assert.match(presentationToPlainText(status), /BetterCode 状态.*deepseek-chat.*PLAN.*暂无用量数据/su);
  assert.match(presentationToPlainText(buildMemoryPresentation(memory)), /用户级: 2 条/u);
});

test('命令错误使用危险通知而不是助手消息', () => {
  const item = buildCommandErrorPresentation('/missing', '使用 /help 查看命令');
  assert.equal(item.kind, 'notice');
  if (item.kind === 'notice') {
    assert.equal(item.tone, 'danger');
    assert.match(item.message ?? '', /\/help/u);
  }
});

test('上下文 presenter 渲染动态格子和分类下嵌套明细', () => {
  const snapshot = {
    providerName: 'PackyCode-Deepseek',
    model: 'deepseek-v4-flash',
    contextWindow: 1_000_000,
    systemPromptTokens: 2_400,
    systemToolsTokens: 10_200,
    mcpToolsTokens: 16_200,
    skillsTokens: 10_000,
    messagesTokens: 13_800,
    systemToolCount: 6,
    mcpToolCount: 2,
    systemToolEntries: [{ name: 'read_file', tokens: 1_700 }],
    mcpToolEntries: [{ name: 'mcp_tzc_mcp_batchList_12345678', tokens: 421 }],
    skillEntries: [{ name: 'review', tokens: 1_500 }],
    messageCount: 12,
    usedTokens: 52_600,
  };
  const text = presentationToPlainText(buildContextUsagePresentation(snapshot, { unicode: false }));
  assert.match(text, /deepseek-v4-flash\[1M\]/u);
  assert.match(text, /52\.6k \/ 1m tokens \(5\.3%\)/u);
  assert.match(text, /System prompt: 2\.4k tokens \(0\.2%\)/u);
  assert.match(text, /System tools: 10\.2k tokens \(1\.0%\) · 6 tools/u);
  assert.match(text, /     ├ read_file: 1\.7k tokens/u);
  assert.match(text, /MCP tools: 16\.2k tokens \(1\.6%\) · 2 tools/u);
  assert.match(text, /     ├ mcp_tzc_mcp_batchList_12345678: 421 tokens/u);
  assert.match(text, /Skills: 10k tokens \(1\.0%\)/u);
  assert.match(text, /     ├ review: 1\.5k tokens/u);
  assert.match(text, /Messages: 13\.8k tokens \(1\.4%\) · 12 条消息/u);
  assert.match(text, /Free space: 947\.4k tokens \(94\.7%\)/u);
  assert.doesNotMatch(text, /MCP tools 明细/u);
  assert.match(text, /#/u);

  const item = buildContextUsagePresentation(snapshot, { unicode: false });
  assert.equal(item.kind, 'document');
  const trees = item.kind === 'document'
    ? item.blocks.filter((block): block is Extract<typeof block, { type: 'tree' }> =>
        block.type === 'tree')
    : [];
  assert.ok(trees.length >= 4);
  const grid = trees[0];
  const byContent = (pattern: RegExp, tree = grid) =>
    tree.lines.find(line => pattern.test(line.content));
  assert.equal(byContent(/System prompt:/u)?.color, 'info');
  assert.equal(byContent(/System tools:/u)?.color, 'success');
  assert.equal(byContent(/MCP tools:/u)?.color, 'warning');
  assert.equal(byContent(/Skills:/u)?.color, 'brand');
  assert.equal(byContent(/Messages:/u)?.color, 'danger');
  assert.equal(byContent(/Free space:/u)?.color, 'muted');
  assert.ok((byContent(/System tools:/u)?.prefixSegments ?? []).length > 0);
  assert.equal(grid.lines.some(line => line.branch), false);
  const modelLine = byContent(/deepseek-v4-flash/u);
  assert.ok(modelLine?.prefixSegments?.some(segment => segment.color === 'brand'));
  assert.ok(modelLine?.prefixSegments?.some(segment => segment.color === 'muted'));

  const detailTrees = trees.slice(1);
  assert.ok(detailTrees.every(tree => tree.lines.some(line => line.branch)));
  assert.ok(byContent(/^\*\*System tools\*\*$/u, detailTrees[0]));
  assert.ok(byContent(/^\*\*MCP tools\*\*$/u, detailTrees[1]));
  assert.ok(byContent(/^\*\*Skills\*\*$/u, detailTrees[2]));
  const readFile = detailTrees.flatMap(tree => tree.lines)
    .find(line => /read_file/u.test(line.content));
  assert.equal(readFile?.branch, true);
});
