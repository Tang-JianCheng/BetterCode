import type {
  LLMProvider,
  ProviderRequest,
  TokenUsage,
} from '../provider/types.js';
import type { ToolCall } from '../tool/types.js';
import type { AgentEvent } from './types.js';

export interface CollectedTurn {
  text: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  status: 'completed' | 'cancelled' | 'stream_error';
  error?: string;
}

export class StreamCollector {
  async collect(
    provider: LLMProvider,
    request: ProviderRequest,
    iteration: number,
    signal: AbortSignal,
    emit: (event: AgentEvent) => void,
  ): Promise<CollectedTurn> {
    let text = '';
    const toolCalls: ToolCall[] = [];
    let usage: TokenUsage | undefined;
    let sawDone = false;
    let streamError: string | undefined;

    try {
      await provider.chat(request, event => {
        if (sawDone || streamError) return;
        switch (event.type) {
          case 'text_delta':
            text += event.content;
            emit({ type: 'text_delta', iteration, content: event.content });
            break;
          case 'thinking_delta':
            // 思考过程内容不进入 Agent 事件流，避免在界面展示。
            break;
          case 'tool_call':
            toolCalls.push(event.call);
            emit({ type: 'tool_call', iteration, call: event.call });
            break;
          case 'usage':
            usage = event.usage;
            break;
          case 'error':
            streamError = event.content;
            break;
          case 'done':
            sawDone = true;
            break;
        }
      }, signal);
    } catch (error) {
      streamError = error instanceof Error ? error.message : String(error);
    }

    const base = { text, toolCalls, usage };
    if (signal.aborted) return { ...base, status: 'cancelled' };
    if (streamError) {
      return { ...base, status: 'stream_error', error: streamError };
    }
    if (!sawDone) {
      return { ...base, status: 'stream_error', error: '模型响应流提前结束' };
    }
    return { ...base, status: 'completed' };
  }
}
