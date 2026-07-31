import type { ToolCall, ToolDefinition } from '../tool/types.js';

export type { ToolCall, ToolDefinition } from '../tool/types.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export type InstructionKind =
  | 'runtime'
  | 'context_summary'
  | 'context_boundary'
  | 'subagent_result';

export interface OffloadedToolResult {
  kind: 'offloaded_tool_result';
  relativePath: string;
  originalBytes: number;
  estimatedTokens: number;
  sha256: string;
}

/** 一条对话消息，包含模型文本、工具调用和工具结果 */
export type Message =
  | { role: 'user'; content: string }
  | { role: 'instruction'; content: string; instructionKind?: InstructionKind }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | {
      role: 'tool';
      toolCallId: string;
      toolName: string;
      content: string;
      isError: boolean;
      contextReference?: OffloadedToolResult;
    };

/** Provider 在流式返回时实时发出的事件 */
export type StreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'error'; content: string }
  | { type: 'done'; content: '' };

/** 一次模型请求，稳定提示、动态消息和工具定义保持独立 */
export interface ProviderRequest {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  maxOutputTokens?: number;
}

/** 所有 LLM 后端必须实现的统一接口 */
export interface LLMProvider {
  /** 供应商名称 */
  readonly name: string;
  /** 当前使用的模型名 */
  readonly model: string;
  readonly contextWindow: number;
  readonly contextWindowIsDefault: boolean;

  /**
   * 发送消息并流式接收回复
   * @param request   当前请求的系统提示、消息和工具定义
   * @param onEvent   每收到一个 token 或事件时回调
   * @param signal    可选的 AbortSignal，用于取消请求
   */
  chat(
    request: ProviderRequest,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}
