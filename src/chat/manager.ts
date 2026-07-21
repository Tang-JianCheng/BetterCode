import { serializeToolResult } from '../tool/output-limit.js';
import type { ToolCall } from '../tool/types.js';
import { ToolRegistry } from '../tool/registry.js';
import type {
  LLMProvider,
  Message,
  StreamEvent,
  ToolDefinition,
} from '../provider/types.js';

const MULTI_TOOL_LIMIT_MESSAGE = '当前版本一次只支持一个工具调用，未执行任何工具。';
const SECOND_TOOL_LIMIT_MESSAGE = '工具结果已返回，但当前版本不会继续执行下一次工具调用。';

interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
}

export class ChatManager {
  private history: Message[] = [];

  constructor(
    private readonly toolRegistry: ToolRegistry,
    systemPrompt?: string,
  ) {
    if (systemPrompt) {
      this.history.push({ role: 'user', content: systemPrompt });
    }
  }

  getHistory(): ReadonlyArray<Message> {
    return [...this.history];
  }

  async send(
    userInput: string,
    provider: LLMProvider,
    onThinkingDelta: (token: string) => void,
    onTextDelta: (token: string) => void,
    onError: (err: string) => void,
  ): Promise<string> {
    this.history.push({ role: 'user', content: userInput });

    const first = await this.requestTurn(
      provider,
      this.history,
      this.toolRegistry.definitions(),
      onThinkingDelta,
      onTextDelta,
      onError,
    );

    if (first.toolCalls.length === 0) {
      this.appendAssistant(first.text);
      return first.text;
    }

    if (first.toolCalls.length > 1) {
      this.history.push({ role: 'assistant', content: MULTI_TOOL_LIMIT_MESSAGE });
      onError(MULTI_TOOL_LIMIT_MESSAGE);
      return first.text;
    }

    const [toolCall] = first.toolCalls;
    this.history.push({
      role: 'assistant',
      content: first.text,
      toolCalls: [toolCall],
    });

    const toolResult = await this.toolRegistry.execute(toolCall);
    this.history.push({
      role: 'tool',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: serializeToolResult(toolResult),
      isError: !toolResult.ok,
    });

    const second = await this.requestTurn(
      provider,
      this.history,
      [],
      onThinkingDelta,
      onTextDelta,
      onError,
    );

    if (second.toolCalls.length > 0) {
      const finalText = second.text
        ? `${second.text}\n\n${SECOND_TOOL_LIMIT_MESSAGE}`
        : SECOND_TOOL_LIMIT_MESSAGE;
      this.appendAssistant(finalText);
      onError(SECOND_TOOL_LIMIT_MESSAGE);
      return `${first.text}${second.text}`;
    }

    this.appendAssistant(second.text);
    return `${first.text}${second.text}`;
  }

  clear(): void {
    this.history = [];
  }

  get turnCount(): number {
    return this.history.filter(message => message.role === 'user').length;
  }

  private async requestTurn(
    provider: LLMProvider,
    messages: Message[],
    tools: ToolDefinition[],
    onThinkingDelta: (token: string) => void,
    onTextDelta: (token: string) => void,
    onError: (err: string) => void,
  ): Promise<TurnResult> {
    let text = '';
    const toolCalls: ToolCall[] = [];

    await provider.chat(messages, tools, (event: StreamEvent) => {
      switch (event.type) {
        case 'text_delta':
          text += event.content;
          onTextDelta(event.content);
          break;
        case 'thinking_delta':
          onThinkingDelta(event.content);
          break;
        case 'tool_call':
          toolCalls.push(event.call);
          break;
        case 'error':
          onError(event.content);
          break;
        case 'done':
          break;
      }
    });

    return { text, toolCalls };
  }

  private appendAssistant(content: string): void {
    if (content) this.history.push({ role: 'assistant', content });
  }
}
