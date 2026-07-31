import type { AgentMode } from '../agent/types.js';

export type SystemSectionId =
  | 'identity'
  | 'system_constraints'
  | 'task_mode'
  | 'action_execution'
  | 'tool_usage'
  | 'tone_style'
  | 'text_output';

export interface PromptSection {
  id: SystemSectionId | string;
  priority: number;
  title: string;
  content: string;
}

export interface EnvironmentContext {
  projectRoot: string;
  currentDirectory: string;
  platform: string;
  shell: string;
  currentDate: string;
  timezone: string;
  mode: AgentMode;
}

export interface ActivatedSkill {
  name: string;
  content: string;
}

export interface AvailableSkill {
  name: string;
  description: string;
}

export interface SupplementalPromptContent {
  hookInstructions?: string;
  customInstructions?: string;
  availableSkills?: readonly AvailableSkill[];
  activeSkills?: readonly ActivatedSkill[];
  longTermMemory?: string;
}

export interface EnvironmentSource {
  cwd(): string;
  platform(): string;
  shell(): string;
  now(): Date;
  timezone(): string;
}

export interface ReminderInput {
  environment: EnvironmentContext;
  iteration: number;
  supplemental?: SupplementalPromptContent;
}
