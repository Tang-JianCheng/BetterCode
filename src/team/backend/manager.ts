import { TeamError } from '../errors.js';
import type {
  BackendProbeContext,
  BackendSelection,
  TeamBackendRequest,
  TeamMemberBackend,
} from './types.js';

export class TeamBackendManager {
  constructor(private readonly backends: readonly TeamMemberBackend[]) {}

  async select(request: TeamBackendRequest, context: BackendProbeContext): Promise<BackendSelection> {
    const diagnostics: { backend: string; available: boolean; reason?: string }[] = [];
    const candidates = request.kind === 'auto'
      ? this.backends.filter(backend => backend.kind !== 'coroutine')
      : this.backends.filter(backend => backend.kind === request.kind &&
          (request.kind !== 'custom' || !request.name || backend.name === request.name));
    if (candidates.length === 0) {
      throw new TeamError('TEAM_BACKEND_UNAVAILABLE', `未注册成员后端: ${request.kind}`);
    }
    for (const backend of candidates) {
      let probe;
      try {
        probe = await backend.probe(context);
      } catch (error) {
        probe = { available: false, reason: error instanceof Error ? error.message : String(error) };
      }
      diagnostics.push({
        backend: backend.name,
        available: probe.available,
        ...(probe.reason ? { reason: probe.reason } : {}),
      });
      if (probe.available) return { backend, probe, diagnostics };
    }
    throw new TeamError(
      'TEAM_BACKEND_UNAVAILABLE',
      request.kind === 'auto'
        ? '没有可用独立窗格后端；如需协程，请显式指定 backend: coroutine'
        : `指定后端不可用: ${request.kind}`,
      { diagnostics: JSON.stringify(diagnostics) },
    );
  }
}
