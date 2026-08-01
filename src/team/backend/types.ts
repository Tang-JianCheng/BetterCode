import type { TeamBackendKind, TeamMemberRecord } from '../types.js';

export interface BackendProbeContext {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  workerDescriptor: string;
}

export interface BackendProbeResult {
  available: boolean;
  reason?: string;
  details?: Record<string, string | number | boolean>;
}

export interface BackendInstance {
  kind: TeamBackendKind;
  id: string;
  paneId?: string;
  backendName?: string;
}

export interface SpawnMemberInput {
  member: TeamMemberRecord;
  context: BackendProbeContext;
}

export interface TerminateResult {
  stopped: boolean;
  forced: boolean;
  uncertain: boolean;
  message?: string;
}

export interface TeamMemberBackend {
  readonly kind: TeamBackendKind;
  readonly name: string;
  probe(context: BackendProbeContext): Promise<BackendProbeResult>;
  spawn(input: SpawnMemberInput): Promise<BackendInstance>;
  wake(instance: BackendInstance): Promise<void>;
  terminate(instance: BackendInstance, signal: AbortSignal): Promise<TerminateResult>;
  recover?(instance: BackendInstance): Promise<BackendInstance | undefined>;
}

export type TeamBackendRequest =
  | { kind: 'auto' }
  | { kind: TeamBackendKind; name?: string };

export interface BackendSelection {
  backend: TeamMemberBackend;
  probe: BackendProbeResult;
  diagnostics: readonly { backend: string; available: boolean; reason?: string }[];
}
