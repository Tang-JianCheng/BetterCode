import type { AgentMode } from '../agent/types.js';
import type { PermissionMode } from '../permission/types.js';
import type { TokenUsage } from '../provider/types.js';
import type { CommandRegistry } from './registry.js';

export type CommandType = 'local' | 'ui' | 'prompt';

export interface CommandUIController {
  showMessage(content: string): void;
  sendUserMessage(content: string, displayText?: string): Promise<void>;
  runSkill(name: string, args: string, displayText: string): Promise<void>;
  setAgentMode(mode: AgentMode): void;
  getAgentMode(): AgentMode;
  getTokenUsage(): TokenUsage | undefined;
  refreshStatus(): void;
  clearConversation(): Promise<void>;
  compactConversation(): Promise<void>;
  showOrResumeSession(sessionId?: string): Promise<void>;
  showMemoryStatus(): void;
  showOrSetPermission(mode?: PermissionMode): void;
  showStatus(): void;
  rewindConversation(): void;
  exit(): void;
}

export interface ParsedCommand {
  raw: string;
  name: string;
  args: string;
}

export interface CommandInvocation extends ParsedCommand {
  definition: CommandDefinition;
  registry: CommandRegistry;
  ui: CommandUIController;
}

export interface CommandDefinition {
  name: string;
  aliases: readonly string[];
  description: string;
  usage: string;
  type: CommandType;
  argumentHint?: string;
  hidden?: boolean;
  handler(invocation: CommandInvocation): void | Promise<void>;
}

export type CommandParseResult =
  | { status: 'empty' }
  | { status: 'not_command' }
  | { status: 'command'; command: ParsedCommand };

export type DispatchResult =
  | { status: 'not_command' }
  | { status: 'handled'; command: string }
  | { status: 'unknown'; command: string };

export interface CommandCompletion {
  name: string;
  value: string;
  label: string;
  description: string;
}
