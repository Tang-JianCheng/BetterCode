import type { ProviderConfig } from '../config/types.js';
import type {
  LLMProvider,
  Message,
  StreamEvent,
  ToolCall,
  ToolDefinition,
} from './types.js';

interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: OpenAIToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
}

type FetchLike = typeof fetch;

function mapToolDefinition(tool: ToolDefinition) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function mapMessage(message: Message) {
  switch (message.role) {
    case 'user':
      return { role: 'user', content: message.content || ' ' };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map(call => ({
                id: call.id,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments),
                },
              })),
            }
          : {}),
      };
    case 'tool':
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: ProviderConfig, fetchImpl: FetchLike = fetch) {
    this.name = config.name;
    this.model = config.model;
    this.baseUrl = config.base_url.replace(/\/$/, '');
    this.apiKey = config.api_key;
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
      messages: messages.map(mapMessage),
      stream: true,
    };
    if (tools.length > 0) {
      body.tools = tools.map(mapToolDefinition);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        onEvent({ type: 'done', content: '' });
        return;
      }
      onEvent({ type: 'error', content: `网络请求失败: ${(err as Error).message}` });
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
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    let hadError = false;

    const emitToolCalls = () => {
      for (const [index, call] of calls) {
        try {
          const parsed: unknown = JSON.parse(call.arguments || '{}');
          if (!isJsonObject(parsed)) throw new Error('工具参数必须是 JSON 对象');
          const toolCall: ToolCall = {
            id: call.id || `call-${index}`,
            name: call.name,
            arguments: parsed,
          };
          onEvent({ type: 'tool_call', call: toolCall });
        } catch (error) {
          hadError = true;
          onEvent({
            type: 'error',
            content: `工具调用参数解析失败: ${(error as Error).message}`,
          });
        }
      }
    };

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;

      let parsed: OpenAIChunk;
      try {
        parsed = JSON.parse(data) as OpenAIChunk;
      } catch {
        return;
      }

      const choice = parsed.choices?.[0];
      if (!choice) return;
      const content = choice.delta?.content;
      if (content) onEvent({ type: 'text_delta', content });

      for (const delta of choice.delta?.tool_calls ?? []) {
        const current = calls.get(delta.index) ?? {
          id: '',
          name: '',
          arguments: '',
        };
        if (delta.id) current.id = delta.id;
        if (delta.function?.name) current.name += delta.function.name;
        if (delta.function?.arguments) current.arguments += delta.function.arguments;
        calls.set(delta.index, current);
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
      emitToolCalls();
      onEvent({ type: 'done', content: '' });
    } catch (err) {
      hadError = true;
      onEvent({ type: 'error', content: `流式读取中断: ${(err as Error).message}` });
    } finally {
      reader.releaseLock();
      void hadError;
    }
  }
}
