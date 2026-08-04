import type { AgentMode } from '../agent/types.js';
import type { MemoryStatus } from '../chat/manager.js';
import type { ContextUsageSnapshot } from '../context/types.js';
import type { PermissionMode, PermissionStatus } from '../permission/types.js';
import type { TokenUsage } from '../provider/types.js';
import type { SessionInfo } from '../session/session.js';
import { createDocument, createNotice } from '../presentation/builders.js';
import type { PresentationBlock, PresentationItem } from '../presentation/types.js';
import type { CommandDefinition } from './types.js';
import type { CommandRegistry } from './registry.js';

export interface CommandStatusSnapshot {
  provider: { name: string; model: string };
  agentMode: AgentMode;
  permissionMode: PermissionMode;
  sessionId: string;
  usage?: TokenUsage;
  memory: MemoryStatus;
  activeSkills?: readonly string[];
  subAgentTasks?: { total: number; running: number; background: number };
  team?: {
    name: string;
    coordinator: boolean;
    members: number;
    tasks: number;
    pendingApprovals: number;
    unreadMessages: number;
  };
}

export interface ContextUsageRenderOptions {
  unicode?: boolean;
}

function commandUsage(definition: CommandDefinition): string {
  return definition.usage || `/${definition.name}`;
}

function contextGridCells(contextWindow: number): number {
  return Math.min(64, Math.max(12, Math.round(contextWindow / 32_000)));
}

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) {
    const amount = value / 1_000_000;
    return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}m`;
  }
  if (value >= 1_000) {
    const amount = value / 1_000;
    return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}k`;
  }
  return String(value);
}

function contextWindowSuffix(contextWindow: number): string {
  if (contextWindow >= 1_000_000) {
    const amount = contextWindow / 1_000_000;
    return `[${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}M]`;
  }
  const amount = contextWindow / 1_000;
  return `[${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)}k]`;
}

function usagePercent(tokens: number, contextWindow: number): string {
  return `${((tokens / contextWindow) * 100).toFixed(1)}%`;
}

export function buildContextUsagePresentation(
  snapshot: ContextUsageSnapshot,
  options: ContextUsageRenderOptions = {},
): PresentationItem {
  const cellCount = contextGridCells(snapshot.contextWindow);
  const usedCells = Math.max(0, Math.min(
    cellCount,
    Math.round((snapshot.usedTokens / snapshot.contextWindow) * cellCount),
  ));
  const usedGlyph = options.unicode === false ? '#' : '⛁';
  const freeGlyph = options.unicode === false ? '.' : '⛶';
  const grid = usedGlyph.repeat(usedCells) + freeGlyph.repeat(cellCount - usedCells);
  const freeTokens = Math.max(0, snapshot.contextWindow - snapshot.usedTokens);
  const lines = [
    `${grid}   ${snapshot.model}${contextWindowSuffix(snapshot.contextWindow)}`,
    `${formatCompactTokens(snapshot.usedTokens)} / ${formatCompactTokens(snapshot.contextWindow)} tokens ` +
      `(${usagePercent(snapshot.usedTokens, snapshot.contextWindow)})`,
  ];
  const categoryLines = [
    'Estimated usage by category',
    `System prompt: ${formatCompactTokens(snapshot.systemPromptTokens)} tokens ` +
      `(${usagePercent(snapshot.systemPromptTokens, snapshot.contextWindow)})`,
    `System tools: ${formatCompactTokens(snapshot.systemToolsTokens)} tokens ` +
      `(${usagePercent(snapshot.systemToolsTokens, snapshot.contextWindow)}) · ${snapshot.systemToolCount} tools`,
    `MCP tools: ${formatCompactTokens(snapshot.mcpToolsTokens)} tokens ` +
      `(${usagePercent(snapshot.mcpToolsTokens, snapshot.contextWindow)}) · ${snapshot.mcpToolCount} tools`,
    `Skills: ${formatCompactTokens(snapshot.skillsTokens)} tokens ` +
      `(${usagePercent(snapshot.skillsTokens, snapshot.contextWindow)})`,
    `Messages: ${formatCompactTokens(snapshot.messagesTokens)} tokens ` +
      `(${usagePercent(snapshot.messagesTokens, snapshot.contextWindow)})`,
    `Free space: ${formatCompactTokens(freeTokens)} tokens ` +
      `(${usagePercent(freeTokens, snapshot.contextWindow)})`,
  ];
  const blocks: PresentationBlock[] = [
    { type: 'text', content: lines.join('\n') },
    { type: 'divider' },
    { type: 'text', content: categoryLines.join('\n') },
  ];
  const mcpEntries = snapshot.mcpToolEntries
    .slice(0, 10)
    .map(entry => `${entry.name}: ${formatCompactTokens(entry.tokens)} tokens`);
  if (mcpEntries.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'text', content: 'MCP tools 明细', heading: true });
    blocks.push({ type: 'list', items: mcpEntries });
  }
  return createDocument({
    source: 'command',
    title: '上下文使用',
    tone: 'info',
    badge: 'CONTEXT',
    blocks,
    footer: '使用 /model 切换模型 · 上下文窗口随模型动态变化',
  });
}

