import type { ToolResult } from '../tool/types.js';

export type PermissionMode = 'strict' | 'default' | 'allow';
export type PermissionEffect = 'allow' | 'deny';
export type PermissionRuleLayer = 'user' | 'project' | 'local' | 'session';
export type PermissionPatternKind = 'tool' | 'glob' | 'exact';
export type PermissionRisk = 'read' | 'write' | 'execute';

export interface RawPermissionRule {
  effect: PermissionEffect;
  expression: string;
}

export interface PermissionRule {
  effect: PermissionEffect;
  expression: string;
  toolName: string;
  pattern?: string;
  patternKind: PermissionPatternKind;
  layer: PermissionRuleLayer;
  order: number;
  literalLength: number;
  matches(target: string): boolean;
}

export interface RuleMatch {
  effect: PermissionEffect;
  rule: PermissionRule;
}

export interface PermissionDiagnostic {
  layer: Exclude<PermissionRuleLayer, 'session'>;
  file: string;
  message: string;
}

export interface PermissionStatus {
  mode: PermissionMode;
  ruleCounts: Readonly<Record<PermissionRuleLayer, number>>;
  diagnostics: readonly PermissionDiagnostic[];
}

export type PermissionChoice =
  | 'deny'
  | 'allow_once'
  | 'allow_session'
  | 'allow_permanent';

export interface PermissionRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  target: string;
  proposedRule: string;
  risk: PermissionRisk;
  projectRoot: string;
}

export type PermissionDecider = (
  request: PermissionRequest,
  signal: AbortSignal,
) => Promise<PermissionChoice>;

export type PermissionDecisionSource =
  | 'blacklist'
  | 'sandbox'
  | 'session_rule'
  | 'local_rule'
  | 'project_rule'
  | 'user_rule'
  | 'mode'
  | 'user';

export type PermissionAuthorization =
  | {
      allowed: true;
      source: PermissionDecisionSource;
      requestId?: string;
      choice?: PermissionChoice;
    }
  | {
      allowed: false;
      source: PermissionDecisionSource;
      result: ToolResult;
      requestId?: string;
      choice?: PermissionChoice;
    };

export interface PermissionAuthorizeOptions {
  signal: AbortSignal;
  decider?: PermissionDecider;
  onRequest: (request: PermissionRequest) => void;
}

export interface PermissionSubject {
  target: string;
}
