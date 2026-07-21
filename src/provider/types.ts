import type { ToolCall, ToolDefinition } from '../tool/types.js';

export type { ToolCall, ToolDefinition } from '../tool/types.js';

/** 一条对话消息，包含模型文本、工具调用和工具结果 */
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | {
      role: 'tool';
      toolCallId: string;
      toolName: string;
      content: string;
      isError: boolean;
    };

/** Provider 在流式返回时实时发出的事件 */
export type StreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'error'; content: string }
  | { type: 'done'; content: '' };

/** 所有 LLM 后端必须实现的统一接口 */
export interface LLMProvider {
  /** 供应商名称 */
  readonly name: string;
  /** 当前使用的模型名 */
  readonly model: string;

  /**
   * 发送消息并流式接收回复
   * @param messages  完整对话历史
   * @param onEvent   每收到一个 token 或事件时回调
   * @param signal    可选的 AbortSignal，用于取消请求
   */
  chat(
    messages: Message[],
    tools: ToolDefinition[],
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}