export function buildHelpPresentation(
  registry: CommandRegistry,
  name = '',
): PresentationItem {
  if (name.trim()) {
    const definition = registry.get(name.replace(/^\//u, ''));
    if (!definition || definition.hidden) {
      return buildCommandErrorPresentation(
        name,
        `未找到命令 ${name}。使用 /help 查看可用命令。`,
      );
    }
    const entries = [
      { label: '用法', value: commandUsage(definition) },
      { label: '说明', value: definition.description },
      ...(definition.aliases.length
        ? [{ label: '别名', value: definition.aliases.map(alias => `/${alias}`).join(', ') }]
        : []),
      ...(definition.argumentHint
        ? [{ label: '参数', value: definition.argumentHint }]
        : []),
    ];
    return createDocument({
      source: 'command',
      title: `命令 /${definition.name}`,
      tone: 'info',
      badge: 'HELP',
      blocks: [{ type: 'key_value', entries }],
      footer: '输入 /help 查看全部命令',
    });
  }

  const definitions = registry.list();
  if (definitions.length === 0) {
    return createNotice({ tone: 'info', title: '命令帮助', message: '当前没有可用命令。' });
  }
  const groups: Array<{ type: CommandDefinition['type']; title: string }> = [
    { type: 'local', title: '查看与本地操作' },
    { type: 'ui', title: '会话与模式' },
    { type: 'prompt', title: 'AI 工作流' },
  ];
  const blocks: PresentationBlock[] = [];
  for (const group of groups) {
    const commands = definitions.filter(definition => definition.type === group.type);
    if (commands.length === 0) continue;
    blocks.push({ type: 'text', content: group.title, heading: true });
    blocks.push({
      type: 'table',
      columns: [
        { key: 'usage', label: '命令', priority: 1 },
        { key: 'description', label: '说明', priority: 2 },
      ],
      rows: commands.map(definition => [commandUsage(definition), definition.description]),
    });
  }
  return createDocument({
    source: 'command',
    title: '命令目录',
    tone: 'info',
    badge: 'HELP',
    blocks,
    footer: '使用 /help <命令> 查看详细用法 · Tab 可补全命令',
  });
}

export function buildStatusPresentation(status: CommandStatusSnapshot): PresentationItem {
  const usage = status.usage;
  const blocks: PresentationBlock[] = [
    {
      type: 'key_value',
      columns: 2,
      entries: [
        { label: 'Provider', value: status.provider.name },
        { label: '模型', value: status.provider.model },
        { label: 'Agent 模式', value: status.agentMode === 'plan' ? 'PLAN' : 'DEFAULT' },
        { label: '权限模式', value: status.permissionMode },
        { label: '会话', value: status.sessionId },
        { label: 'Skill', value: status.activeSkills?.length ? status.activeSkills.join(', ') : '无' },
      ],
    },
    { type: 'divider' },
    {
      type: 'key_value',
      columns: 2,
      entries: usage ? [
        { label: 'Token 输入', value: String(usage.inputTokens) },
        { label: 'Token 输出', value: String(usage.outputTokens) },
        { label: '缓存创建', value: String(usage.cacheCreationInputTokens) },
        { label: '缓存命中', value: String(usage.cacheReadInputTokens) },
        { label: 'Token 总计', value: String(usage.totalTokens) },
      ] : [{ label: 'Token', value: '暂无用量数据' }],
    },
    { type: 'divider' },
    {
      type: 'key_value',
      columns: 2,
      entries: [
        { label: '用户记忆', value: `${status.memory.userCount} 条` },
        { label: '项目记忆', value: `${status.memory.projectCount} 条` },
        { label: '子 Agent', value: `${status.subAgentTasks?.total ?? 0} 个` },
        { label: '运行中', value: `${status.subAgentTasks?.running ?? 0} 个` },
        { label: '后台', value: `${status.subAgentTasks?.background ?? 0} 个` },
      ],
    },
  ];
  if (status.team) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'key_value',
      columns: 2,
      entries: [
        { label: '团队', value: status.team.name },
        { label: '角色', value: status.team.coordinator ? 'COORDINATOR' : 'LEAD' },
        { label: '成员', value: String(status.team.members) },
        { label: '任务', value: String(status.team.tasks) },
        { label: '待审批', value: String(status.team.pendingApprovals) },
        { label: '未读消息', value: String(status.team.unreadMessages) },
      ],
    });
  }
  return createDocument({
    source: 'command', title: 'BetterCode 状态', tone: 'info', badge: 'STATUS', blocks,
  });
}

