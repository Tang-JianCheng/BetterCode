import { createHash } from 'node:crypto';
import type { Message, ProviderRequest } from '../provider/types.js';
import { stableStringifyJson } from '../tool/stable-json.js';
import type { TokenEstimate } from './types.js';

interface EstimateParts {
  systemPromptHash: string;
  toolsHash: string;
  messageHashes: string[];
  messageTokens: number[];
  fullTokens: number;
}

interface TokenAnchor extends EstimateParts {
  apiInputTokens: number;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function visibleMessage(message: Message): unknown {
  switch (message.role) {
    case 'user':
    case 'instruction':
      return { role: message.role, content: message.content };
    case 'assistant':
      return {
        role: message.role,
        content: message.content,
        ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
      };
    case 'tool':
      return {
        role: message.role,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: message.content,
        isError: message.isError,
      };
  }
}

export class TokenEstimator {
  private anchor?: TokenAnchor;

  estimateText(value: string): number {
    let ascii = 0;
    let nonAscii = 0;
    for (const character of value) {
      if (character.codePointAt(0)! <= 0x7f) ascii += 1;
      else nonAscii += 1;
    }
    return Math.ceil((ascii / 4 + nonAscii) * 1.1);
  }

  estimateMessage(message: Message): number {
    return this.estimateText(stableStringifyJson(visibleMessage(message))) + 4;
  }

  estimateRequest(request: ProviderRequest): TokenEstimate {
    const parts = this.createParts(request);
    if (!this.anchor ||
        parts.systemPromptHash !== this.anchor.systemPromptHash ||
        parts.toolsHash !== this.anchor.toolsHash) {
      return { tokens: parts.fullTokens, source: 'full_estimate', commonMessagePrefix: 0 };
    }

    let commonMessagePrefix = 0;
    const limit = Math.min(parts.messageHashes.length, this.anchor.messageHashes.length);
    while (commonMessagePrefix < limit &&
           parts.messageHashes[commonMessagePrefix] === this.anchor.messageHashes[commonMessagePrefix]) {
      commonMessagePrefix += 1;
    }
    const oldSuffix = this.anchor.messageTokens
      .slice(commonMessagePrefix)
      .reduce((sum, value) => sum + value, 0);
    const newSuffix = parts.messageTokens
      .slice(commonMessagePrefix)
      .reduce((sum, value) => sum + value, 0);
    return {
      tokens: Math.max(0, Math.ceil(this.anchor.apiInputTokens - oldSuffix + newSuffix)),
      source: 'api_anchor',
      commonMessagePrefix,
    };
  }

  recordUsage(request: ProviderRequest, inputTokens: number): void {
    if (!Number.isFinite(inputTokens) || inputTokens <= 0) return;
    this.anchor = {
      ...this.createParts(request),
      apiInputTokens: Math.floor(inputTokens),
    };
  }

  invalidate(): void {
    this.anchor = undefined;
  }

  reset(): void {
    this.invalidate();
  }

  private createParts(request: ProviderRequest): EstimateParts {
    const tools = stableStringifyJson(request.tools);
    const messageValues = request.messages.map(message => stableStringifyJson(visibleMessage(message)));
    const messageTokens = request.messages.map(message => this.estimateMessage(message));
    const systemTokens = this.estimateText(request.systemPrompt) + 4;
    const toolTokens = this.estimateText(tools) + request.tools.length * 8;
    return {
      systemPromptHash: hash(request.systemPrompt),
      toolsHash: hash(tools),
      messageHashes: messageValues.map(hash),
      messageTokens,
      fullTokens: systemTokens + toolTokens + messageTokens.reduce((sum, value) => sum + value, 0) + 12,
    };
  }
}
