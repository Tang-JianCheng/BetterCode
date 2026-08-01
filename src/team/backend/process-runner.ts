import { spawn } from 'node:child_process';
import { TeamError } from '../errors.js';

export interface ProcessRunInput {
  command: string;
  args?: readonly string[];
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  stdin?: string;
}

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export class TeamProcessRunner {
  constructor(
    private readonly defaultTimeoutMs = 30_000,
    private readonly maxOutputBytes = 128 * 1024,
  ) {}

  run(input: ProcessRunInput): Promise<ProcessRunResult> {
    if (!input.command.trim()) return Promise.reject(new TeamError('TEAM_STATE_ERROR', '后端命令不能为空'));
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const child = spawn(input.command, [...(input.args ?? [])], {
        cwd: input.cwd,
        env: input.environment ?? process.env,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let settled = false;
      let escalationTimer: NodeJS.Timeout | undefined;
      const append = (target: Buffer[], chunk: Buffer, current: number): number => {
        const next = current + chunk.length;
        if (current < this.maxOutputBytes) target.push(chunk.subarray(0, this.maxOutputBytes - current));
        return next;
      };
      const terminate = (signal: NodeJS.Signals) => {
        if (child.pid === undefined) return;
        try {
          if (process.platform !== 'win32') process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          child.kill(signal);
        }
      };
      const finish = (result?: ProcessRunResult, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (escalationTimer) clearTimeout(escalationTimer);
        input.signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(result!);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        terminate('SIGTERM');
        escalationTimer = setTimeout(() => terminate('SIGKILL'), 1_000);
        escalationTimer.unref();
      }, input.timeoutMs ?? this.defaultTimeoutMs);
      const onAbort = () => terminate('SIGTERM');
      input.signal?.addEventListener('abort', onAbort, { once: true });
      if (input.signal?.aborted) onAbort();
      child.stdout.on('data', (chunk: Buffer) => { stdoutBytes = append(stdout, chunk, stdoutBytes); });
      child.stderr.on('data', (chunk: Buffer) => { stderrBytes = append(stderr, chunk, stderrBytes); });
      child.on('error', error => finish(undefined, error));
      child.on('close', (code, signal) => finish({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: code,
        signal,
        timedOut,
        truncated: stdoutBytes > this.maxOutputBytes || stderrBytes > this.maxOutputBytes,
        durationMs: Date.now() - startedAt,
      }));
      child.stdin.on('error', () => {});
      child.stdin.end(input.stdin);
    });
  }
}
