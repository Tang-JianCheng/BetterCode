import { randomUUID } from 'node:crypto';
import { TeamError } from '../errors.js';
import type { BackendInstance, BackendProbeContext, SpawnMemberInput, TeamMemberBackend, TerminateResult } from './types.js';

export interface CoroutineMemberOperation {
  run(member: SpawnMemberInput['member'], signal: AbortSignal): Promise<void>;
  wake?(member: SpawnMemberInput['member']): Promise<void>;
}

export class CoroutineBackend implements TeamMemberBackend {
  readonly kind = 'coroutine' as const;
  readonly name = 'coroutine';
  private readonly controls = new Map<string, { member: SpawnMemberInput['member']; controller: AbortController; operation: Promise<void> }>();

  constructor(private readonly runner: CoroutineMemberOperation) {}

  probe(_context: BackendProbeContext) {
    return Promise.resolve({ available: true });
  }

  spawn(input: SpawnMemberInput): Promise<BackendInstance> {
    const id = `co-${randomUUID()}`;
    const controller = new AbortController();
    const operation = Promise.resolve().then(() => this.runner.run(input.member, controller.signal));
    operation.catch(() => {}).finally(() => this.controls.delete(id));
    this.controls.set(id, { member: input.member, controller, operation });
    return Promise.resolve({ kind: 'coroutine', id });
  }

  async wake(instance: BackendInstance): Promise<void> {
    const control = this.controls.get(instance.id);
    if (!control) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', '协程成员实例不存在');
    await this.runner.wake?.(control.member);
  }

  async terminate(instance: BackendInstance, signal: AbortSignal): Promise<TerminateResult> {
    const control = this.controls.get(instance.id);
    if (!control) return { stopped: true, forced: false, uncertain: false };
    control.controller.abort();
    const stopped = await Promise.race([
      control.operation.then(() => true, () => true),
      new Promise<boolean>(resolve => {
        const onAbort = () => resolve(false);
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
    return { stopped, forced: false, uncertain: !stopped };
  }
}
