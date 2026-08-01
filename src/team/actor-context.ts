import { AsyncLocalStorage } from 'node:async_hooks';
import type { TeamActor } from './types.js';

export class TeamActorContext {
  private readonly storage = new AsyncLocalStorage<TeamActor>();

  current(): TeamActor | undefined {
    return this.storage.getStore();
  }

  run<T>(actor: TeamActor, operation: () => Promise<T>): Promise<T> {
    return this.storage.run(actor, operation);
  }
}
