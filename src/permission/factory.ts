import { PathGuard } from '../tool/path-guard.js';
import type { ToolRegistry } from '../tool/registry.js';
import { PermissionConfigStore } from './config-store.js';
import { PermissionManager } from './manager.js';
import { PermissionRuleEngine } from './rule-engine.js';
import { SandboxPolicy } from './sandbox.js';
import type { PermissionMode } from './types.js';

export interface PermissionFactoryOptions {
  userHome?: string;
}

export interface PermissionManagerFactory {
  create(mode: PermissionMode): PermissionManager;
}

export function createPermissionManager(
  registry: ToolRegistry,
  mode: PermissionMode = 'default',
  options: PermissionFactoryOptions = {},
): PermissionManager {
  const knownTools = new Map(registry.definitions().map(tool => [
    tool.name,
    registry.get(tool.name)!.permission.targetKind,
  ] as const));
  const store = new PermissionConfigStore(registry.rootDir, knownTools, options.userHome);
  const loaded = store.load();
  const rules = new PermissionRuleEngine();
  rules.replaceLayer('user', loaded.rules.user);
  rules.replaceLayer('project', loaded.rules.project);
  rules.replaceLayer('local', loaded.rules.local);
  const sandbox = new SandboxPolicy(new PathGuard(registry.rootDir));
  return new PermissionManager(mode, sandbox, rules, store, loaded.diagnostics);
}

export function createPermissionManagerFactory(
  registry: ToolRegistry,
  options: PermissionFactoryOptions = {},
): PermissionManagerFactory {
  return {
    create: mode => createPermissionManager(registry, mode, options),
  };
}
