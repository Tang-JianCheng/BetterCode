import type { JsonObject, JsonSchema, ToolErrorCode } from '../tool/types.js';

export type McpConfigLayer = 'user' | 'project';

interface McpServerConfigBase {
  name: string;
  layer: McpConfigLayer;
  file: string;
  secretValues: readonly string[];
  /** 可选：覆盖全局连接/发现超时（毫秒），用于首次下载慢或远程慢的 Server */
  timeoutMs?: number;
}

export interface StdioMcpServerConfig extends McpServerConfigBase {
  transport: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface HttpMcpServerConfig extends McpServerConfigBase {
  transport: 'http';
  url: string;
  headers: Record<string, string>;
}

export type McpServerConfig = StdioMcpServerConfig | HttpMcpServerConfig;

export type McpDiagnosticCode =
  | 'CONFIG_ERROR'
  | 'ENV_MISSING'
  | 'TRANSPORT_ERROR'
  | 'INITIALIZE_ERROR'
  | 'DISCOVERY_ERROR'
  | 'TOOL_SCHEMA_ERROR'
  | 'TOOL_NAME_CONFLICT'
  | 'CLOSE_ERROR';

export interface McpDiagnostic {
  code: McpDiagnosticCode;
  message: string;
  layer?: McpConfigLayer;
  file?: string;
  serverName?: string;
  toolName?: string;
}

export interface LoadedMcpConfig {
  servers: McpServerConfig[];
  diagnostics: McpDiagnostic[];
  secretValues: readonly string[];
}

export interface McpRemoteTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
}

export interface McpAttachmentSummary {
  type: 'image' | 'audio' | 'resource' | 'resource_link';
  mimeType?: string;
  uri?: string;
  name?: string;
  size?: number;
}

export interface McpRemoteCallResult {
  isError: boolean;
  textParts: string[];
  structuredContent?: JsonObject;
  attachments: McpAttachmentSummary[];
}

export type McpSessionState = 'new' | 'connected' | 'unavailable' | 'closed';

export interface McpSessionOptions {
  rootDir: string;
  connectTimeoutMs: number;
  discoveryTimeoutMs: number;
  callTimeoutMs: number;
  maxStderrBytes: number;
}

export interface McpSession {
  readonly serverName: string;
  readonly state: McpSessionState;
  connect(signal?: AbortSignal): Promise<void>;
  listTools(signal?: AbortSignal): Promise<McpRemoteTool[]>;
  callTool(
    remoteToolName: string,
    input: JsonObject,
    signal: AbortSignal,
  ): Promise<McpRemoteCallResult>;
  close(): Promise<void>;
}

export type McpSessionFactory = (
  config: McpServerConfig,
  options: McpSessionOptions,
) => McpSession;

export interface McpStartupStatus {
  configuredServers: number;
  connectedServers: number;
  registeredTools: number;
  diagnostics: readonly McpDiagnostic[];
}

/** /mcp 命令展示用：单个 Server 及其工具清单。 */
export interface McpServerToolListing {
  name: string;
  transport: 'stdio' | 'http';
  connected: boolean;
  tools: readonly McpRemoteTool[];
}

export class McpSessionError extends Error {
  constructor(
    readonly code: Extract<ToolErrorCode, 'MCP_SERVER_UNAVAILABLE' | 'MCP_PROTOCOL_ERROR'>,
    message: string,
  ) {
    super(message);
    this.name = 'McpSessionError';
  }
}

export class McpStartupError extends Error {
  constructor(
    readonly diagnosticCode: Extract<
      McpDiagnosticCode,
      'TRANSPORT_ERROR' | 'INITIALIZE_ERROR' | 'DISCOVERY_ERROR'
    >,
    message: string,
  ) {
    super(message);
    this.name = 'McpStartupError';
  }
}
