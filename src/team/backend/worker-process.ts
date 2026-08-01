import { TeamError } from '../errors.js';

export function buildWorkerProcessArgs(workerDescriptor: string): string[] {
  const entry = process.argv[1];
  if (!entry) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', '无法确定 BetterCode Worker 入口');
  return [...process.execArgv, entry, '--team-worker', workerDescriptor];
}
