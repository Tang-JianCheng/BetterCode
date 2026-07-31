import { AgentLoop } from '../agent/loop.js';
import type { AgentEvent, AgentLoopOptions, AgentOutcome } from '../agent/types.js';
import type { ContextManagerOptions } from '../context/types.js';
import type { HookManager } from '../hook/manager.js';
import type { ScopedHookRuntime } from '../hook/types.js';
import type { PermissionManagerFactory } from '../permission/factory.js';
import type { SkillManager } from '../skill/manager.js';
import type { ToolRegistry } from '../tool/registry.js';
import { ProjectRuntimeFactory } from '../runtime/project-runtime.js';
import type { WorktreeManager } from '../worktree/manager.js';
import type { WorktreeLease } from '../worktree/types.js';
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
  projectRuntimeFactory?: ProjectRuntimeFactory;
  worktreeManager?: WorktreeManager;
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
    const runtimeFactory = this.options.projectRuntimeFactory ?? new ProjectRuntimeFactory(
      this.registry,
      this.permissionFactory,
      { context: this.options.context },
    );
    let lease: WorktreeLease | undefined;
    let runtime: ReturnType<ProjectRuntimeFactory['create']> | undefined;
    let hookScope: ScopedHookRuntime | undefined;
    let skillStarted = false;
    try {
      if (spec.kind === 'defined' && spec.definition.isolation === 'worktree') {
        const manager = this.options.worktreeManager;
        const name = `${spec.definition.name}/${context.taskId}`;
        if (!manager) {
          context.updateWorktree?.({ isolation: 'worktree', name, state: 'failed', reasons: ['当前项目不可用 Git Worktree'] });
          throw new Error('当前项目不可用 Git Worktree 隔离');
        }
        try {
          lease = await manager.acquire(name);
          context.updateWorktree?.({
            isolation: 'worktree',
            name,
            path: lease.cwd,
            branch: lease.branch,
            baseCommit: lease.baseCommit,
            state: 'active',
          });
        } catch (error) {
          context.updateWorktree?.({
            isolation: 'worktree',
            name,
            state: 'failed',
            reasons: [error instanceof Error ? error.message : String(error)],
          });
          throw error;
        }
      }
      runtime = runtimeFactory.create(lease?.cwd ?? this.registry.rootDir, permissionMode);
      hookScope = this.options.hookManager?.()?.createAgentScope({
        id: context.taskId,
        kind: spec.kind,
        ...(spec.kind === 'defined' ? { role: spec.definition.name } : {}),
        sessionId: context.sessionId,
        ...(context.parentTurnId ? { parentTurnId: context.parentTurnId } : {}),
        projectRoot: runtime.rootDir,
        turn: {
          id: context.parentTurnId ?? context.taskId,
          mode: spec.mode,
          task: spec.task,
        },
      });
      this.options.skillManager?.beginExecution();
      skillStarted = true;
      const loop = new AgentLoop(
        runtime.registry,
        runtime.permissionManager,
        {
          ...this.options.loop,
          maxIterations: spec.kind === 'defined'
            ? spec.definition.maxIterations
            : spec.maxIterations,
        },
        runtime.supplemental,
        runtime.contextManager,
        {
          ...(context.trackToolEdit ? { beforeToolExecution: context.trackToolEdit } : {}),
        },
        {
          hooks: hookScope,
          toolExecutionState: runtime.executionState,
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
      if (spec.kind === 'defined') {
        return await loop.execute({
          history: [],
          userMessage: buildDefinedAgentTask(spec.task),
          mode: spec.mode,
          provider: spec.provider,
          signal,
          systemPrompt: buildDefinedAgentSystemPrompt(spec.definition, lease ? {
            cwd: lease.cwd,
            branch: lease.branch,
            baseCommit: lease.baseCommit,
          } : undefined),
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
      if (skillStarted) this.options.skillManager?.endExecution();
      await runtime?.close();
      if (lease && this.options.worktreeManager) {
        try {
          const result = await this.options.worktreeManager.finalize(lease.leaseId);
          if (result.status === 'deleted') {
            context.updateWorktree?.({
              isolation: 'worktree',
              name: lease.name,
              path: lease.cwd,
              branch: lease.branch,
              baseCommit: lease.baseCommit,
              state: 'deleted',
            });
          } else if (result.status === 'retained') {
            context.updateWorktree?.({
              isolation: 'worktree',
              name: lease.name,
              path: lease.cwd,
              branch: lease.branch,
              baseCommit: lease.baseCommit,
              state: 'retained',
              reasons: result.reasons,
            });
          }
        } catch (error) {
          context.updateWorktree?.({
            isolation: 'worktree',
            name: lease.name,
            path: lease.cwd,
            branch: lease.branch,
            baseCommit: lease.baseCommit,
            state: 'failed',
            reasons: [error instanceof Error ? error.message : String(error)],
          });
        }
      }
    }
  }
}
