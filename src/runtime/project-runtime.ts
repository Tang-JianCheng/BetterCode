import path from 'node:path';
import { ContextManager } from '../context/manager.js';
import type { ContextManagerOptions } from '../context/types.js';
import { loadInstructions } from '../memory/instructions.js';
import { MemoryManager } from '../memory/manager.js';
import type { PermissionManager } from '../permission/manager.js';
import type { PermissionManagerFactory } from '../permission/factory.js';
import type { PermissionMode } from '../permission/types.js';
import type { SupplementalPromptContent } from '../prompt/types.js';
import { ToolExecutionState } from '../tool/execution-state.js';
import { createScopedToolRegistry } from '../tool/factory.js';
import type { ToolRegistry } from '../tool/registry.js';

export interface ProjectRuntimeScope {
  rootDir: string;
  registry: ToolRegistry;
  permissionManager: PermissionManager;
  contextManager: ContextManager;
  executionState: ToolExecutionState;
  supplemental: SupplementalPromptContent;
  close(): Promise<void>;
}

export interface ProjectRuntimeFactoryOptions {
  context?: Partial<ContextManagerOptions>;
  userHome?: string;
}

export class ProjectRuntimeFactory {
  constructor(
    private readonly sourceRegistry: ToolRegistry,
    private readonly permissionFactory: PermissionManagerFactory,
    private readonly options: ProjectRuntimeFactoryOptions = {},
  ) {}

  create(rootDir: string, permissionMode: PermissionMode): ProjectRuntimeScope {
    const absoluteRoot = path.resolve(rootDir);
    const registry = absoluteRoot === this.sourceRegistry.rootDir
      ? this.sourceRegistry
      : createScopedToolRegistry(absoluteRoot, this.sourceRegistry);
    const contextManager = new ContextManager(absoluteRoot, this.options.context);
    const executionState = new ToolExecutionState();
    const memory = new MemoryManager(absoluteRoot, { userHome: this.options.userHome });
    let closed = false;
    return {
      rootDir: absoluteRoot,
      registry,
      permissionManager: this.permissionFactory.create(permissionMode, registry),
      contextManager,
      executionState,
      supplemental: {
        customInstructions: loadInstructions(absoluteRoot, { userHome: this.options.userHome }),
        longTermMemory: memory.buildSystemReminder(),
      },
      close: async () => {
        if (closed) return;
        closed = true;
        executionState.clear();
        await contextManager.close();
      },
    };
  }
}
