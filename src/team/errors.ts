export type TeamErrorCode =
  | 'TEAM_INVALID_NAME'
  | 'TEAM_PATH_OUTSIDE_ROOT'
  | 'TEAM_NOT_FOUND'
  | 'TEAM_ALREADY_EXISTS'
  | 'TEAM_ARCHIVED'
  | 'TEAM_REPOSITORY_MISMATCH'
  | 'TEAM_CONFLICT'
  | 'TEAM_LOCK_TIMEOUT'
  | 'TEAM_STATE_ERROR'
  | 'TEAM_MEMBER_NOT_FOUND'
  | 'TEAM_TASK_NOT_FOUND'
  | 'TEAM_APPROVAL_REQUIRED'
  | 'TEAM_BACKEND_UNAVAILABLE'
  | 'TEAM_INTEGRATION_ERROR'
  | 'TEAM_DATA_CORRUPT';

export interface TeamDiagnostic {
  code: TeamErrorCode;
  message: string;
  source?: string;
  timestamp: string;
}

export class TeamError extends Error {
  constructor(
    readonly code: TeamErrorCode,
    message: string,
    readonly details: Record<string, string | number | boolean | null> = {},
  ) {
    super(message);
    this.name = 'TeamError';
  }
}

export function teamDiagnostic(
  code: TeamErrorCode,
  message: string,
  source?: string,
): TeamDiagnostic {
  return {
    code,
    message: message.slice(0, 1000),
    ...(source ? { source } : {}),
    timestamp: new Date().toISOString(),
  };
}
