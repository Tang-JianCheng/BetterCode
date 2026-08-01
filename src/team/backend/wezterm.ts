import { TeamError } from '../errors.js';
import { TeamProcessRunner } from './process-runner.js';
import type { BackendInstance, BackendProbeContext, SpawnMemberInput, TeamMemberBackend, TerminateResult } from './types.js';
import { buildWorkerProcessArgs } from './worker-process.js';

const PANE_PATTERN = /^\d+$/u;

export class WezTermBackend implements TeamMemberBackend {
  readonly kind = 'wezterm' as const;
  readonly name = 'wezterm';

  constructor(private readonly runner: TeamProcessRunner) {}

  async probe(context: BackendProbeContext) {
    if (context.environment.TERM_PROGRAM !== 'WezTerm') return { available: false, reason: '当前终端不是 WezTerm' };
    const result = await this.runner.run({ command: 'wezterm', args: ['cli', 'list', '--format', 'json'], cwd: context.cwd, environment: context.environment });
    return result.exitCode === 0 ? { available: true } : { available: false, reason: result.stderr.trim() || 'WezTerm CLI 不可用' };
  }

  async spawn(input: SpawnMemberInput): Promise<BackendInstance> {
    const result = await this.runner.run({
      command: 'wezterm',
      args: ['cli', 'split-pane', '--cwd', input.context.cwd, '--',
        process.execPath, ...buildWorkerProcessArgs(input.context.workerDescriptor)],
      cwd: input.context.cwd,
      environment: input.context.environment,
    });
    const paneId = result.stdout.trim();
    if (result.exitCode !== 0 || !PANE_PATTERN.test(paneId)) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', 'WezTerm 创建窗格失败');
    return { kind: 'wezterm', id: paneId, paneId };
  }

  async wake(instance: BackendInstance): Promise<void> {
    if (!instance.paneId || !PANE_PATTERN.test(instance.paneId)) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', 'WezTerm pane ID 无效');
    const result = await this.runner.run({ command: 'wezterm', args: ['cli', 'send-text', '--pane-id', instance.paneId, '--no-paste', '\r'], cwd: process.cwd() });
    if (result.exitCode !== 0) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', 'WezTerm 唤醒窗格失败');
  }

  async terminate(instance: BackendInstance, _signal: AbortSignal): Promise<TerminateResult> {
    if (!instance.paneId || !PANE_PATTERN.test(instance.paneId)) return { stopped: false, forced: false, uncertain: true };
    const result = await this.runner.run({ command: 'wezterm', args: ['cli', 'kill-pane', '--pane-id', instance.paneId], cwd: process.cwd() });
    return { stopped: result.exitCode === 0, forced: true, uncertain: result.exitCode !== 0 };
  }
}
