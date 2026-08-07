import { createRequire } from 'node:module';
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
  type ToolEffect,
  type ToolRuntimeOptions,
} from './types.js';
import { PathGuard } from './path-guard.js';
import type { ToolExecutionState } from './execution-state.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ToolRegistrationOptions {
  owner?: string;
  system?: boolean;
}

export interface ToolRegistrationSnapshot {
  tool: Tool;
  options: Readonly<ToolRegistrationOptions>;
}

export class ToolRegistry {
  readonly rootDir: string;
  private readonly tools = new Map<string, Tool>();
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly registrations = new Map<string, ToolRegistrationOptions>();
  // 注册 2019-09 与 2020-12 元 schema：外部 MCP 工具 schema 常声明
  // $schema 并 $ref 到这些官方 dialect（如 playwright），否则编译报
  // “no schema with key or ref”。ajv 的 refs 模块是 CJS，用 createRequire 取默认导出。
  private readonly ajv = (() => {
    const instance = new Ajv({ allErrors: true, strict: false });
    try {
      const require = createRequire(import.meta.url);
      type MetaSchemaAdder = (this: Ajv) => Ajv;
      const addMeta = (mod: string) => {
        const adder = require(mod).default as unknown as MetaSchemaAdder;
        adder.call(instance);
      };
      addMeta('ajv/dist/refs/json-schema-2019-09/index.js');
      addMeta('ajv/dist/refs/json-schema-2020-12/index.js');
    } catch {
      // 元 schema 注册失败不致命，仅影响需要这些 dialect 的外部工具。
    }
    return instance;
  })();
  private readonly options: ToolRuntimeOptions;

  constructor(rootDir: string, options: Partial<ToolRuntimeOptions> = {}) {
    const pathGuard = new PathGuard(rootDir);
    this.rootDir = pathGuard.rootDir;
    this.options = {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    };
  }

  register(tool: Tool, options: ToolRegistrationOptions = {}): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具名称重复: ${tool.name}`);
    }
    const validator = this.ajv.compile(tool.inputSchema);
    this.tools.set(tool.name, tool);
    this.validators.set(tool.name, validator);
    this.registrations.set(tool.name, { ...options });
  }

  replaceOwned(owner: string, tools: readonly Tool[]): void {
    if (!owner.trim()) throw new Error('动态工具 owner 不能为空');
    const names = new Set<string>();
    const validators = new Map<string, ValidateFunction>();
    for (const tool of tools) {
      if (names.has(tool.name)) throw new Error(`工具名称重复: ${tool.name}`);
      const existing = this.registrations.get(tool.name);
      if (existing && existing.owner !== owner) throw new Error(`工具名称重复: ${tool.name}`);
      names.add(tool.name);
      validators.set(tool.name, this.ajv.compile(tool.inputSchema));
    }

    for (const [name, registration] of this.registrations) {
      if (registration.owner !== owner) continue;
      this.tools.delete(name);
      this.validators.delete(name);
      this.registrations.delete(name);
    }
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
      this.validators.set(tool.name, validators.get(tool.name)!);
      this.registrations.set(tool.name, { owner });
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(effect?: ToolEffect): ToolDefinition[] {
    return [...this.tools.values()]
      .filter(tool => effect === undefined || tool.effect === effect)
      .map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      }));
  }

  definitionsFor(names: ReadonlySet<string>, effect?: ToolEffect): ToolDefinition[] {
    return [...this.tools.values()]
      .filter(tool => names.has(tool.name))
      .filter(tool => effect === undefined || tool.effect === effect || this.isSystem(tool.name))
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  registrationSnapshot(): readonly ToolRegistrationSnapshot[] {
    return Object.freeze([...this.tools.entries()].map(([name, tool]) => Object.freeze({
      tool,
      options: Object.freeze({ ...(this.registrations.get(name) ?? {}) }),
    })));
  }

  isSystem(name: string): boolean {
    return this.registrations.get(name)?.system === true;
  }

  effectOf(name: string): ToolEffect | undefined {
    return this.tools.get(name)?.effect;
  }

  validate(call: ToolCall): ToolResult | undefined {
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

    return undefined;
  }

  async execute(
    call: ToolCall,
    signal?: AbortSignal,
    executionState?: ToolExecutionState,
  ): Promise<ToolResult> {
    const validationError = this.validate(call);
    if (validationError) return validationError;

    const tool = this.tools.get(call.name)!;

    if (signal?.aborted) {
      return createToolError('CANCELLED', '工具执行已由用户取消');
    }

    const timeoutController = new AbortController();
    const executionSignal = signal
      ? AbortSignal.any([timeoutController.signal, signal])
      : timeoutController.signal;
    let timedOut = false;
    let timeoutResultTimer: NodeJS.Timeout | undefined;
    const timeoutResult = new Promise<ToolResult>(resolve => {
      timeoutResultTimer = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
        resolve(createToolError('TIMEOUT', `工具执行超过 ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);
    });

    let onCancel: (() => void) | undefined;
    const cancellationResult = new Promise<ToolResult>(resolve => {
      if (!signal) return;
      onCancel = () => resolve(createToolError('CANCELLED', '工具执行已由用户取消'));
      signal.addEventListener('abort', onCancel, { once: true });
    });

    const execution = Promise.resolve()
      .then(() => tool.execute(call.arguments, {
        rootDir: this.rootDir,
        signal: executionSignal,
        maxOutputBytes: this.options.maxOutputBytes,
        ...(executionState ? { executionState } : {}),
      }))
      .catch(error => {
        if (signal?.aborted && !timedOut) {
          return createToolError('CANCELLED', '工具执行已由用户取消');
        }
        if (timedOut) {
          return createToolError('TIMEOUT', `工具执行超过 ${this.options.timeoutMs}ms`);
        }
        if (isToolFailure(error)) {
          return createToolError(error.code, error.message, error.metadata, error.output);
        }
        const message = error instanceof Error ? error.message : String(error);
        return createToolError('INTERNAL_ERROR', `工具执行异常: ${message}`);
      });

    try {
      const result = await Promise.race([execution, timeoutResult, cancellationResult]);
      if (signal?.aborted && !timedOut) {
        return limitToolResult(
          createToolError('CANCELLED', '工具执行已由用户取消'),
          this.options.maxOutputBytes,
        );
      }
      if (timedOut) {
        return limitToolResult(
          createToolError('TIMEOUT', `工具执行超过 ${this.options.timeoutMs}ms`),
          this.options.maxOutputBytes,
        );
      }
      return limitToolResult(result, this.options.maxOutputBytes);
    } finally {
      if (timeoutResultTimer) clearTimeout(timeoutResultTimer);
      if (signal && onCancel) signal.removeEventListener('abort', onCancel);
    }
  }
}
