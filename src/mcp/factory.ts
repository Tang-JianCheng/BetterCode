import { McpConfigLoader, type McpConfigLoaderOptions } from './config-loader.js';
import { McpManager, type McpManagerOptions } from './manager.js';

export interface McpFactoryOptions extends McpConfigLoaderOptions, McpManagerOptions {}

export function createMcpManager(
  rootDir: string,
  options: McpFactoryOptions = {},
): McpManager {
  const loaded = new McpConfigLoader(rootDir, options).load();
  return new McpManager(rootDir, loaded, options);
}
