export interface CachedFileRead {
  relativePath: string;
  size: number;
  mtimeMs: number;
  content: string;
}

function normalizeRelativePath(relativePath: string): string {
  const parts: string[] = [];
  for (const part of relativePath.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

export class ToolExecutionState {
  private readonly fileReads = new Map<string, CachedFileRead>();

  getFileRead(relativePath: string, size: number, mtimeMs: number): string | undefined {
    const key = normalizeRelativePath(relativePath);
    const entry = this.fileReads.get(key);
    if (!entry) return undefined;
    if (entry.size !== size || entry.mtimeMs !== mtimeMs) {
      this.fileReads.delete(key);
      return undefined;
    }
    return entry.content;
  }

  setFileRead(entry: CachedFileRead): void {
    const relativePath = normalizeRelativePath(entry.relativePath);
    this.fileReads.set(relativePath, { ...entry, relativePath });
  }

  invalidateFile(relativePath: string): void {
    this.fileReads.delete(normalizeRelativePath(relativePath));
  }

  invalidateAllFiles(): void {
    this.fileReads.clear();
  }

  clear(): void {
    this.fileReads.clear();
  }
}
