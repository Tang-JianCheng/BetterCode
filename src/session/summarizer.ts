import type { LLMProvider, ProviderRequest, StreamEvent } from '../provider/types.js';

const SUMMARY_SYSTEM_PROMPT = `你是 BetterCode 的会话摘要器。
用一句不超过 100 字的中文总结这段对话完成了什么，直接输出摘要本身。
禁止调用工具，不要解释，不要输出多余内容。`;

export class SessionSummarizer {
  async summarize(context: string, provider: LLMProvider): Promise<string> {
    const content = context.trim();
    if (!content) return '';
    const request: ProviderRequest = {
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `请总结以下对话：\n\n${content}` }],
      tools: [],
      maxOutputTokens: 128,
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
      if (!valid || !done) return '';
      return response.trim().split(/\r?\n/u)[0].slice(0, 100);
    } catch {
      return '';
    }
  }
}
