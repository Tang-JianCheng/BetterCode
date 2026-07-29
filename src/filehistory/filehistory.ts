import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { PathGuard } from '../tool/path-guard.js';

export const MAX_SNAPSHOTS = 100;

export interface Backup {
  backupPath: string;
  version: number;
  time: string;
  existed: boolean;
}

export interface Snapshot {
  messageIndex: number;
  userText: string;
  backups: Record<string, Backup>;
  timestamp: string;
}

interface FileHistoryState {
  versions: Record<string, number>;
  snapshots: Snapshot[];
}

export class FileHistory {
  private readonly pathGuard: PathGuard;
  private readonly sessionDir: string;
  private readonly stateFile: string;
  private readonly versions = new Map<string, number>();
  private snapshots: Snapshot[] = [];

  constructor(baseDir: string, sessionId: string) {
    this.pathGuard = new PathGuard(baseDir);
    this.sessionDir = path.join(this.pathGuard.rootDir, '.bettercode/file-history', sessionId);
    this.stateFile = path.join(this.sessionDir, 'snapshots.json');
    mkdirSync(this.sessionDir, { recursive: true, mode: 0o700 });
    this.loadState();
  }

  trackEdit(filePath: string): void {
    const target = this.pathGuard.resolveForWrite(filePath);
    const relative = target.relative.split(path.sep).join('/');
    let snapshot = this.snapshots.at(-1);
    if (!snapshot) {
      this.makeSnapshot(0, '自动快照');
      snapshot = this.snapshots.at(-1)!;
    }
    if (!snapshot.backups[relative]) {
      snapshot.backups[relative] = this.capture(relative, target.absolute);
      this.save();
    }
  }

  makeSnapshot(messageIndex: number, userText: string): void {
    const backups: Record<string, Backup> = {};
    for (const relative of this.versions.keys()) {
      const target = this.pathGuard.resolveForWrite(relative);
      backups[relative] = this.capture(relative, target.absolute);
    }
    this.snapshots.push({
      messageIndex,
      userText,
      backups,
      timestamp: new Date().toISOString(),
    });
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(-MAX_SNAPSHOTS);
    }
    this.save();
  }

  rewind(snapshotIndex: number): string[] {
    const snapshot = this.snapshots[snapshotIndex];
    if (!snapshot) throw new Error('文件快照不存在');
    const allPaths = new Set([
      ...this.versions.keys(),
      ...Object.keys(snapshot.backups),
    ]);
    const restored: string[] = [];
    for (const relative of allPaths) {
      const target = this.pathGuard.resolveForWrite(relative).absolute;
      const backup = snapshot.backups[relative];
      if (backup?.existed && existsSync(backup.backupPath)) {
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(backup.backupPath, target);
      } else {
        rmSync(target, { force: true });
      }
      restored.push(relative);
    }
    this.snapshots = this.snapshots.slice(0, snapshotIndex + 1);
    this.versions.clear();
    for (const [relative, backup] of Object.entries(snapshot.backups)) {
      this.versions.set(relative, backup.version);
    }
    this.save();
    return restored.sort();
  }

  getSnapshots(): Snapshot[] {
    return structuredClone(this.snapshots);
  }

  hasSnapshots(): boolean {
    return this.snapshots.length > 0;
  }

  save(): void {
    const state: FileHistoryState = {
      versions: Object.fromEntries(this.versions),
      snapshots: this.snapshots,
    };
    writeFileSync(this.stateFile, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  private capture(relative: string, absolute: string): Backup {
    const version = (this.versions.get(relative) ?? 0) + 1;
    this.versions.set(relative, version);
    const key = createHash('sha256').update(relative).digest('hex').slice(0, 16);
    const backupPath = path.join(this.sessionDir, `${key}@v${version}`);
    const existed = existsSync(absolute);
    if (existed) copyFileSync(absolute, backupPath);
    else rmSync(backupPath, { force: true });
    return { backupPath, version, time: new Date().toISOString(), existed };
  }

  private loadState(): void {
    if (!existsSync(this.stateFile)) return;
    try {
      const state = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Partial<FileHistoryState>;
      for (const [file, version] of Object.entries(state.versions ?? {})) {
        if (Number.isInteger(version) && version > 0) this.versions.set(file, version);
      }
      if (Array.isArray(state.snapshots)) this.snapshots = state.snapshots.slice(-MAX_SNAPSHOTS);
    } catch {
      this.versions.clear();
      this.snapshots = [];
    }
  }
}
