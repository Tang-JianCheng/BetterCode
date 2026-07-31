import type { ToolDefinition } from '../tool/types.js';
import type { AgentDefinition } from './types.js';

export interface SubAgentToolSnapshot {
  foreground: ReadonlySet<string>;
  background: ReadonlySet<string>;
}

export function resolveDefinedToolSnapshot(input: {
  registryNames: readonly string[];
  definition: AgentDefinition;
  deniedTools: ReadonlySet<string>;
}): SubAgentToolSnapshot {
  const allowed = input.definition.tools === undefined
    ? new Set(input.registryNames)
    : new Set(input.definition.tools);
  const disallowed = new Set([...input.deniedTools, ...input.definition.disallowedTools]);
  const foreground = new Set(input.registryNames.filter(name => allowed.has(name) && !disallowed.has(name)));
  const backgroundAllow = new Set(input.definition.backgroundTools);
  const background = new Set([...foreground].filter(name => backgroundAllow.has(name)));
  return { foreground, background };
}

export function resolveForkToolDefinitions(input: {
  parentTools: readonly ToolDefinition[];
  deniedTools: ReadonlySet<string>;
}): readonly ToolDefinition[] {
  return input.parentTools
    .filter(tool => !input.deniedTools.has(tool.name))
    .map(tool => ({ ...tool, inputSchema: structuredClone(tool.inputSchema) }));
}
