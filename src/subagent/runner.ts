import { AgentLoop } from '../agent/loop.js';
import type { AgentEvent, AgentLoopOptions, AgentOutcome } from '../agent/types.js';
import { ContextManager } from '../context/manager.js';
import type { ContextManagerOptions } from '../context/types.js';
import type { HookManager } from '../hook/manager.js';
import type { PermissionManagerFactory } from '../permission/factory.js';
import type { SkillManager } from '../skill/manager.js';
import { ToolExecutionState } from '../tool/execution-state.js';
import type { ToolRegistry } from '../tool/registry.js';
import { createToolError } from '../tool/types.js';
import {
  buildDefinedAgentSystemPrompt,
  buildDefinedAgentTask,
  buildForkAgentTask,
} from './prompts.js';
import type { SubAgentRunContext, SubAgentRunSpec } from './types.js';

export interface SubAgentRunnerOptions {
  loop?: Partial<AgentLoopOptions>;
  context?: Partial<ContextManagerOptions>;
  hookManager?: () => Pick<HookManager, 'createAgentScope'> | undefined;
  skillManager?: Pick<SkillManager, 'beginExecution' | 'endExecution'>;
}

export class SubAgentRunner {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissionFactory: PermissionManagerFactory,
    private readonly options: SubAgentRunnerOptions = {},
  ) {}

  async run(
    spec: SubAgentRunSpec,
    context: SubAgentRunContext,
    signal: AbortSignal,
    emit: (event: AgentEvent) => void,
  ): Promise<AgentOutcome> {
    const permissionMode = spec.kind === 'defined'
      ? spec.definition.permissionMode
      : spec.permissionMode;
    const permissionManager = this.permissionFactory.create(permissionMode);
    const contextManager = new ContextManager(this.registry.rootDir, this.options.context);
    const executionState = new ToolExecutionState();
    const hookScope = this.options.hookManager?.()?.createAgentScope({
      id: context.taskId,
      kind: spec.kind,
      ...(spec.kind === 'defined' ? { role: spec.definition.name } : {}),
      sessionId: context.sessionId,
      ...(context.parentTurnId ? { parentTurnId: context.parentTurnId } : {}),
      turn: {
        id: context.parentTurnId ?? context.taskId,
        mode: spec.mode,
        task: spec.task,
      },
    });
    this.options.skillManager?.beginExecution();
    const loop = new AgentLoop(
      this.registry,
      permissionManager,
      {
        ...this.options.loop,
        maxIterations: spec.kind === 'defined'
          ? spec.definition.maxIterations
          : spec.maxIterations,
      },
      {},
      contextManager,
      {
        ...(context.trackToolEdit ? { beforeToolExecution: context.trackToolEdit } : {}),
      },
      {
        hooks: hookScope,
        toolExecutionState: executionState,
        ...(spec.kind === 'defined'
          ? {
              visibleToolNames: () => spec.isBackground()
                ? spec.backgroundTools
                : spec.foregroundTools,
            }
          : {}),
        transformToolResult: async input => {
          if (input.result.error?.code !== 'PERMISSION_UNAVAILABLE') return input.result;
          return createToolError(
            'PERMISSION_DENIED',
            '子 Agent 非交互运行，当前工具没有明确的放行规则',
            { ...input.result.metadata, nonInteractive: true },
            input.result.output,
          );
        },
      },
    );

    try {
      if (spec.kind === 'defined') {
        return await loop.execute({
          history: [],
          userMessage: buildDefinedAgentTask(spec.task),
          mode: spec.mode,
          provider: spec.provider,
          signal,
          systemPrompt: buildDefinedAgentSystemPrompt(spec.definition),
        }, emit);
      }
      return await loop.execute({
        history: spec.parentRequest.messages.map(message => structuredClone(message)),
        userMessage: buildForkAgentTask(spec.task),
        mode: spec.mode,
        provider: spec.provider,
        signal,
        systemPrompt: spec.parentRequest.systemPrompt,
        toolDefinitions: spec.toolDefinitions,
      }, emit);
    } finally {
      hookScope?.close();
      executionState.clear();
      await contextManager.close();
      this.options.skillManager?.endExecution();
    }
  }
}
