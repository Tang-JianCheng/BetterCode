import { Buffer } from 'node:buffer';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { redactMcpMessage } from './redaction.js';
import {
  McpSessionError,
  McpStartupError,
  type McpAttachmentSummary,
  type McpRemoteCallResult,
  type McpRemoteTool,
  type McpServerConfig,
  type McpSession,
  type McpSessionOptions,
  type McpSessionState,
} from './types.js';
import type { JsonObject } from '../tool/types.js';

const MAX_TOOL_PAGES = 100;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function looksLikeTransportFailure(message: string): boolean {
  return /\b(?:ENOENT|EACCES|ECONN|ENOTFOUND|fetch failed|HTTP|spawn|socket)\b/iu.test(message);
}

function attachmentSize(data: string): number {
  try {
    return Buffer.byteLength(data, 'base64');
  } catch {
    return data.length;
  }
}

export class McpSdkSession implements McpSession {
  readonly serverName: string;
  private currentState: McpSessionState = 'new';
  private readonly client: Client;
  private readonly transport: Transport;
  private stderrTail = Buffer.alloc(0);
  private closing = false;
  private closePromise?: Promise<void>;

  constructor(
    private readonly config: McpServerConfig,
    private readonly options: McpSessionOptions,
    dependencies: { client?: Client; transport?: Transport } = {},
  ) {
    this.serverName = config.name;
    this.transport = dependencies.transport ?? this.createTransport();
    this.client = dependencies.client ?? new Client(
      { name: 'BetterCode', version: '1.0.0' },
      { capabilities: {} },
    );
    this.client.onclose = () => {
      this.currentState = this.closing ? 'closed' : 'unavailable';
    };
  }

