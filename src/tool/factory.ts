import { EditFileTool } from './tools/edit-file.js';
import { FindFilesTool } from './tools/find-files.js';
import { ReadFileTool } from './tools/read-file.js';
import { RunCommandTool } from './tools/run-command.js';
import { SearchCodeTool } from './tools/search-code.js';
import { WriteFileTool } from './tools/write-file.js';
import { PathGuard } from './path-guard.js';
import { ToolRegistry } from './registry.js';
import type { ToolRuntimeOptions } from './types.js';

export function createCoreToolRegistry(
  rootDir: string,
  options?: Partial<ToolRuntimeOptions>,
): ToolRegistry {
  const pathGuard = new PathGuard(rootDir);
  const registry = new ToolRegistry(pathGuard.rootDir, options);

  registry.register(new ReadFileTool(pathGuard));
  registry.register(new WriteFileTool(pathGuard));
  registry.register(new EditFileTool(pathGuard));
  registry.register(new RunCommandTool());
  registry.register(new FindFilesTool(pathGuard));
  registry.register(new SearchCodeTool(pathGuard));

  return registry;
}
