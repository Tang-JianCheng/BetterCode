import type { TeamCustomTerminalConfig, TeamProcessTemplateConfig } from '../../config/types.js';
import { TeamError } from '../errors.js';
import { TeamProcessRunner } from './process-runner.js';
import type { BackendInstance, BackendProbeContext, SpawnMemberInput, TeamMemberBackend, TerminateResult } from './types.js';

const ID_PATTERN = /^[A-Za-z0-9_.:%-]{1,128}$/u;

function render(template: TeamProcessTemplateConfig, values: Record<string, string>): { command: string; args: string[] } {
  const replace = (value: string) => value.replace(/\{([^{}]+)\}/gu, (_match, name: string) => {
    if (!(name in values)) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', `终端模板缺少占位符值: ${name}`);
    return values[name];
  });
  return { command: template.command, args: (template.args ?? []).map(replace) };
}

export class ConfiguredTerminalBackend implements TeamMemberBackend {
  readonly kind = 'custom' as const;
  readonly name: string;

  constructor(
    private readonly config: TeamCustomTerminalConfig,
    private readonly runner: TeamProcessRunner,
  ) {
    this.name = config.name;
  }

  async probe(context: BackendProbeContext) {
    const command = render(this.config.detect, { worker_descriptor: context.workerDescriptor, cwd: context.cwd, pane_id: '' });
    const result = await this.runner.run({ ...command, cwd: context.cwd, environment: context.environment });
    return result.exitCode === 0 ? { available: true } : { available: false, reason: result.stderr.trim() || '自定义终端探测失败' };
  }

  async spawn(input: SpawnMemberInput): Promise<BackendInstance> {
    const command = render(this.config.spawn, { worker_descriptor: input.context.workerDescriptor, cwd: input.context.cwd, pane_id: '' });
    const result = await this.runner.run({ ...command, cwd: input.context.cwd, environment: input.context.environment });
    const paneId = result.stdout.trim();
    if (result.exitCode !== 0 || !ID_PATTERN.test(paneId)) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', '自定义终端创建窗格失败');
    return { kind: 'custom', id: paneId, paneId, backendName: this.name };
  }

  async wake(instance: BackendInstance): Promise<void> {
    if (!instance.paneId || !ID_PATTERN.test(instance.paneId)) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', '自定义终端 pane ID 无效');
    const command = render(this.config.wake, { worker_descriptor: '', cwd: process.cwd(), pane_id: instance.paneId });
    const result = await this.runner.run({ ...command, cwd: process.cwd() });
    if (result.exitCode !== 0) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', '自定义终端唤醒失败');
  }

  async terminate(instance: BackendInstance, _signal: AbortSignal): Promise<TerminateResult> {
    if (!this.config.terminate || !instance.paneId || !ID_PATTERN.test(instance.paneId)) {
      return { stopped: false, forced: false, uncertain: true, message: '适配器未配置终止命令' };
    }
    const command = render(this.config.terminate, { worker_descriptor: '', cwd: process.cwd(), pane_id: instance.paneId });
    const result = await this.runner.run({ ...command, cwd: process.cwd() });
    return { stopped: result.exitCode === 0, forced: true, uncertain: result.exitCode !== 0 };
  }
}
