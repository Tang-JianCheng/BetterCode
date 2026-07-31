import type { WorktreeManager } from './manager.js';
import type { WorktreeMetadataStore } from './metadata-store.js';
import type { WorktreeRemovalResult } from './types.js';

export class WorktreeCleanupScheduler {
  private timer?: NodeJS.Timeout;
  private running?: Promise<readonly WorktreeRemovalResult[]>;
  private closed = false;

  constructor(
    private readonly manager: WorktreeManager,
    private readonly metadata: WorktreeMetadataStore,
    private readonly retentionMs: number,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer || this.closed) return;
    void this.runNow();
    this.timer = setInterval(() => void this.runNow(), this.intervalMs);
    this.timer.unref();
  }

  runNow(now = new Date()): Promise<readonly WorktreeRemovalResult[]> {
    if (this.running) return this.running;
    if (this.closed) return Promise.resolve([]);
    this.running = this.scan(now).finally(() => { this.running = undefined; });
    return this.running;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running?.catch(() => {});
  }

  private async scan(now: Date): Promise<readonly WorktreeRemovalResult[]> {
    const cutoff = now.getTime() - this.retentionMs;
    const results: WorktreeRemovalResult[] = [];
    for (const item of this.metadata.list().sort((left, right) => left.lastUsedAt.localeCompare(right.lastUsedAt))) {
      if (Date.parse(item.lastUsedAt) > cutoff || this.manager.activeLeaseCount(item.name) > 0) continue;
      try {
        results.push(await this.manager.remove(item.name));
      } catch (error) {
        // 单个损坏候选不会阻断其他 Worktree 清理。
        this.manager.reportCleanupFailure(item.name, error);
      }
    }
    return results;
  }
}
