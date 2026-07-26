import { stableStringifyJson } from '../tool/stable-json.js';
import {
  createToolError,
  createToolSuccess,
  type JsonObject,
  type Tool,
  type ToolContext,
  type ToolResult,
} from '../tool/types.js';
import { McpSessionError, type McpRemoteTool, type McpSession } from './types.js';

export class McpToolAdapter implements Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: McpRemoteTool['inputSchema'];
  readonly effect: Tool['effect'];
  readonly permission: Tool['permission'];

  constructor(
    localName: string,
    private readonly serverName: string,
    private readonly remote: McpRemoteTool,
    private readonly session: McpSession,
  ) {
    this.name = localName;
    this.description = `[MCP Server: ${serverName}] ${remote.description ?? remote.name}`;
    this.inputSchema = remote.inputSchema;
    this.effect = remote.readOnly ? 'read_only' : 'side_effect';
    this.permission = {
      targetKind: 'arguments',
      risk: remote.readOnly ? 'read' : 'execute',
    };
  }

  async execute(input: JsonObject, context: ToolContext): Promise<ToolResult> {
    try {
      const result = await this.session.callTool(this.remote.name, input, context.signal);
      const output = this.formatOutput(result);
      const metadata = {
        server: this.serverName,
        remoteTool: this.remote.name,
        attachmentCount: result.attachments.length,
      };
      if (result.isError) {
        return createToolError('MCP_TOOL_ERROR', 'MCP 工具返回业务错误', metadata, output);
      }
      return createToolSuccess(output, metadata);
    } catch (error) {
      if (context.signal.aborted) return createToolError('CANCELLED', 'MCP 工具调用已取消');
      if (error instanceof McpSessionError) return createToolError(error.code, error.message);
      return createToolError(
        'MCP_PROTOCOL_ERROR',
        `MCP 工具调用失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private formatOutput(result: Awaited<ReturnType<McpSession['callTool']>>): string {
    const sections = [...result.textParts];
    if (result.structuredContent) {
      sections.push(`结构化结果:\n${stableStringifyJson(result.structuredContent)}`);
    }
    if (result.attachments.length > 0) {
      sections.push(`附件摘要:\n${stableStringifyJson(result.attachments)}`);
    }
    return sections.join('\n\n') || 'MCP 工具执行完成，未返回文本内容。';
  }
}
