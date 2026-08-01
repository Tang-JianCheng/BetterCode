import type { TeamConfig, TeamCustomTerminalConfig } from '../config/types.js';
import type { Message, TokenUsage } from '../provider/types.js';
import type { TeamDiagnostic } from './errors.js';

export const TEAM_TOOL_NAMES = Object.freeze([
  'team_status',
  'team_member',
  'team_task',
  'team_message',
  'team_approval',
  'team_integrate',
] as const);

export type TeamToolName = typeof TEAM_TOOL_NAMES[number];
export type TeamState = 'active' | 'archiving' | 'archived';
export type TeamBackendKind = 'tmux' | 'wezterm' | 'iterm2' | 'custom' | 'coroutine';
export type TeamMemberState =
  | 'creating'
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'interrupted'
  | 'stopping'
  | 'terminated'
  | 'failed';
export type TeamTaskState =
  | 'pending'
  | 'blocked'
  | 'ready'
  | 'waiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type TeamApprovalState = 'pending' | 'approved' | 'rejected' | 'superseded' | 'cancelled';
export type TeamIntegrationState =
  | 'preparing'
  | 'merging'
  | 'conflicted'
  | 'validating'
  | 'ready'
  | 'completed'
  | 'aborted'
  | 'failed';

export interface TeamRecord {
  version: 1;
  revision: number;
  name: string;
  repositoryId: string;
  projectRoot: string;
  lead: string;
  state: TeamState;
  generation: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface TeamIndexRecord {
  version: 1;
  revision: number;
  teams: Record<string, { state: TeamState; projectRoot: string; updatedAt: string }>;
  activeBySession: Record<string, string>;
}

export interface TeamMemberRecord {
  version: 1;
  revision: number;
  name: string;
  role: string;
  roleRevision: number;
  state: TeamMemberState;
  backend: TeamBackendKind;
  backendName?: string;
  backendInstanceId?: string;
  requiresApproval: boolean;
  rootDir: string;
  worktreeName?: string;
  worktreeBranch?: string;
  currentTaskId?: string;
  contextPath: string;
  generation: number;
  usage: TokenUsage;
  createdAt: string;
  lastActiveAt: string;
  lastError?: TeamDiagnostic;
}

export interface TeamTaskTransition {
  from?: TeamTaskState;
  to: TeamTaskState;
  actor: string;
  reason: string;
  timestamp: string;
}

export interface TeamTaskRecord {
  id: string;
  title: string;
  description: string;
  state: TeamTaskState;
  assignee?: string;
  dependencies: readonly string[];
  createdBy: string;
  resultSummary?: string;
  branch?: string;
  commit?: string;
  integrationId?: string;
  createdAt: string;
  updatedAt: string;
  history: readonly TeamTaskTransition[];
}

export interface TeamTaskCollection {
  version: 1;
  revision: number;
  nextId: number;
  tasks: Record<string, TeamTaskRecord>;
}

export type TeamMessageType =
  | 'text'
  | 'task_notification'
  | 'status_notification'
  | 'approval_request'
  | 'approval_response'
  | 'member_idle'
  | 'member_interrupted'
  | 'system_notification';

export interface TeamMessage {
  id: string;
  type: TeamMessageType;
  sender: string;
  recipient: string;
  body: string;
  summary: string;
  timestamp: string;
  read: boolean;
  taskId?: string;
  approvalId?: string;
  planVersion?: number;
  decision?: 'approve' | 'reject';
  wake?: boolean;
}

export interface TeamApprovalRecord {
  id: string;
  taskId: string;
  member: string;
  planVersion: number;
  plan: string;
  expectedOperations: readonly string[];
  state: TeamApprovalState;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  comment?: string;
}

export interface TeamApprovalCollection {
  version: 1;
  revision: number;
  approvals: Record<string, TeamApprovalRecord>;
}

export interface MemberContextSnapshot {
  version: 1;
  revision: number;
  team: string;
  member: string;
  generation: number;
  roleRevision: number;
  systemPromptHash: string;
  messages: readonly Message[];
  usage: TokenUsage;
  mailboxCursor?: string;
  currentTaskId?: string;
  lastSafeIteration: number;
  uncertainOperationIds: readonly string[];
  updatedAt: string;
}

export interface TeamIntegrationValidationResult {
  command: string;
  ok: boolean;
  exitCode: number | null;
  output: string;
}

export interface TeamIntegrationRecord {
  version: 1;
  revision: number;
  id: string;
  team: string;
  leadBranch: string;
  leadHead: string;
  worktreeName: string;
  worktreeRoot: string;
  branch: string;
  orderedTaskIds: readonly string[];
  mergedTaskIds: readonly string[];
  currentTaskId?: string;
  state: TeamIntegrationState;
  conflictFiles: readonly string[];
  validationResults: readonly TeamIntegrationValidationResult[];
  createdAt: string;
  updatedAt: string;
}

export interface MemberRuntimeLease {
  version: 1;
  team: string;
  member: string;
  generation: number;
  instanceId: string;
  pid: number;
  backend: TeamBackendKind;
  paneId?: string;
  heartbeatAt: string;
}

export type TeamActor =
  | { kind: 'lead'; team: string; sessionId: string; generation: number }
  | { kind: 'member'; team: string; member: string; generation: number };

export type LeadActor = Extract<TeamActor, { kind: 'lead' }>;
export type MemberActor = Extract<TeamActor, { kind: 'member' }>;

export interface TeamSnapshot {
  team: TeamRecord;
  members: readonly TeamMemberRecord[];
  diagnostics: readonly TeamDiagnostic[];
}

export interface ResolvedTeamOptions {
  coordinator: {
    configEnabled: boolean;
    environmentEnabled: boolean;
    active: boolean;
    missingLocks: readonly ('config' | 'environment')[];
  };
  mailbox: {
    lockTimeoutMs: number;
    retryIntervalMs: number;
    staleLockMs: number;
  };
  runtime: {
    heartbeatIntervalMs: number;
    heartbeatTimeoutMs: number;
    stopTimeoutMs: number;
    inboxPollIntervalMs: number;
  };
  integration: {
    timeoutMs: number;
    validationCommands: readonly string[];
  };
  customTerminals: readonly TeamCustomTerminalConfig[];
}

export function resolveTeamOptions(
  config: TeamConfig = {},
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedTeamOptions {
  const configEnabled = config.coordinator?.enabled ?? false;
  const environmentEnabled = environment.BETTERCODE_COORDINATOR_MODE === '1';
  return {
    coordinator: {
      configEnabled,
      environmentEnabled,
      active: configEnabled && environmentEnabled,
      missingLocks: [
        ...(!configEnabled ? ['config' as const] : []),
        ...(!environmentEnabled ? ['environment' as const] : []),
      ],
    },
    mailbox: {
      lockTimeoutMs: config.mailbox?.lock_timeout_ms ?? 5_000,
      retryIntervalMs: config.mailbox?.retry_interval_ms ?? 50,
      staleLockMs: config.mailbox?.stale_lock_ms ?? 30_000,
    },
    runtime: {
      heartbeatIntervalMs: config.runtime?.heartbeat_interval_ms ?? 2_000,
      heartbeatTimeoutMs: config.runtime?.heartbeat_timeout_ms ?? 10_000,
      stopTimeoutMs: config.runtime?.stop_timeout_ms ?? 10_000,
      inboxPollIntervalMs: config.runtime?.inbox_poll_interval_ms ?? 2_000,
    },
    integration: {
      timeoutMs: config.integration?.timeout_ms ?? 300_000,
      validationCommands: [...(config.integration?.validation_commands ?? [])],
    },
    customTerminals: [...(config.custom_terminals ?? [])],
  };
}
