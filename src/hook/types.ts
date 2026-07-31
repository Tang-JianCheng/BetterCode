import type { AgentMode, AgentStopReason } from '../agent/types.js';
import type { JsonObject, ToolCall, ToolResult } from '../tool/types.js';
import type { SubAgentKind } from '../subagent/types.js';

export type HookEventName =
  | 'system_start'
  | 'system_stop'
  | 'session_start'
  | 'session_end'
  | 'turn_start'
  | 'turn_end'
  | 'user_message'
  | 'assistant_message'
  | 'pre_tool_use'
  | 'post_tool_use';

export type HookLayer = 'user' | 'project' | 'local';
export type HookActionType = 'command' | 'prompt' | 'http' | 'agent';
export type HookMatchKind = 'exact' | 'glob' | 'regex';

export interface HookSource {
  layer: HookLayer;
  file: string;
  index: number;
  id: string;
}

export interface LoadedRawHookRule {
  source: HookSource;
  value: Record<string, unknown>;
}

export interface LoadedHookConfig {
  rules: LoadedRawHookRule[];
  secretValues: string[];
}

export interface HookBaseContext {
  event: HookEventName;
  projectRoot: string;
  session: { id: string; reason?: string };
  timestamp: string;
  agent?: {
    id: string;
    kind: SubAgentKind;
    role?: string;
    sessionId: string;
    parentTurnId?: string;
  };
  system?: { reason: string };
  turn?: {
    id: string;
    mode: AgentMode;
    task: string;
    stopReason?: AgentStopReason;
  };
  message?: {
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ id: string; name: string }>;
  };
  tool?: {
    id: string;
    name: string;
    arguments: JsonObject;
    result?: ToolResult;
  };
}

export type HookEventContext = Readonly<HookBaseContext>;

export interface CompiledTextTemplate {
  render(context: HookEventContext): string;
}

export interface CompiledJsonTemplate {
  render(context: HookEventContext): unknown;
}

export interface CompiledHookConditionGroup {
  logic: 'all' | 'any';
  matches(context: HookEventContext): boolean;
}

export type CompiledHookAction =
  | { type: 'command'; command: string }
  | { type: 'prompt'; prompt: CompiledTextTemplate }
  | {
      type: 'http';
      method: string;
      url: CompiledTextTemplate;
      headers: Readonly<Record<string, CompiledTextTemplate>>;
      body?: CompiledJsonTemplate;
    }
  | { type: 'agent'; prompt: CompiledTextTemplate; role?: string };

export interface CompiledHookRule {
  source: HookSource;
  event: HookEventName;
  condition?: CompiledHookConditionGroup;
  action: CompiledHookAction;
  once: boolean;
  background: boolean;
  timeoutMs: number;
}

export type HookDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string };

export type HookFailureCode =
  | 'COMMAND_FAILED'
  | 'COMMAND_TIMEOUT'
  | 'COMMAND_CANCELLED'
  | 'HTTP_FAILED'
  | 'HTTP_TIMEOUT'
  | 'HTTP_CANCELLED'
  | 'INVALID_DECISION'
  | 'TEMPLATE_ERROR'
  | 'AGENT_FAILED'
  | 'NESTED_AGENT_FORBIDDEN'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

export type HookActionResult =
  | { status: 'success'; output?: string; prompt?: string; decision?: HookDecision; truncated?: boolean }
  | { status: 'failed'; code: HookFailureCode; message: string };

export interface HookDispatchResult {
  denied?: {
    reason: string;
    source: HookSource;
    actionType: 'command' | 'http';
  };
  matched: number;
  completed: number;
}

export interface PreparedHookPromptBatch {
  throughId: number;
  content: string;
}

export interface HookLogEntry {
  timestamp: string;
  level: 'error' | 'warning';
  source: HookSource;
  event: HookEventName;
  actionType: HookActionType;
  code: HookFailureCode;
  message: string;
}

export interface HookLogger {
  write(entry: HookLogEntry): Promise<void> | void;
  close?(): Promise<void> | void;
}

export interface HookActionExecutor {
  execute(
    rule: CompiledHookRule,
    context: HookEventContext,
    signal: AbortSignal,
  ): Promise<HookActionResult>;
}

export interface HookRuntime {
  emitAssistantMessage(input: {
    content: string;
    toolCalls: readonly ToolCall[];
  }, signal: AbortSignal): Promise<void>;
  beforeToolUse(call: ToolCall, signal: AbortSignal): Promise<HookDispatchResult>;
  afterToolUse(call: ToolCall, result: ToolResult, signal: AbortSignal): Promise<void>;
  preparePromptBatch(): PreparedHookPromptBatch | undefined;
  commitPromptBatch(throughId: number): void;
}

export interface HookAgentScope {
  id: string;
  kind: SubAgentKind;
  role?: string;
  sessionId: string;
  parentTurnId?: string;
  projectRoot?: string;
  turn: {
    id: string;
    mode: AgentMode;
    task: string;
  };
}

export interface ScopedHookRuntime extends HookRuntime {
  close(): void;
}

export interface HookTurnStartInput {
  task: string;
  mode: AgentMode;
}
