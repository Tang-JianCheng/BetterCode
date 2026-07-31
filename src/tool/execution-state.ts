export interface CachedFileRead {
  absolutePath: string;
  size: number;
  mtimeMs: number;
  content: string;
}

function normalizeAbsolutePath(absolutePath: string): string {
  return absolutePath.replaceAll('\\', '/');
}

export class ToolExecutionState {
  private readonly fileReads = new Map<string, CachedFileRead>();

  getFileRead(absolutePath: string, size: number, mtimeMs: number): string | undefined {
    const key = normalizeAbsolutePath(absolutePath);
    const entry = this.fileReads.get(key);
    if (!entry) return undefined;
    if (entry.size !== size || entry.mtimeMs !== mtimeMs) {
      this.fileReads.delete(key);
      return undefined;
    }
    return entry.content;
  }

  setFileRead(entry: CachedFileRead): void {
    const absolutePath = normalizeAbsolutePath(entry.absolutePath);
    this.fileReads.set(absolutePath, { ...entry, absolutePath });
  }

  invalidateFile(absolutePath: string): void {
    this.fileReads.delete(normalizeAbsolutePath(absolutePath));
  }

  invalidateAllFiles(): void {
    this.fileReads.clear();
  }

  clear(): void {
    this.fileReads.clear();
  }
}
