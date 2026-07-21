import { Ajv, type ValidateFunction } from 'ajv';
import { isToolFailure } from './errors.js';
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  limitToolResult,
} from './output-limit.js';
import {
  createToolError,
  type Tool,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  type ToolRuntimeOptions,
} from './types.js';
import { PathGuard } from './path-guard.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class ToolRegistry {
  readonly rootDir: string;
  private readonly tools = new Map<string, Tool>();
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly ajv = new Ajv({ allErrors: true, strict: false });
  private readonly options: ToolRuntimeOptions;

  constructor(rootDir: string, options: Partial<ToolRuntimeOptions> = {}) {
    const pathGuard = new PathGuard(rootDir);
    this.rootDir = pathGuard.rootDir;
    this.options = {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    };
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具名称重复: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    this.validators.set(tool.name, this.ajv.compile(tool.inputSchema));
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return createToolError('TOOL_NOT_FOUND', `未找到工具: ${call.name}`);
    }

    const validate = this.validators.get(call.name);
    if (!validate || !validate(call.arguments)) {
      return createToolError(
        'INVALID_ARGUMENTS',
        `工具参数无效: ${this.ajv.errorsText(validate?.errors)}`,
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    let timeoutResultTimer: NodeJS.Timeout | undefined;
    const timeoutResult = new Promise<ToolResult>(resolve => {
      timeoutResultTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve(createToolError('TIMEOUT', `工具执行超过 ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);
    });

    const execution = Promise.resolve()
      .then(() => tool.execute(call.arguments, {
        rootDir: this.rootDir,
        signal: controller.signal,
        maxOutputBytes: this.options.maxOutputBytes,
      }))
      .catch(error => {
        if (isToolFailure(error)) {
          return createToolError(error.code, error.message, error.metadata, error.output);
        }
        const message = error instanceof Error ? error.message : String(error);
        return createToolError('INTERNAL_ERROR', `工具执行异常: ${message}`);
      });

    try {
      const result = await Promise.race([execution, timeoutResult]);
      if (timedOut) {
        return limitToolResult(
          createToolError('TIMEOUT', `工具执行超过 ${this.options.timeoutMs}ms`),
          this.options.maxOutputBytes,
        );
      }
      return limitToolResult(result, this.options.maxOutputBytes);
    } finally {
      if (timeoutResultTimer) clearTimeout(timeoutResultTimer);
    }
  }
}
