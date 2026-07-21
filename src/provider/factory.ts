import type { ProviderConfig } from '../config/types.js';
import type { LLMProvider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

/**
 * 根据 ProviderConfig 创建对应的 LLMProvider 实例。
 * 工厂函数——调用方只依赖 LLMProvider 接口，不感知具体实现。
 *
 * @throws 当 protocol 不受支持时抛 Error
 */
export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.protocol) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    default:
      throw new Error(
        `不支持的协议: "${(config as ProviderConfig).protocol}"，` +
        `仅支持 anthropic 和 openai`,
      );
  }
}
