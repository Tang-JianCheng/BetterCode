import { parseCommandInput } from './parser.js';
import { CommandRegistry } from './registry.js';
import type {
  CommandUIController,
  DispatchResult,
} from './types.js';

export class CommandDispatcher {
  constructor(private readonly registry: CommandRegistry) {}

  async dispatch(input: string, ui: CommandUIController): Promise<DispatchResult> {
    const parsed = parseCommandInput(input);
    if (parsed.status !== 'command') return { status: 'not_command' };
    const definition = this.registry.get(parsed.command.name);
    if (!definition) {
      const shown = parsed.command.name ? `/${parsed.command.name}` : '/';
      ui.showMessage(`未知命令: ${shown}。使用 /help 查看可用命令。`);
      return { status: 'unknown', command: parsed.command.name };
    }
    try {
      await definition.handler({
        ...parsed.command,
        definition,
        registry: this.registry,
        ui,
      });
    } catch (error) {
      ui.showMessage(
        `命令 /${definition.name} 执行失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { status: 'handled', command: definition.name };
  }
}
