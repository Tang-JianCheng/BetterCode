export interface DangerousCommandPattern {
  category: string;
  description: string;
  pattern: RegExp;
}

export interface DangerousCommandMatch {
  category: string;
  description: string;
}

const COMMAND_PREFIX = String.raw`^(?:\s*sudo(?:\s+-[A-Za-z]+)*\s+)*(?:command\s+)?`;

export const DANGEROUS_COMMAND_PATTERNS: readonly DangerousCommandPattern[] = Object.freeze([
  {
    category: 'system_root_deletion',
    description: '禁止递归强制删除系统根目录',
    pattern: new RegExp(
      `${COMMAND_PREFIX}(?:/(?:usr/)?bin/)?rm\\b(?=[^\\n]*\\s(?:-[A-Za-z]*r[A-Za-z]*|--recursive)(?=\\s|$))` +
      `(?=[^\\n]*\\s(?:-[A-Za-z]*f[A-Za-z]*|--force)(?=\\s|$))` +
      `(?=[^\\n]*\\s/(?:\\*)?(?=\\s|$))`,
      'u',
    ),
  },
  {
    category: 'filesystem_format',
    description: '禁止格式化文件系统',
    pattern: new RegExp(
      `${COMMAND_PREFIX}(?:/(?:usr/)?sbin/)?(?:mkfs(?:\\.[A-Za-z0-9_-]+)?|newfs(?:_[A-Za-z0-9_-]+)?)\\b`,
      'u',
    ),
  },
  {
    category: 'raw_device_write',
    description: '禁止向裸磁盘设备写入数据',
    pattern: new RegExp(
      `${COMMAND_PREFIX}(?:/(?:usr/)?bin/)?dd\\b[^\\n]*\\bof=/dev/(?:disk|rdisk|sd|vd|xvd|nvme|mmcblk)[A-Za-z0-9._-]*\\b`,
      'u',
    ),
  },
  {
    category: 'system_shutdown',
    description: '禁止关闭或重启系统',
    pattern: new RegExp(
      `${COMMAND_PREFIX}(?:/(?:usr/)?sbin/)?(?:shutdown|reboot|poweroff|halt)\\b`,
      'u',
    ),
  },
  {
    category: 'fork_bomb',
    description: '禁止执行 Shell fork bomb',
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/u,
  },
]);

function commandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === ';' || character === '|' || character === '&' || character === '\n') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      while (command[index + 1] === character) index += 1;
      continue;
    }
    current += character;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

export function matchDangerousCommand(command: string): DangerousCommandMatch | undefined {
  for (const entry of DANGEROUS_COMMAND_PATTERNS) {
    const candidates = entry.category === 'fork_bomb' ? [command] : commandSegments(command);
    if (candidates.some(candidate => entry.pattern.test(candidate))) {
      return { category: entry.category, description: entry.description };
    }
  }
  return undefined;
}
