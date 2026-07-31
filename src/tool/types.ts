export type JsonObject = Record<string, unknown>;
export type JsonSchema = Record<string, unknown>;
export type ToolEffect = 'read_only' | 'side_effect';
export type PermissionTargetKind = 'path' | 'command' | 'glob' | 'value' | 'arguments';
export type PermissionPathIntent = 'existing' | 'write' | 'glob';

export type ToolPermissionProfile =
  | {
      targetArgument: string;
      targetKind: Exclude<PermissionTargetKind, 'arguments'>;
      defaultTarget?: string;
      pathIntent?: PermissionPathIntent;
      risk: 'read' | 'write' | 'execute';
    }
  | {
      targetKind: 'arguments';
      risk: 'read' | 'write' | 'execute';
    };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

export type ToolResultMetadata = Record<string, string | number | boolean | null>;

export interface ToolResult {
  ok: boolean;
  output: string;
  error?: {
    code: ToolErrorCode;
    message: string;
  };
  metadata: ToolResultMetadata;
}

export interface ToolContext {
  rootDir: string;
  signal: AbortSignal;
  maxOutputBytes: number;
  executionState?: import('./execution-state.js').ToolExecutionState;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly effect: ToolEffect;
  readonly permission: ToolPermissionProfile;

  execute(input: JsonObject, context: ToolContext): Promise<ToolResult>;
}

export interface ToolRuntimeOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

export type ToolErrorCode =
  | 'INVALID_ARGUMENTS'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_UNAVAILABLE'
  | 'CANCELLED'
  | 'DANGEROUS_COMMAND'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_CANCELLED'
  | 'PERMISSION_UNAVAILABLE'
  | 'PERMISSION_CONFIG_ERROR'
  | 'HOOK_DENIED'
  | 'PATH_OUTSIDE_ROOT'
  | 'FILE_NOT_FOUND'
  | 'NOT_TEXT_FILE'
  | 'MATCH_NOT_FOUND'
  | 'MATCH_NOT_UNIQUE'
  | 'TIMEOUT'
  | 'MCP_SERVER_UNAVAILABLE'
  | 'MCP_PROTOCOL_ERROR'
  | 'MCP_TOOL_ERROR'
  | 'SUBAGENT_UNAVAILABLE'
  | 'SUBAGENT_CONTEXT_ERROR'
  | 'SUBAGENT_WORKTREE_ERROR'
  | 'SUBAGENT_FAILED'
  | 'EXECUTION_ERROR'
  | 'INTERNAL_ERROR';

export function createToolSuccess(
  output: string,
  metadata: ToolResultMetadata = {},
): ToolResult {
  return { ok: true, output, metadata };
}

export function createToolError(
  code: ToolErrorCode,
  message: string,
  metadata: ToolResultMetadata = {},
  output = '',
): ToolResult {
  return {
    ok: false,
    output,
    error: { code, message },
    metadata,
  };
}