export function buildMemoryPresentation(status: MemoryStatus): PresentationItem {
  return createDocument({
    source: 'command', title: '长期记忆', tone: 'info', badge: 'MEMORY', blocks: [{
      type: 'key_value',
      entries: [
        { label: '用户级', value: `${status.userCount} 条` },
        { label: '项目级', value: `${status.projectCount} 条` },
        { label: '用户目录', value: status.userDirectory },
        { label: '项目目录', value: status.projectDirectory },
      ],
    }],
  });
}

export function buildPermissionPresentation(status: PermissionStatus): PresentationItem {
  const counts = status.ruleCounts;
  return createDocument({
    source: 'command', title: '权限状态', tone: 'warning', badge: 'PERMISSION', blocks: [
      {
        type: 'key_value',
        entries: [
          { label: '当前模式', value: status.mode },
          { label: '会话规则', value: String(counts.session) },
          { label: '项目本地', value: String(counts.local) },
          { label: '项目共享', value: String(counts.project) },
          { label: '用户全局', value: String(counts.user) },
        ],
      },
      ...(status.diagnostics.length ? [{
        type: 'list' as const,
        items: status.diagnostics.map(item => `${item.file}: ${item.message}`),
      }] : []),
    ],
  });
}

export function buildSessionPresentation(
  currentSessionId: string,
  sessions: readonly SessionInfo[],
): PresentationItem {
  return createDocument({
    source: 'command', title: '历史会话', tone: 'info', badge: 'SESSION', blocks: [
      { type: 'key_value', entries: [{ label: '当前会话', value: currentSessionId }] },
      ...(sessions.length ? [{
        type: 'table' as const,
        columns: [
          { key: 'id', label: '会话 ID' },
          { key: 'messages', label: '消息' },
          { key: 'summary', label: '摘要' },
        ],
        rows: sessions.slice(0, 10).map(session => [
          session.id, String(session.messageCount), session.summary || '无摘要',
        ]),
      }] : [{ type: 'text' as const, content: '没有可恢复的历史会话。', muted: true }]),
    ],
    footer: '使用 /session <会话 ID> 恢复',
  });
}

export function buildTextCommandPresentation(
  title: string,
  content: string,
  badge: string,
): PresentationItem {
  return createDocument({
    source: 'command', title, tone: 'info', badge, blocks: [{ type: 'text', content }],
  });
}

export function buildCommandErrorPresentation(command: string, message: string): PresentationItem {
  return createNotice({
    tone: 'danger',
    title: command ? `命令 ${command.startsWith('/') ? command : `/${command}`}` : '命令错误',
    message,
    source: 'command',
  });
}

export function buildCommandNotice(
  title: string,
  message: string,
  tone: 'info' | 'success' | 'warning' = 'success',
): PresentationItem {
  return createNotice({ tone, title, message, source: 'command' });
}

export function presentationToPlainText(item: PresentationItem): string {
  if (item.kind === 'conversation') return item.content;
  if (item.kind === 'notice') {
    return [item.title, item.message, ...(item.details ?? [])].filter(Boolean).join('\n');
  }
  const lines = [item.title];
  for (const block of item.blocks) {
    if (block.type === 'text') lines.push(block.content);
    if (block.type === 'key_value') {
      lines.push(...block.entries.map(entry => `${entry.label}: ${entry.value}`));
    }
    if (block.type === 'list') {
      lines.push(...block.items.map((value, index) => `${block.ordered ? `${index + 1}.` : '-'} ${value}`));
    }
    if (block.type === 'table') {
      lines.push(block.columns.map(column => column.label).join('  '));
      lines.push(...block.rows.map(row => row.join('  ')));
    }
  }
  if (item.footer) lines.push(item.footer);
  return lines.join('\n');
}
