import type { PermissionMode } from '../permission/types.js';
import { CommandRegistry } from './registry.js';
import type { CommandDefinition, CommandInvocation } from './types.js';

const PERMISSION_MODES = new Set<PermissionMode>(['strict', 'default', 'allow']);

function noArguments(invocation: CommandInvocation): boolean {
  if (!invocation.args) return true;
  invocation.ui.showMessage(`用法: ${invocation.definition.usage}`);
  return false;
}

export function formatCommandHelp(registry: CommandRegistry, name = ''): string {
  if (name.trim()) {
    const definition = registry.get(name.replace(/^\//u, ''));
    if (!definition || definition.hidden) return `未找到命令: ${name}。使用 /help 查看可用命令。`;
    const aliases = definition.aliases.length > 0
      ? `\n别名: ${definition.aliases.map(alias => `/${alias}`).join(', ')}`
      : '';
    return `${definition.usage}\n${definition.description}${aliases}`;
  }
  const definitions = registry.list();
  if (definitions.length === 0) return '没有可用命令。';
  const width = Math.max(...definitions.map(definition => definition.usage.length));
  return [
    '可用命令:',
    ...definitions.map(definition =>
      `  ${definition.usage.padEnd(width)}  ${definition.description}`),
  ].join('\n');
}

function definitions(): CommandDefinition[] {
  return [
    {
      name: 'help', aliases: ['h', '?'], description: '显示命令帮助', usage: '/help [命令]',
      argumentHint: '[命令]', type: 'local',
      handler: ({ args, registry, ui }) => ui.showMessage(formatCommandHelp(registry, args)),
    },
    {
      name: 'compact', aliases: [], description: '手动压缩较早对话上下文', usage: '/compact',
      type: 'ui', handler: invocation => {
        if (!noArguments(invocation)) return;
        return invocation.ui.compactConversation();
      },
    },
    {
      name: 'clear', aliases: ['reset'], description: '清空当前会话和界面', usage: '/clear',
      type: 'ui', handler: invocation => {
        if (!noArguments(invocation)) return;
        return invocation.ui.clearConversation();
      },
    },
    {
      name: 'plan', aliases: ['p'], description: '进入只读计划模式', usage: '/plan',
      type: 'ui', handler: invocation => {
        if (!noArguments(invocation)) return;
        invocation.ui.setAgentMode('plan');
        invocation.ui.showMessage('已进入计划模式，后续任务只使用读取与搜索工具。');
        invocation.ui.refreshStatus();
      },
    },
    {
      name: 'do', aliases: ['d'], description: '返回默认执行模式', usage: '/do',
      type: 'ui', handler: invocation => {
        if (!noArguments(invocation)) return;
        invocation.ui.setAgentMode('act');
        invocation.ui.showMessage('已返回默认执行模式。');
        invocation.ui.refreshStatus();
      },
    },
    {
      name: 'session', aliases: ['s', 'resume', 'r'], description: '查看或恢复历史会话',
      usage: '/session [会话 ID]', argumentHint: '[会话 ID]', type: 'ui',
      handler: ({ args, ui }) => ui.showOrResumeSession(args || undefined),
    },
    {
      name: 'memory', aliases: ['m'], description: '查看长期记忆状态', usage: '/memory',
      type: 'local', handler: invocation => {
        if (!noArguments(invocation)) return;
        invocation.ui.showMemoryStatus();
      },
    },
    {
      name: 'permission', aliases: ['permissions', 'perm'], description: '查看或切换权限模式',
      usage: '/permission [strict|default|allow]', argumentHint: '[模式]', type: 'ui',
      handler: invocation => {
        const mode = invocation.args.toLowerCase();
        if (!mode) {
          invocation.ui.showOrSetPermission();
        } else if (PERMISSION_MODES.has(mode as PermissionMode)) {
          invocation.ui.showOrSetPermission(mode as PermissionMode);
        } else {
          invocation.ui.showMessage(`用法: ${invocation.definition.usage}`);
        }
      },
    },
    {
      name: 'tasks', aliases: [], description: '查看当前会话的子 Agent 任务',
      usage: '/tasks [任务 ID]', argumentHint: '[任务 ID]', type: 'local',
      handler: ({ args, ui }) => ui.showSubAgentTasks(args || undefined),
    },
    {
      name: 'status', aliases: ['st'], description: '显示当前运行状态', usage: '/status',
      type: 'local', handler: invocation => {
        if (!noArguments(invocation)) return;
        invocation.ui.showStatus();
        invocation.ui.refreshStatus();
      },
    },
    {
      name: 'rewind', aliases: [], description: '回滚文件或对话检查点', usage: '/rewind',
      type: 'ui', hidden: true,
      handler: invocation => {
        if (!noArguments(invocation)) return;
        invocation.ui.rewindConversation();
      },
    },
    {
      name: 'exit', aliases: ['quit'], description: '退出 BetterCode', usage: '/exit',
      type: 'ui', hidden: true,
      handler: invocation => {
        if (!noArguments(invocation)) return;
        invocation.ui.exit();
      },
    },
  ];
}

export function createDefaultCommandRegistry(
  additional: readonly CommandDefinition[] = [],
): CommandRegistry {
  const registry = new CommandRegistry();
  for (const definition of [...definitions(), ...additional]) registry.register(definition);
  return registry;
}
