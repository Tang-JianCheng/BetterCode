import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';
import { MemoryManager, type MemoryType } from './manager.js';

const EXTRACTION_SYSTEM_PROMPT = `你是 BetterCode 的长期记忆提取器。
只记录未来会话仍有价值的稳定信息，不记录临时进度、寒暄或可从代码重新读取的普通细节。
禁止调用工具。没有内容时只输出 NONE。
有内容时每条按以下格式输出，条目之间用单独一行 --- 分隔：
MEMORY_NAME: 简短文件名
MEMORY_TYPE: user|feedback|project|reference
MEMORY_DESC: 一句话描述
MEMORY_BODY:
完整、可独立理解的记忆正文`;

interface PendingExtraction {
  context: string;
  provider: LLMProvider;
}

function field(block: string, name: string): string {
  const marker = `${name}:`;
  const index = block.indexOf(marker);
  if (index < 0) return '';
  const value = block.slice(index + marker.length);
  if (name === 'MEMORY_BODY') return value.trim();
  return value.split(/\r?\n/u)[0]?.trim() ?? '';
}

function isMemoryType(value: string): value is MemoryType {
  return value === 'user' || value === 'feedback' || value === 'project' || value === 'reference';
}

export class MemoryExtractor {
  private inProgress = false;
  private pendingContext: PendingExtraction | undefined;

  constructor(private readonly manager: MemoryManager) {}

  async extract(conversationSummary: string, provider: LLMProvider): Promise<string[]> {
    if (!conversationSummary.trim()) return [];
    if (this.inProgress) {
      this.pendingContext = { context: conversationSummary, provider };
      return [];
    }
    this.inProgress = true;
    const saved: string[] = [];
    let current: PendingExtraction | undefined = { context: conversationSummary, provider };
    try {
      while (current) {
        saved.push(...await this.doExtract(current.context, current.provider));
        current = this.pendingContext;
        this.pendingContext = undefined;
      }
      return saved;
    } finally {
      this.inProgress = false;
    }
  }

  private async doExtract(context: string, provider: LLMProvider): Promise<string[]> {
    const request: ProviderRequest = {
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `请从以下对话中提取长期记忆：\n\n${context}` }],
      tools: [],
      maxOutputTokens: 2_048,
    };
    let response = '';
    let done = false;
    let valid = true;
    try {
      await provider.chat(request, (event: StreamEvent) => {
        if (event.type === 'text_delta') response += event.content;
        else if (event.type === 'done') done = true;
        else if (event.type === 'error' || event.type === 'tool_call') valid = false;
      });
      if (!valid || !done || response.trim() === 'NONE' || !response.includes('MEMORY_NAME:')) return [];
      const saved: string[] = [];
      for (const block of response.split(/^---$/mu)) {
        const name = field(block, 'MEMORY_NAME');
        const type = field(block, 'MEMORY_TYPE');
        const description = field(block, 'MEMORY_DESC');
        const content = field(block, 'MEMORY_BODY');
        if (!name || !content || !isMemoryType(type)) continue;
        try {
          this.manager.saveMemory({ name, type, description, content });
          saved.push(name);
        } catch {
          // 单条笔记写入失败时继续处理其他提取结果。
        }
      }
      return saved;
    } catch {
      return [];
    }
  }
}
