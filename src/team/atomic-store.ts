import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TeamError } from './errors.js';

export interface RevisionedRecord {
  version: number;
  revision: number;
}

export type RecordValidator<T> = (value: unknown) => value is T;

export class AtomicJsonStore<T extends RevisionedRecord> {
  constructor(
    readonly file: string,
    private readonly validate: RecordValidator<T>,
  ) {}

  read(): T | undefined {
    if (!existsSync(this.file)) return undefined;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!this.validate(parsed)) throw new Error('字段或版本不合法');
      return structuredClone(parsed);
    } catch (error) {
      throw new TeamError(
        'TEAM_DATA_CORRUPT',
        `团队数据损坏: ${path.basename(this.file)} - ${error instanceof Error ? error.message : String(error)}`,
        { file: this.file },
      );
    }
  }

  write(value: T, expectedRevision: number): T {
    const current = this.read();
    const actualRevision = current?.revision ?? 0;
    if (actualRevision !== expectedRevision) {
      throw new TeamError(
        'TEAM_CONFLICT',
        `团队数据 revision 冲突: 期望 ${expectedRevision}，实际 ${actualRevision}`,
        { file: this.file, expectedRevision, actualRevision },
      );
    }
    const next = { ...structuredClone(value), revision: expectedRevision + 1 } as T;
    if (!this.validate(next)) {
      throw new TeamError('TEAM_DATA_CORRUPT', `拒绝写入无效团队数据: ${path.basename(this.file)}`);
    }
    this.atomicWrite(next);
    return structuredClone(next);
  }

  private atomicWrite(value: T): void {
    const directory = path.dirname(this.file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const temporary = path.join(directory, `.${path.basename(this.file)}.${process.pid}.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      chmodSync(temporary, 0o600);
      descriptor = openSync(temporary, 'r');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, this.file);
      const directoryDescriptor = openSync(directory, 'r');
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporary, { force: true });
    }
  }
}

export function isRevisionedRecord(value: unknown): value is RevisionedRecord {
  return typeof value === 'object' && value !== null &&
    Number.isInteger((value as RevisionedRecord).version) &&
    Number.isInteger((value as RevisionedRecord).revision) &&
    (value as RevisionedRecord).revision >= 0;
}
