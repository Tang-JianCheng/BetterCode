import { TeamError } from '../errors.js';
import { TeamProcessRunner } from './process-runner.js';
import type { BackendInstance, BackendProbeContext, SpawnMemberInput, TeamMemberBackend, TerminateResult } from './types.js';
import { buildWorkerProcessArgs } from './worker-process.js';

const SESSION_PATTERN = /^[A-Za-z0-9-]{8,128}$/u;
const CREATE_SCRIPT = [
  'on run argv',
  'tell application "iTerm2"',
  'tell current session of current window',
  'set newSession to (split vertically with default profile command (item 1 of argv))',
  'return unique ID of newSession',
  'end tell',
  'end tell',
  'end run',
].join('\n');
const WRITE_SCRIPT = 'on run argv\ntell application "iTerm2" to tell session id (item 1 of argv) to write text ""\nend run';
const CLOSE_SCRIPT = 'on run argv\ntell application "iTerm2" to tell session id (item 1 of argv) to close\nend run';

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

export class ITerm2Backend implements TeamMemberBackend {
  readonly kind = 'iterm2' as const;
  readonly name = 'iterm2';

  constructor(private readonly runner: TeamProcessRunner) {}

  async probe(context: BackendProbeContext) {
    if (process.platform !== 'darwin' || context.environment.TERM_PROGRAM !== 'iTerm.app') {
      return { available: false, reason: '当前环境不是 macOS iTerm2' };
    }
    const result = await this.runner.run({ command: 'osascript', args: ['-e', 'return "ok"'], cwd: context.cwd });
    return result.exitCode === 0 ? { available: true } : { available: false, reason: 'iTerm2 自动化不可用' };
  }

  async spawn(input: SpawnMemberInput): Promise<BackendInstance> {
    const command = [process.execPath, ...buildWorkerProcessArgs(input.context.workerDescriptor)]
      .map(shellQuote).join(' ');
    const result = await this.runner.run({ command: 'osascript', args: ['-e', CREATE_SCRIPT, command], cwd: input.context.cwd });
    const paneId = result.stdout.trim();
    if (result.exitCode !== 0 || !SESSION_PATTERN.test(paneId)) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', 'iTerm2 创建窗格失败');
    return { kind: 'iterm2', id: paneId, paneId };
  }

  async wake(instance: BackendInstance): Promise<void> {
    if (!instance.paneId || !SESSION_PATTERN.test(instance.paneId)) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', 'iTerm2 session ID 无效');
    const result = await this.runner.run({ command: 'osascript', args: ['-e', WRITE_SCRIPT, instance.paneId], cwd: process.cwd() });
    if (result.exitCode !== 0) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', 'iTerm2 唤醒窗格失败');
  }

  async terminate(instance: BackendInstance, _signal: AbortSignal): Promise<TerminateResult> {
    if (!instance.paneId || !SESSION_PATTERN.test(instance.paneId)) return { stopped: false, forced: false, uncertain: true };
    const result = await this.runner.run({ command: 'osascript', args: ['-e', CLOSE_SCRIPT, instance.paneId], cwd: process.cwd() });
    return { stopped: result.exitCode === 0, forced: true, uncertain: result.exitCode !== 0 };
  }
}
