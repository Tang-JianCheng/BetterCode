import { TeamError } from '../errors.js';
import { TeamProcessRunner } from './process-runner.js';
import type { BackendInstance, BackendProbeContext, SpawnMemberInput, TeamMemberBackend, TerminateResult } from './types.js';
import { buildWorkerProcessArgs } from './worker-process.js';

const PANE_PATTERN = /^%\d+$/u;

export class TmuxBackend implements TeamMemberBackend {
  readonly kind = 'tmux' as const;
  readonly name = 'tmux';

  constructor(private readonly runner: TeamProcessRunner) {}

  async probe(context: BackendProbeContext) {
    if (!context.environment.TMUX) return { available: false, reason: '当前进程不在 tmux 会话中' };
    const result = await this.runner.run({ command: 'tmux', args: ['display-message', '-p', '#{pane_id}'], cwd: context.cwd, environment: context.environment });
    return result.exitCode === 0
      ? { available: true }
      : { available: false, reason: result.stderr.trim() || 'tmux 探测失败' };
  }

  async spawn(input: SpawnMemberInput): Promise<BackendInstance> {
    const result = await this.runner.run({
      command: 'tmux',
      args: ['split-window', '-P', '-F', '#{pane_id}', '-c', input.context.cwd, '--',
        process.execPath, ...buildWorkerProcessArgs(input.context.workerDescriptor)],
      cwd: input.context.cwd,
      environment: input.context.environment,
    });
    const paneId = result.stdout.trim();
    if (result.exitCode !== 0 || !PANE_PATTERN.test(paneId)) {
      throw new TeamError('TEAM_BACKEND_UNAVAILABLE', `tmux 创建窗格失败: ${result.stderr.trim() || 'pane ID 无效'}`);
    }
    return { kind: 'tmux', id: paneId, paneId };
  }

  async wake(instance: BackendInstance): Promise<void> {
    if (!instance.paneId || !PANE_PATTERN.test(instance.paneId)) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', 'tmux pane ID 无效');
    const result = await this.runner.run({ command: 'tmux', args: ['send-keys', '-t', instance.paneId, 'Enter'], cwd: process.cwd() });
    if (result.exitCode !== 0) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', 'tmux 唤醒窗格失败');
  }

  async terminate(instance: BackendInstance, _signal: AbortSignal): Promise<TerminateResult> {
    if (!instance.paneId || !PANE_PATTERN.test(instance.paneId)) return { stopped: false, forced: false, uncertain: true };
    const result = await this.runner.run({ command: 'tmux', args: ['kill-pane', '-t', instance.paneId], cwd: process.cwd() });
    return { stopped: result.exitCode === 0, forced: true, uncertain: result.exitCode !== 0 };
  }
}