  get state(): McpSessionState {
    return this.currentState;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.currentState !== 'new') {
      if (this.currentState === 'connected') return;
      throw new McpStartupError('INITIALIZE_ERROR', `MCP Server ${this.serverName} 不可连接`);
    }
    try {
      await this.client.connect(this.transport, {
        signal,
        timeout: this.options.connectTimeoutMs,
        maxTotalTimeout: this.options.connectTimeoutMs,
      });
      this.currentState = 'connected';
    } catch (error) {
      this.currentState = 'unavailable';
      const message = this.safeError(error);
      throw new McpStartupError(
        looksLikeTransportFailure(message) ? 'TRANSPORT_ERROR' : 'INITIALIZE_ERROR',
        message,
      );
    }
  }

  async listTools(signal?: AbortSignal): Promise<McpRemoteTool[]> {
    this.assertConnected('发现工具');
    const tools: McpRemoteTool[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    try {
      for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
        const result = await this.client.listTools(
          cursor ? { cursor } : undefined,
          {
            signal,
            timeout: this.options.discoveryTimeoutMs,
            maxTotalTimeout: this.options.discoveryTimeoutMs,
          },
        );
        for (const tool of result.tools) {
          tools.push({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            readOnly: tool.annotations?.readOnlyHint === true,
          });
        }
        if (!result.nextCursor) return tools;
        if (seenCursors.has(result.nextCursor)) {
          throw new Error(`tools/list 返回重复 cursor: ${result.nextCursor}`);
        }
        seenCursors.add(result.nextCursor);
        cursor = result.nextCursor;
      }
      throw new Error(`tools/list 分页超过 ${MAX_TOOL_PAGES} 页`);
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new McpStartupError('DISCOVERY_ERROR', this.safeError(error));
    }
  }

  async callTool(
    remoteToolName: string,
    input: JsonObject,
    signal: AbortSignal,
  ): Promise<McpRemoteCallResult> {
    if (this.currentState !== 'connected') {
      throw new McpSessionError(
        'MCP_SERVER_UNAVAILABLE',
        `MCP Server ${this.serverName} 当前不可用`,
      );
    }
    try {
      const result = await this.client.callTool(
        { name: remoteToolName, arguments: input },
        undefined,
        {
          signal,
          timeout: this.options.callTimeoutMs,
          maxTotalTimeout: this.options.callTimeoutMs,
        },
      );
      if ('toolResult' in result) {
        throw new Error('Server 返回了当前客户端未启用的任务型工具结果');
      }
      return this.normalizeCallResult(result);
    } catch (error) {
      if (signal.aborted) throw error;
      const message = this.safeError(error);
      if (
        this.currentState !== 'connected'
        || looksLikeTransportFailure(message)
        || /connection closed|not connected|socket closed/iu.test(message)
      ) {
        this.currentState = 'unavailable';
        throw new McpSessionError('MCP_SERVER_UNAVAILABLE', message);
      }
      throw new McpSessionError('MCP_PROTOCOL_ERROR', message);
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeInternal();
    return this.closePromise;
  }

  private createTransport(): Transport {
    if (this.config.transport === 'stdio') {
      const transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        cwd: this.options.rootDir,
        env: { ...getDefaultEnvironment(), ...this.config.env },
        stderr: 'pipe',
      });
      transport.stderr?.on('data', chunk => this.captureStderr(chunk));
      return transport;
    }
    return new StreamableHTTPClientTransport(new URL(this.config.url), {
      requestInit: { headers: this.config.headers },
      reconnectionOptions: {
        initialReconnectionDelay: 1_000,
        maxReconnectionDelay: 30_000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 0,
      },
    });
  }

  private captureStderr(chunk: unknown): void {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    this.stderrTail = Buffer.concat([this.stderrTail, incoming]);
    if (this.stderrTail.byteLength > this.options.maxStderrBytes) {
      this.stderrTail = this.stderrTail.subarray(this.stderrTail.byteLength - this.options.maxStderrBytes);
    }
  }

  private normalizeCallResult(result: {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string }
      | { type: 'audio'; data: string; mimeType: string }
      | {
          type: 'resource';
          resource: { uri: string; mimeType?: string; text: string } | {
            uri: string;
            mimeType?: string;
            blob: string;
          };
        }
      | {
          type: 'resource_link';
          uri: string;
          name: string;
          mimeType?: string;
          size?: number;
        }
    >;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  }): McpRemoteCallResult {
    const textParts: string[] = [];
    const attachments: McpAttachmentSummary[] = [];
    for (const content of result.content) {
      if (content.type === 'text') {
        textParts.push(content.text);
      } else if (content.type === 'image' || content.type === 'audio') {
        attachments.push({
          type: content.type,
          mimeType: content.mimeType,
          size: attachmentSize(content.data),
        });
      } else if (content.type === 'resource_link') {
        attachments.push({
          type: 'resource_link',
          uri: content.uri,
          name: content.name,
          mimeType: content.mimeType,
          size: content.size,
        });
      } else if ('text' in content.resource) {
        textParts.push(`[资源 ${content.resource.uri}]\n${content.resource.text}`);
      } else {
        attachments.push({
          type: 'resource',
          uri: content.resource.uri,
          mimeType: content.resource.mimeType,
          size: attachmentSize(content.resource.blob),
        });
      }
    }
    return {
      isError: result.isError === true,
      textParts,
      structuredContent: result.structuredContent,
      attachments,
    };
  }

  private assertConnected(operation: string): void {
    if (this.currentState !== 'connected') {
      throw new McpStartupError(
        'DISCOVERY_ERROR',
        `${operation}失败: MCP Server ${this.serverName} 未连接`,
      );
    }
  }

  private safeError(error: unknown): string {
    const stderr = this.stderrTail.toString('utf8').trim();
    const combined = stderr ? `${errorMessage(error)}; stderr: ${stderr}` : errorMessage(error);
    return redactMcpMessage(combined, this.config.secretValues);
  }

  private async closeInternal(): Promise<void> {
    if (this.currentState === 'closed') return;
    this.closing = true;
    try {
      await this.client.close();
    } catch (error) {
      try {
        await this.transport.close();
      } catch {
        // 对外只保留第一次关闭错误，transport 已尽力回收。
      }
      throw new Error(this.safeError(error));
    } finally {
      this.currentState = 'closed';
    }
  }
}
