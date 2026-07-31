import type { AgentMode, AgentProgressStage, AgentStopReason } from '../agent/types.js';
import type { AgentModelAliases, AgentModelTier } from '../config/types.js';
import type { PermissionMode } from '../permission/types.js';
import type { LLMProvider, Message, ProviderRequest, TokenUsage } from '../provider/types.js';
import type { ToolCall, ToolDefinition, ToolResult } from '../tool/types.js';

export const AGENT_TOOL_NAME = 'agent';
export const IMMUTABLE_SUBAGENT_DENIED_TOOLS = Object.freeze([
  AGENT_TOOL_NAME,
  'load_skill',
]);

export const DEFAULT_SUBAGENT_FOREGROUND_TIMEOUT_MS = 120_000;
export const DEFAULT_SUBAGENT_FORK_MAX_ITERATIONS = 10;
export const DEFAULT_SUBAGENT_RETAINED_TASKS = 100;

export interface ResolvedSubAgentOptions {
  foregroundTimeoutMs: number;
  forkMaxIterations: number;
  retainedTasks: number;
  deniedTools: ReadonlySet<string>;
}

export function resolveSubAgentOptions(input: {
  foreground_timeout_ms?: number;
  fork_max_iterations?: number;
  retained_tasks?: number;
  denied_tools?: readonly string[];
} = {}): ResolvedSubAgentOptions {
  return {
    foregroundTimeoutMs: input.foreground_timeout_ms ?? DEFAULT_SUBAGENT_FOREGROUND_TIMEOUT_MS,
    forkMaxIterations: input.fork_max_iterations ?? DEFAULT_SUBAGENT_FORK_MAX_ITERATIONS,
    retainedTasks: input.retained_tasks ?? DEFAULT_SUBAGENT_RETAINED_TASKS,
    deniedTools: new Set([
      ...IMMUTABLE_SUBAGENT_DENIED_TOOLS,
      ...(input.denied_tools ?? []),
    ]),
  };
}

export type AgentDefinitionScope = 'plugin' | 'builtin' | 'user' | 'project';
export type AgentDefinitionModel = 'inherit' | AgentModelTier;
export type AgentIsolation = 'none' | 'worktree';

export interface AgentDefinitionMetadata {
  name: string;
  description: string;
  tools?: readonly string[];
  disallowedTools: readonly string[];
  backgroundTools: readonly string[];
  model: AgentDefinitionModel;
  maxIterations: number;
  permissionMode: PermissionMode;
  isolation: AgentIsolation;
}

export interface AgentDefinition extends AgentDefinitionMetadata {
  scope: AgentDefinitionScope;
  entryPath: string;
  body: string;
}

export type AgentDefinitionDiagnosticCode =
  | 'INVALID_DEFINITION'
  | 'DUPLICATE_DEFINITION'
  | 'UNKNOWN_TOOL'
  | 'FORBIDDEN_TOOL'
  | 'UNKNOWN_MODEL_ALIAS';

export interface AgentDefinitionDiagnostic {
  scope: AgentDefinitionScope;
  file: string;
  name?: string;
  code: AgentDefinitionDiagnosticCode;
  message: string;
}

export interface LoadedAgentDefinitions {
  definitions: Map<string, AgentDefinition>;
  disabledNames: Set<string>;
  diagnostics: AgentDefinitionDiagnostic[];
}

export interface AgentDefinitionSnapshot {
  revision: number;
  definitions: ReadonlyMap<string, AgentDefinition>;
  disabledNames: ReadonlySet<string>;
  diagnostics: readonly AgentDefinitionDiagnostic[];
}

export type AgentToolInput =
  | { type: 'defined'; task: string; role: string; background?: boolean }
  | { type: 'fork'; task: string };

export type SubAgentKind = 'defined' | 'fork';
export type SubAgentTaskState = 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SubAgentExecutionMode = 'foreground' | 'background';
export type SubAgentBackgroundReason = 'explicit' | 'timeout' | 'manual' | 'fork' | 'hook';

