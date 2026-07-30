import type { Tool } from '../tool/types.js';

export type SkillScope = 'builtin' | 'user' | 'project';
export type SkillExecutionMode = 'shared' | 'isolated';

export interface SkillMetadata {
  name: string;
  description: string;
  tools: readonly string[];
  mode: SkillExecutionMode;
  history: number;
  model?: string;
}

export interface SkillDefinition extends SkillMetadata {
  scope: SkillScope;
  entryPath: string;
  directory: string;
  body: string;
  dedicatedTools: readonly Tool[];
}

export interface SkillDiagnostic {
  scope: SkillScope;
  file: string;
  name?: string;
  code: string;
  message: string;
}

export interface LoadedSkills {
  skills: Map<string, SkillDefinition>;
  disabledNames: Set<string>;
  diagnostics: SkillDiagnostic[];
}

export interface ActiveSkill {
  name: string;
  args: string;
  content: string;
  tools: readonly string[];
  activatedAt: number;
}

export interface SkillSnapshot {
  revision: number;
  skills: ReadonlyMap<string, SkillDefinition>;
  disabledNames: ReadonlySet<string>;
  diagnostics: readonly SkillDiagnostic[];
  dedicatedToolNames: ReadonlySet<string>;
}

export interface SkillVisibility {
  names: ReadonlySet<string>;
  restricted: boolean;
}

export interface SkillExecutionScope {
  name: string;
  args: string;
}

export type SkillLoadResolution =
  | { status: 'shared'; skill: SkillDefinition; active: ActiveSkill }
  | { status: 'isolated'; skill: SkillDefinition; args: string };

export interface SkillProviderResolver<T> {
  has(name: string): boolean;
  resolve(name: string): T;
}
