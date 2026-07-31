import { spawn } from 'node:child_process';
import { stableStringifyJson } from '../tool/stable-json.js';
import type { HookActionResult, HookEventContext } from './types.js';

const MAX_OUTPUT_BYTES = 64 * 1024;

function appendBounded(current: string, chunk: Buffer): { value: string; truncated: boolean } {
  const combined = `${current}${chunk.toString('utf8')}`;
  if (Buffer.byteLength(combined, 'utf8') <= MAX_OUTPUT_BYTES) {
    return { value: combined, truncated: false };
  }
  return {
    value: Buffer.from(combined, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8'),
    truncated: true,
  };
}

function terminateProcess(child: ReturnType<typeof spawn>): NodeJS.Timeout | undefined {
  if (child.pid === undefined) return undefined;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  return setTimeout(() => {
    if (child.exitCode !== null || child.pid === undefined) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, 1000);
}

export async function executeHookCommand(input: {
  command: string;
  rootDir: string;
  context: HookEventContext;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<HookActionResult> {
  if (input.signal.aborted) {
    return { status: 'failed', code: 'COMMAND_CANCELLED', message: 'Hook 命令已取消' };
  }
  return new Promise(resolve => {
    const child = spawn(input.command, {
      cwd: input.rootDir,
      shell: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (result: HookActionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      input.signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const stop = () => {
      if (!killTimer) killTimer = terminateProcess(child);
    };
    const onAbort = () => stop();
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);

    input.signal.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      const next = appendBounded(stdout, chunk);
      stdout = next.value;
      truncated ||= next.truncated;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const next = appendBounded(stderr, chunk);
      stderr = next.value;
      truncated ||= next.truncated;
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(stableStringifyJson(input.context));
    child.on('error', error => {
      finish({ status: 'failed', code: 'COMMAND_FAILED', message: `Hook 命令启动失败: ${error.message}` });
    });
    child.on('close', code => {
      if (input.signal.aborted) {
        finish({ status: 'failed', code: 'COMMAND_CANCELLED', message: 'Hook 命令已取消' });
      } else if (timedOut) {
        finish({ status: 'failed', code: 'COMMAND_TIMEOUT', message: `Hook 命令超过 ${input.timeoutMs}ms` });
      } else if (code !== 0) {
        finish({ status: 'failed', code: 'COMMAND_FAILED', message: `Hook 命令退出码为 ${code ?? 'unknown'}` });
      } else {
        finish({ status: 'success', output: stdout, truncated });
      }
    });
  });
}
