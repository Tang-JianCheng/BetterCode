import path from 'node:path';
import { createToolError, type ToolResult } from '../tool/types.js';

const FORBIDDEN_SYNTAX = /[\0\r\n;&|><`$()]/u;
const SAFE_VALUE = /^(?!-)(?!.*\.\.)(?!.*@\{)[A-Za-z0-9][A-Za-z0-9._/:@~-]{0,255}$/u;

export interface CoordinatorShellContext {
  leadRoot: string;
  memberRoots: readonly string[];
  integrationRoot?: string;
}

export class CoordinatorShellPolicy {
  constructor(private readonly context: () => CoordinatorShellContext) {}

  authorize(command: string, defaultRoot: string): ToolResult | undefined {
    try {
      const args = parseArgv(command);
      if (args[0] !== 'git') throw new Error('Coordinator Shell 只允许 Git 只读命令');
      let index = 1;
      let cwd = path.resolve(defaultRoot);
      if (args[index] === '-C') {
        const requested = args[index + 1];
        if (!requested) throw new Error('git -C 缺少目录');
        cwd = path.resolve(defaultRoot, requested);
        index += 2;
      }
      const context = this.context();
      const roots = [context.leadRoot, ...context.memberRoots, ...(context.integrationRoot ? [context.integrationRoot] : [])]
        .map(root => path.resolve(root));
      if (!roots.some(root => within(root, cwd))) throw new Error('git -C 目录不属于当前团队工作区');
      const subcommand = args[index];
      const rest = args.slice(index + 1);
      if (!subcommand) throw new Error('缺少 Git 子命令');
      this.validate(subcommand, rest, cwd, context.integrationRoot);
      return undefined;
    } catch (error) {
      return createToolError('TEAM_STATE_ERROR', error instanceof Error ? error.message : String(error));
    }
  }

  private validate(subcommand: string, args: readonly string[], cwd: string, integrationRoot?: string): void {
    if (subcommand === 'merge') {
      if (path.resolve(cwd) !== path.resolve(integrationRoot ?? '') || args.length !== 1 ||
          (args[0] !== '--continue' && args[0] !== '--abort')) {
        throw new Error('git merge 只允许在活动集成目录执行 --continue 或 --abort');
      }
      return;
    }
    if (subcommand === 'status') return this.flagsOnly(args, /^(--short|--branch|--porcelain(?:=v1)?|--untracked-files=(?:all|normal|no))$/u);
    if (subcommand === 'diff') return this.diffArgs(args);
    if (subcommand === 'log') return this.logArgs(args);
    if (subcommand === 'show') return this.showArgs(args);
    if (subcommand === 'merge-base') return this.mergeBaseArgs(args);
    if (subcommand === 'branch') return this.flagsOnly(args, /^(--show-current|--list|-a|--all|-r|--remotes)$/u);
    if (subcommand === 'rev-parse') return this.revParseArgs(args);
    if (subcommand === 'worktree' && args.length >= 1 && args[0] === 'list') {
      return this.flagsOnly(args.slice(1), /^(--porcelain|-z)$/u);
    }
    throw new Error(`Coordinator Shell 不允许 Git 子命令: ${subcommand}`);
  }

  private flagsOnly(args: readonly string[], pattern: RegExp): void {
    if (args.some(value => !pattern.test(value))) throw new Error('Git 参数不在 Coordinator 白名单内');
  }

  private diffArgs(args: readonly string[]): void {
    let paths = false;
    for (const value of args) {
      if (value === '--') { paths = true; continue; }
      if (/^(--stat|--name-only|--name-status|--cached|--staged|--check)$/u.test(value)) continue;
      if (!paths && SAFE_VALUE.test(value)) continue;
      if (paths && safeRelativePath(value)) continue;
      throw new Error('git diff 参数不在 Coordinator 白名单内');
    }
  }

  private logArgs(args: readonly string[]): void {
    for (const value of args) {
      if (/^(--oneline|--decorate|--graph|--all|-[0-9]{1,4}|--max-count=[0-9]{1,4})$/u.test(value)) continue;
      if (SAFE_VALUE.test(value)) continue;
      throw new Error('git log 参数不在 Coordinator 白名单内');
    }
  }

  private showArgs(args: readonly string[]): void {
    if (args.length > 4) throw new Error('git show 参数过多');
    for (const value of args) {
      if (/^(--stat|--oneline|--name-only|--name-status)$/u.test(value) || SAFE_VALUE.test(value)) continue;
      throw new Error('git show 参数不在 Coordinator 白名单内');
    }
  }

  private revParseArgs(args: readonly string[]): void {
    if (args.length === 0 || args.length > 3) throw new Error('git rev-parse 参数数量无效');
    for (const value of args) {
      if (/^(--show-toplevel|--show-current|--is-inside-work-tree|--verify|HEAD)$/u.test(value) || SAFE_VALUE.test(value)) continue;
      throw new Error('git rev-parse 参数不在 Coordinator 白名单内');
    }
  }

  private mergeBaseArgs(args: readonly string[]): void {
    const refs = args[0] === '--is-ancestor' ? args.slice(1) : args;
    if (refs.length !== 2 || refs.some(value => !SAFE_VALUE.test(value))) {
      throw new Error('git merge-base 只允许比较两个安全引用');
    }
  }
}

function parseArgv(command: string): string[] {
  if (!command.trim()) throw new Error('命令不能为空');
  if (FORBIDDEN_SYNTAX.test(command)) throw new Error('Coordinator Shell 拒绝管道、重定向、替换、分号或控制字符');
  const args: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = undefined;
      else if (character === '\\' && quote === '"') current += command[++index] ?? '';
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (/\s/u.test(character)) {
      if (current) { args.push(current); current = ''; }
      continue;
    }
    if (character === '\\') current += command[++index] ?? '';
    else current += character;
  }
  if (quote) throw new Error('命令引号未闭合');
  if (current) args.push(current);
  return args;
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function safeRelativePath(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !path.isAbsolute(value) &&
    !value.split(/[\\/]/u).some(part => part === '..' || part === '') && !/[\0\r\n]/u.test(value);
}
