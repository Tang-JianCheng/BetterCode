import { spawn } from 'node:child_process';
import { ToolFailure } from '../errors.js';
import {
  createToolError,
  createToolSuccess,
  type JsonObject,
  type Tool,
  type ToolContext,
  type ToolResult,
} from '../types.js';

function appendOutput(current: string, chunk: Buffer, maxBytes: number): string {
  const combined = `${current}${chunk.toString('utf8')}`;
  const bytes = Buffer.byteLength(combined, 'utf8');
  if (bytes <= maxBytes) return combined;
  return Buffer.from(combined, 'utf8').subarray(0, maxBytes).toString('utf8');
}

function formatOutput(stdout: string, stderr: string): string {
  const sections: string[] = [];
  if (stdout) sections.push(`stdout:\n${stdout}`);
  if (stderr) sections.push(`stderr:\n${stderr}`);
  return sections.join('\n');
}

export class RunCommandTool implements Tool {
  readonly name = 'run_command';
  readonly effect = 'side_effect' as const;
  readonly description = '在项目根目录中执行非交互式 shell 命令';
  readonly inputSchema = {
    type: 'object',
    properties: { command: { type: 'string', minLength: 1 } },
    required: ['command'],
    additionalProperties: false,
  };

  async execute(input: JsonObject, context: ToolContext) {
    const command = input.command;
    if (typeof command !== 'string' || !command.trim()) {
      throw new ToolFailure('INVALID_ARGUMENTS', 'command 必须是非空字符串');
    }

    return new Promise<ToolResult>((resolve) => {
      const child = spawn(command, {
        cwd: context.rootDir,
        shell: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;

      const terminate = () => {
        timedOut = true;
        if (child.pid === undefined) return;
        try {
          if (process.platform !== 'win32') {
            process.kill(-child.pid, 'SIGTERM');
          } else {
            child.kill('SIGTERM');
          }
        } catch {
          child.kill('SIGTERM');
        }

        killTimer = setTimeout(() => {
          if (settled || child.pid === undefined) return;
          try {
            if (process.platform !== 'win32') {
              process.kill(-child.pid, 'SIGKILL');
            } else {
              child.kill('SIGKILL');
            }
          } catch {
            // 子进程可能已经退出
          }
        }, 1000);
      };

      const onAbort = () => terminate();
      context.signal.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = appendOutput(stdout, chunk, context.maxOutputBytes);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = appendOutput(stderr, chunk, context.maxOutputBytes);
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        context.signal.removeEventListener('abort', onAbort);
        resolve(createToolError('EXECUTION_ERROR', `命令启动失败: ${error.message}`, {
          cwd: context.rootDir,
          timedOut: false,
        }, formatOutput(stdout, stderr)));
      });
      child.on('close', (code, signal) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        context.signal.removeEventListener('abort', onAbort);

        const output = formatOutput(stdout, stderr);
        const metadata = {
          cwd: context.rootDir,
          exitCode: code,
          signal: signal ?? null,
          timedOut,
          truncated: Buffer.byteLength(stdout, 'utf8') >= context.maxOutputBytes ||
            Buffer.byteLength(stderr, 'utf8') >= context.maxOutputBytes,
        } as const;

        if (timedOut) {
          resolve(createToolError('TIMEOUT', '命令执行超时，进程已终止', metadata, output));
        } else if (code === 0) {
          resolve(createToolSuccess(output, metadata));
        } else {
          resolve(createToolError('EXECUTION_ERROR', `命令退出码为 ${code ?? 'unknown'}`, metadata, output));
        }
      });
    });
  }
}
