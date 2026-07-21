export type JsonObject = Record<string, unknown>;
export type JsonSchema = Record<string, unknown>;

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
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;

  execute(input: JsonObject, context: ToolContext): Promise<ToolResult>;
}

export interface ToolRuntimeOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

export type ToolErrorCode =
  | 'INVALID_ARGUMENTS'
  | 'TOOL_NOT_FOUND'
  | 'PATH_OUTSIDE_ROOT'
  | 'FILE_NOT_FOUND'
  | 'NOT_TEXT_FILE'
  | 'MATCH_NOT_FOUND'
  | 'MATCH_NOT_UNIQUE'
  | 'TIMEOUT'
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
