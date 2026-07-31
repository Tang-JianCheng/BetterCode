import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_WORKTREE_SCAN_ENTRIES, type WorktreeMetadata, WorktreeError } from './types.js';
import type { WorktreePathGuard } from './path-guard.js';

function parseMetadata(raw: string, expectedName: string): WorktreeMetadata {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new WorktreeError('METADATA_MISMATCH', `Worktree 元数据不是合法 JSON: ${expectedName}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorktreeError('METADATA_MISMATCH', `Worktree 元数据格式无效: ${expectedName}`);
  }
  const item = value as Record<string, unknown>;
  const strings = ['name', 'repositoryId', 'mainRoot', 'worktreeRoot', 'gitDir', 'branch', 'baseCommit', 'state', 'createdAt', 'lastUsedAt'];
  const states = new Set(['creating', 'ready', 'deleting', 'retained', 'error']);
  if (item.version !== 1 || typeof item.initializationComplete !== 'boolean' ||
      strings.some(key => typeof item[key] !== 'string' || !(item[key] as string).trim()) ||
      item.name !== expectedName || !states.has(String(item.state)) ||
      Number.isNaN(Date.parse(String(item.createdAt))) || Number.isNaN(Date.parse(String(item.lastUsedAt)))) {
    throw new WorktreeError('METADATA_MISMATCH', `Worktree 元数据字段无效: ${expectedName}`);
  }
  return item as unknown as WorktreeMetadata;
}

export class WorktreeMetadataStore {
  constructor(private readonly guard: WorktreePathGuard) {}

  read(name: string): WorktreeMetadata | undefined {
    const location = this.guard.location(name);
    try {
      return parseMetadata(readFileSync(location.metadataPath, 'utf8'), name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  write(metadata: WorktreeMetadata): void {
    const location = this.guard.location(metadata.name);
    if (path.resolve(metadata.mainRoot) !== this.guard.mainRoot ||
        path.resolve(metadata.worktreeRoot) !== location.rootDir || metadata.branch !== location.branch) {
      throw new WorktreeError('METADATA_MISMATCH', `Worktree 元数据路径或分支不一致: ${metadata.name}`);
    }
    mkdirSync(path.dirname(location.metadataPath), { recursive: true, mode: 0o700 });
    const temporary = `${location.metadataPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, location.metadataPath);
  }

  remove(name: string): void {
    const location = this.guard.location(name);
    rmSync(location.metadataPath, { force: true });
    let current = path.dirname(location.metadataPath);
    while (current !== this.guard.metadataRoot) {
      try {
        rmSync(current);
      } catch {
        break;
      }
      current = path.dirname(current);
    }
  }

  list(limit = MAX_WORKTREE_SCAN_ENTRIES): WorktreeMetadata[] {
    const files: string[] = [];
    const visit = (directory: string): void => {
      if (files.length >= limit) return;
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= limit) break;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(target);
        else if (entry.isFile() && entry.name.endsWith('.json')) files.push(target);
      }
    };
    visit(this.guard.metadataRoot);
    return files.flatMap(file => {
      const relative = path.relative(this.guard.metadataRoot, file).replaceAll(path.sep, '/').replace(/\.json$/u, '');
      try {
        const metadata = this.read(relative);
        return metadata ? [metadata] : [];
      } catch {
        return [];
      }
    });
  }
}