export interface SubAgentWorktreeState {
  isolation: 'worktree';
  name: string;
  path?: string;
  branch?: string;
  baseCommit?: string;
  state: 'preparing' | 'active' | 'deleted' | 'retained' | 'failed';
  reasons?: readonly string[];
}

export interface SubAgentTaskRecord {
  id: string;
  kind: SubAgentKind;
  role?: string;
  task: string;
  origin: 'tool' | 'hook';
  sessionId: string;
  parentTurnId?: string;
  executionMode: SubAgentExecutionMode;
  backgroundReason?: SubAgentBackgroundReason;
  state: SubAgentTaskState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  stopReason?: AgentStopReason;
  iterations: number;
  usage: TokenUsage;
  result?: string;
  error?: { code: string; message: string };
  worktree?: SubAgentWorktreeState;
}

export type SubAgentTaskSnapshot = Readonly<SubAgentTaskRecord>;

export type SubAgentEvent =
  | { type: 'task_created'; task: SubAgentTaskSnapshot }
  | { type: 'task_started'; task: SubAgentTaskSnapshot }
  | {
      type: 'task_progress';
      taskId: string;
      iteration: number;
      stage: AgentProgressStage;
      toolName?: string;
    }
  | { type: 'task_tool_call'; taskId: string; iteration: number; call: ToolCall }
  | { type: 'task_tool_result'; taskId: string; iteration: number; call: ToolCall; result: ToolResult }
  | { type: 'task_usage'; taskId: string; usage: TokenUsage }
  | { type: 'task_worktree'; taskId: string; worktree: SubAgentWorktreeState }
  | {
      type: 'task_backgrounded';
      task: SubAgentTaskSnapshot;
      reason: SubAgentBackgroundReason;
    }
  | { type: 'task_finished'; task: SubAgentTaskSnapshot };

export interface SubAgentResultEntry {
  id: number;
  taskId: string;
  sessionId: string;
  content: string;
  createdAt: string;
}

export interface PreparedSubAgentResultBatch {
  throughId: number;
  entries: readonly SubAgentResultEntry[];
  messages: readonly Extract<Message, { role: 'instruction' }>[];
}

export interface AgentInstructionRuntime {
  prepare(): PreparedSubAgentResultBatch | undefined;
  commit(throughId: number): readonly SubAgentResultEntry[];
}

export interface DefinedAgentRunSpec {
  kind: 'defined';
  definition: AgentDefinition;
  provider: LLMProvider;
  task: string;
  mode: AgentMode;
  foregroundTools: ReadonlySet<string>;
  backgroundTools: ReadonlySet<string>;
  isBackground(): boolean;
}

export interface ForkAgentRunSpec {
  kind: 'fork';
  provider: LLMProvider;
  task: string;
  mode: AgentMode;
  parentRequest: Readonly<ProviderRequest>;
  toolDefinitions: readonly ToolDefinition[];
  maxIterations: number;
  permissionMode: PermissionMode;
}

export type SubAgentRunSpec = DefinedAgentRunSpec | ForkAgentRunSpec;

export interface SubAgentRunContext {
  taskId: string;
  sessionId: string;
  parentTurnId?: string;
  trackToolEdit?: (call: ToolCall) => void;
  updateWorktree?: (worktree: SubAgentWorktreeState) => void;
}

export interface HookAgentRunInput {
  role?: string;
  prompt: string;
  background: boolean;
  sessionId: string;
  mode: AgentMode;
  signal: AbortSignal;
}

export type HookAgentRunResult =
  | { status: 'completed'; output: string }
  | { status: 'backgrounded'; taskId: string }
  | { status: 'failed'; code: string; message: string };

export interface HookAgentRunner {
  runHookAgent(input: HookAgentRunInput): Promise<HookAgentRunResult>;
}

export interface AgentProviderResolver {
  has(name: string): boolean;
  resolve(name: string): LLMProvider;
}

export interface AgentDefinitionManagerConfig {
  modelAliases: AgentModelAliases;
  providerNames: readonly string[];
}
