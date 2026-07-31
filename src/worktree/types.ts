import type { WorktreeConfig } from '../config/types.js';

export const DEFAULT_WORKTREE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_WORKTREE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const MAX_WORKTREE_SCAN_ENTRIES = 1000;
export const MAX_WORKTREE_RULE_MATCHES = 1000;

export type WorktreeErrorCode =
  | 'INVALID_NAME'
  | 'NOT_GIT_REPOSITORY'
  | 'PATH_OUTSIDE_ROOT'
  | 'DIRECTORY_CONFLICT'
  | 'METADATA_MISMATCH'
  | 'GIT_CREATE_FAILED'
  | 'INITIALIZATION_FAILED'
  | 'ACTIVE_LEASE'
  | 'DIRTY_WORKTREE'
  | 'UNPUSHED_COMMITS'
  | 'GIT_STATE_UNKNOWN'
  | 'DELETE_FAILED'
  | 'CANCELLED';

export class WorktreeError extends Error {
  constructor(
    readonly code: WorktreeErrorCode,
    message: string,
    readonly details: Record<string, string | number | boolean> = {},
  ) {
    super(message);
    this.name = 'WorktreeError';
  }
}

export interface WorktreeRule {
  source: string;
  target?: string;
  required: boolean;
}

export interface ResolvedWorktreeOptions {
  retentionMs: number;
  cleanupIntervalMs: number;
  copyFiles: readonly WorktreeRule[];
  ignoredFiles: readonly WorktreeRule[];
  symlinks: readonly WorktreeRule[];
}

const BUILTIN_COPY: readonly WorktreeRule[] = [
  { source: '.env', required: false },
  { source: '.env.local', required: false },
  { source: '.env.*.local', required: false },
  { source: 'BETTERCODE.local.md', required: false },
  { source: '.bettercode/permissions.local.yaml', required: false },
  { source: '.bettercode/hooks.local.yaml', required: false },
];

export function resolveWorktreeOptions(config: WorktreeConfig = {}): ResolvedWorktreeOptions {
  const normalize = (rules: WorktreeConfig['copy_files'] = []): WorktreeRule[] => rules.map(rule => ({
    source: rule.source,
    ...(rule.target ? { target: rule.target } : {}),
    required: rule.required ?? false,
  }));
  return {
    retentionMs: (config.retention_days ?? 7) * 24 * 60 * 60 * 1000,
    cleanupIntervalMs: config.cleanup_interval_ms ?? DEFAULT_WORKTREE_CLEANUP_INTERVAL_MS,
    copyFiles: [...BUILTIN_COPY, ...normalize(config.copy_files)],
    ignoredFiles: normalize(config.ignored_files),
    symlinks: [{ source: 'node_modules', required: false }, ...normalize(config.symlinks)],
  };
}

export type WorktreeLifecycleState = 'creating' | 'ready' | 'deleting' | 'retained' | 'error';

export interface WorktreeMetadata {
  version: 1;
  name: string;
  repositoryId: string;
  mainRoot: string;
  worktreeRoot: string;
  gitDir: string;
  branch: string;
  baseCommit: string;
  state: WorktreeLifecycleState;
  createdAt: string;
  lastUsedAt: string;
  initializationComplete: boolean;
  lastError?: { code: WorktreeErrorCode; message: string };
}

export interface WorktreeInitializationDiagnostic {
  kind: 'copy' | 'ignored_file' | 'symlink' | 'git_hooks';
  source?: string;
  target?: string;
  required: boolean;
  message: string;
}

export interface WorktreeHandle {
  name: string;
  cwd: string;
  branch: string;
  baseCommit: string;
  recovered: boolean;
  diagnostics: readonly WorktreeInitializationDiagnostic[];
}

export interface WorktreeLease extends WorktreeHandle {
  leaseId: string;
}

export type WorktreeRemovalResult =
  | { status: 'deleted'; name: string; cwd: string; branch: string }
  | { status: 'retained'; name: string; cwd: string; branch: string; reasons: readonly string[] }
  | { status: 'missing'; name: string };

export interface GitRepositoryIdentity {
  mainRoot: string;
  commonGitDir: string;
  repositoryId: string;
}

export interface GitProtectionStatus {
  dirty: boolean;
  unpushed: boolean;
  hasNewCommits: boolean;
  upstream?: string;
  reasons: readonly string[];
}

export type WorktreeEvent =
  | { type: 'creating'; name: string; cwd: string; branch: string }
  | { type: 'created'; handle: WorktreeHandle }
  | { type: 'recovered'; handle: WorktreeHandle }
  | { type: 'entered'; name: string; leaseId: string; activeLeases: number }
  | { type: 'exited'; name: string; leaseId: string; activeLeases: number }
  | { type: 'retained'; result: Extract<WorktreeRemovalResult, { status: 'retained' }> }
  | { type: 'deleted'; result: Extract<WorktreeRemovalResult, { status: 'deleted' }> }
  | { type: 'cleanup_failed'; name: string; code: WorktreeErrorCode; message: string };
