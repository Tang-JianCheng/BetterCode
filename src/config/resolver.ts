import { createInterface } from 'node:readline';
import type { AppConfig, ProviderConfig } from './types.js';

/**
 * 交互式选择供应商（在 TUI 启动前用 readline 实现）。
 */
function selectInteractively(providers: ProviderConfig[]): Promise<ProviderConfig> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log('\n请选择要使用的 LLM 供应商:\n');
    providers.forEach((p, i) => {
      console.log(`  [${i + 1}] ${p.name}  (${p.protocol} / ${p.model})`);
    });
    console.log('');

    rl.question('请输入序号: ', (answer) => {
      rl.close();
      const index = parseInt(answer.trim(), 10) - 1;
      if (isNaN(index) || index < 0 || index >= providers.length) {
        console.error(`无效的序号: ${answer}，请输入 1-${providers.length}`);
        process.exit(1);
      }
      console.log(`已选择: ${providers[index].name}\n`);
      resolve(providers[index]);
    });
  });
}

/**
 * 按优先级选出要使用的供应商配置。
 *
 * 优先级（从高到低）：
 * 1. --provider <name> 命令行参数
 * 2. 配置文件中 default: true 的供应商
 * 3. 交互式列表选择
 *
 * @param config           已加载的应用配置
 * @param cliProviderName  命令行传入的供应商名称（可选）
 * @returns 选中的供应商配置
 */
export async function resolveProvider(
  config: AppConfig,
  cliProviderName?: string,
): Promise<ProviderConfig> {
  const { providers } = config;

  // 优先级 1: --provider 指定
  if (cliProviderName) {
    const found = providers.find(p => p.name === cliProviderName);
    if (!found) {
      throw new Error(
        `未找到名为 "${cliProviderName}" 的供应商。可用供应商: ${providers.map(p => p.name).join(', ')}`,
      );
    }
    console.log(`使用指定供应商: ${found.name}`);
    return found;
  }

  // 优先级 2: default 标记
  const defaults = providers.filter(p => p.default);
  if (defaults.length === 1) {
    console.log(`使用默认供应商: ${defaults[0].name}`);
    return defaults[0];
  }

  // 优先级 3: 交互式选择
  if (providers.length === 1) {
    // 只有一个供应商，直接用
    console.log(`使用唯一供应商: ${providers[0].name}`);
    return providers[0];
  }

  return selectInteractively(providers);
}
