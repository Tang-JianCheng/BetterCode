import type { ProviderConfig } from '../config/types.js';
import type {
  LLMProvider,
  Message,
  StreamEvent,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from './types.js';

interface AnthropicEvent {
  type: string;
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
  };
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
}

type FetchLike = typeof fetch;

function mapToolDefinition(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function mapMessages(messages: Message[]) {
  const result: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === 'user') {
      result.push({ role: 'user', content: message.content || ' ' });
      continue;
    }

    if (message.role === 'assistant') {
      if (!message.toolCalls?.length) {
        result.push({ role: 'assistant', content: message.content || ' ' });
        continue;
      }

      const content: Array<Record<string, unknown>> = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls) {
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      result.push({ role: 'assistant', content });
      continue;
    }

    const toolResult = {
      type: 'tool_result',
      tool_use_id: message.toolCallId,
      content: message.content,
      ...(message.isError ? { is_error: true } : {}),
    };
    const previous = result[result.length - 1];
    if (previous?.role === 'user' && Array.isArray(previous.content)) {
      (previous.content as Array<Record<string, unknown>>).push(toolResult);
    } else {
      result.push({ role: 'user', content: [toolResult] });
    }
  }

  return result;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class AnthropicProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly thinking: boolean;
  private readonly fetchImpl: FetchLike;

  constructor(config: ProviderConfig, fetchImpl: FetchLike = fetch) {
    this.name = config.name;
    this.model = config.model;
    this.baseUrl = config.base_url.replace(/\/$/, '');
    this.apiKey = config.api_key;
    this.thinking = config.thinking ?? false;
    this.fetchImpl = fetchImpl;
  }

  async chat(
    messages: Message[],
    tools: ToolDefinition[],
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: mapMessages(messages),
      stream: true,
      max_tokens: 4096,
    };
    if (tools.length > 0) body.tools = tools.map(mapToolDefinition);
    if (this.thinking) body.thinking = { type: 'enabled', budget_tokens: 4000 };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError' || signal?.aborted) return;
      onEvent({ type: 'error', content: `网络请求失败: ${(error as Error).message}` });
      return;
    }

    if (!response.ok) {
      let errorMsg = `API 请求失败 (HTTP ${response.status})`;
      try {
        const errorBody = await response.text();
        const parsed = JSON.parse(errorBody);
        if (parsed.error?.message) {
          errorMsg = `API 认证失败，请检查 api_key 配置: ${parsed.error.message}`;
        }
      } catch {
        // 使用默认 HTTP 错误
      }
      onEvent({ type: 'error', content: errorMsg });
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onEvent({ type: 'error', content: '无法读取响应流' });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let sawMessageStop = false;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    const toolBlocks = new Map<number, { id: string; name: string; partialJson: string }>();
    const completedCalls = new Map<number, ToolCall>();

    const completeToolCall = (index: number) => {
      const block = toolBlocks.get(index);
      if (!block) return;
      toolBlocks.delete(index);
      const parsed: unknown = JSON.parse(block.partialJson || '{}');
      if (!isJsonObject(parsed)) throw new Error('工具参数必须是 JSON 对象');
      completedCalls.set(index, {
        id: block.id || `tool-${index}`,
        name: block.name,
        arguments: parsed,
      });
    };

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || sawMessageStop) return;

      let event: AnthropicEvent;
      try {
        event = JSON.parse(data) as AnthropicEvent;
      } catch {
        throw new Error('Anthropic SSE JSON 解析失败');
      }

      switch (event.type) {
        case 'message_start':
          inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
          outputTokens = event.message?.usage?.output_tokens ?? outputTokens;
          break;
        case 'content_block_start':
          if (event.index !== undefined && event.content_block?.type === 'tool_use') {
            toolBlocks.set(event.index, {
              id: event.content_block.id ?? '',
              name: event.content_block.name ?? '',
              partialJson: '',
            });
          }
          break;
        case 'content_block_delta': {
          const delta = event.delta;
          if (!delta) break;
          if (delta.type === 'thinking_delta' && delta.thinking) {
            onEvent({ type: 'thinking_delta', content: delta.thinking });
          } else if (delta.type === 'text_delta' && delta.text) {
            onEvent({ type: 'text_delta', content: delta.text });
          } else if (delta.type === 'input_json_delta' && event.index !== undefined) {
            const block = toolBlocks.get(event.index);
            if (block) block.partialJson += delta.partial_json ?? '';
          }
          break;
        }
        case 'content_block_stop':
          if (event.index !== undefined) completeToolCall(event.index);
          break;
        case 'message_delta':
          inputTokens = event.usage?.input_tokens ?? inputTokens;
          outputTokens = event.usage?.output_tokens ?? outputTokens;
          break;
        case 'message_stop':
          if (toolBlocks.size > 0) throw new Error('Anthropic 工具调用未完整结束');
          sawMessageStop = true;
          break;
        case 'error':
          throw new Error(event.error?.message ?? '未知 API 错误');
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) handleLine(line);
      }
      buffer += decoder.decode();
      if (buffer) handleLine(buffer);
      if (!sawMessageStop) throw new Error('Anthropic 响应流提前结束');

      for (const [, call] of [...completedCalls.entries()].sort(([left], [right]) => left - right)) {
        onEvent({ type: 'tool_call', call });
      }
      if (inputTokens !== undefined || outputTokens !== undefined) {
        const usage: TokenUsage = {
          inputTokens: inputTokens ?? 0,
          outputTokens: outputTokens ?? 0,
          totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
        };
        onEvent({ type: 'usage', usage });
      }
      onEvent({ type: 'done', content: '' });
    } catch (error) {
      if (!signal?.aborted) {
        onEvent({
          type: 'error',
          content: `流式读取失败: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } finally {
      reader.releaseLock();
    }
  }
}
