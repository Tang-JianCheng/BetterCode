import { spawn } from 'node:child_process';
import { stableStringifyJson } from '../tool/stable-json.js';
import {
  createToolError,
  createToolSuccess,
  type JsonObject,
  type JsonSchema,
  type Tool,
  type ToolContext,
  type ToolEffect,
  type ToolPermissionProfile,
  type ToolResult,
  type ToolResultMetadata,
} from '../tool/types.js';

const MAX_DIAGNOSTIC_BYTES = 16 * 1024;

function metadata(value: unknown): ToolResultMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: ToolResultMetadata = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      result[key] = item;
    }
  }
  return result;
}

export class SkillScriptTool implements Tool {
  constructor(
    readonly name: string,
    readonly description: string,
    readonly inputSchema: JsonSchema,
    readonly effect: ToolEffect,
    readonly permission: ToolPermissionProfile,
    private readonly scriptPath: string,
  ) {}

  execute(input: JsonObject, context: ToolContext): Promise<ToolResult> {
    if (context.signal.aborted) return Promise.resolve(createToolError('CANCELLED', '工具执行已由用户取消'));
    return new Promise(resolve => {
      const child = spawn(process.execPath, [this.scriptPath], {
        cwd: context.rootDir,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const finish = (result: ToolResult) => {
        if (settled) return;
        settled = true;
        context.signal.removeEventListener('abort', cancel);
        resolve(result);
      };
      const cancel = () => {
        child.kill('SIGTERM');
        finish(createToolError('CANCELLED', '工具执行已由用户取消'));
      };
      context.signal.addEventListener('abort', cancel, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes <= context.maxOutputBytes) stdout.push(chunk);
        else child.kill('SIGTERM');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= MAX_DIAGNOSTIC_BYTES) stderr.push(chunk);
      });
      child.stdin.on('error', () => {});
      child.on('error', error => finish(createToolError('EXECUTION_ERROR', `专属工具进程启动失败: ${error.message}`)));
      child.on('close', code => {
        if (settled) return;
        if (stdoutBytes > context.maxOutputBytes) {
          finish(createToolError('EXECUTION_ERROR', '专属工具 stdout 超过输出限制'));
          return;
        }
        const diagnostic = Buffer.concat(stderr).toString('utf8').trim();
        if (code !== 0) {
          finish(createToolError(
            'EXECUTION_ERROR',
            `专属工具进程退出码 ${code}${diagnostic ? `: ${diagnostic}` : ''}`,
          ));
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(stdout).toString('utf8'));
        } catch {
          finish(createToolError('EXECUTION_ERROR', '专属工具 stdout 不是有效 JSON'));
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          finish(createToolError('EXECUTION_ERROR', '专属工具结果必须是对象'));
          return;
        }
        const value = parsed as Record<string, unknown>;
        const output = typeof value.output === 'string' ? value.output : '';
        if (value.ok === true) {
          finish(createToolSuccess(output, metadata(value.metadata)));
          return;
        }
        const error = value.error;
        const message = error && typeof error === 'object' && !Array.isArray(error) &&
          typeof (error as Record<string, unknown>).message === 'string'
          ? String((error as Record<string, unknown>).message)
          : '专属工具执行失败';
        finish(createToolError('EXECUTION_ERROR', message, metadata(value.metadata), output));
      });

      child.stdin.end(stableStringifyJson(input));
    });
  }
}
