import { ToolRegistry } from '../tool/registry.js';
import type { PermissionManager } from '../permission/manager.js';
import type { PermissionDecider } from '../permission/types.js';
import {
  createToolError,
  type ToolCall,
  type ToolExecutionObserver,
  type ToolExecutionPolicy,
  type ToolResult,
} from '../tool/types.js';
import type { AgentEvent, AgentMode } from './types.js';
import type { HookRuntime } from '../hook/types.js';
import type { ToolExecutionState } from '../tool/execution-state.js';
import path from 'node:path';
import { realpathSync } from 'node:fs';

export interface ScheduledToolResult {
  call: ToolCall;
  result: ToolResult;
  executed: boolean;
}

export interface ToolBatchResult {
  results: ScheduledToolResult[];
  unknownToolStreak: number;
  unknownToolLimitReached: boolean;
  cancelled: boolean;
}

export interface ToolScheduleOptions {
  mode: AgentMode;
  initialUnknownToolStreak: number;
  unknownToolLimit: number;
  maxIterations?: number;
  signal: AbortSignal;
  permissionDecider?: PermissionDecider;
  onProgress: (event: AgentEvent) => void;
  onBeforeExecute?: (call: ToolCall) => void;
  allowedToolNames?: ReadonlySet<string>;
}

interface IndexedCall {
  index: number;
  call: ToolCall;
}

const cancelledResult = (message: string): ToolResult =>
  createToolError('CANCELLED', message, { cancelled: true });

export class ToolScheduler {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissionManager: PermissionManager,
    private readonly hooks?: HookRuntime,
    private readonly executionState?: ToolExecutionState,
    private readonly policy?: ToolExecutionPolicy,
    private readonly observer?: ToolExecutionObserver,
  ) {}

  async executeBatch(
    calls: ToolCall[],
    iteration: number,
    options: ToolScheduleOptions,
  ): Promise<ToolBatchResult> {
    const results = new Map<number, ToolResult>();
    const readOnly: IndexedCall[] = [];
    const sideEffects: IndexedCall[] = [];
    const executedIndices = new Set<number>();
    let unknownToolStreak = options.initialUnknownToolStreak;
    let unknownToolLimitReached = false;

    for (const [index, call] of calls.entries()) {
      if (unknownToolLimitReached) {
        results.set(index, cancelledResult('连续未知工具已达到上限，未执行该调用'));
        continue;
      }

      const tool = this.registry.get(call.name);
      if (!tool) {
        results.set(index, createToolError('TOOL_NOT_FOUND', `未找到工具: ${call.name}`));
        unknownToolStreak += 1;
      } else if (options.allowedToolNames && !options.allowedToolNames.has(call.name)) {
        results.set(index, createToolError(
          'TOOL_UNAVAILABLE',
          `当前 Skill 工具白名单不允许使用: ${call.name}`,
        ));
        unknownToolStreak = 0;
      } else if (options.mode === 'plan' && tool.effect === 'side_effect') {
        results.set(index, createToolError(
          'TOOL_UNAVAILABLE',
          `Plan Mode 不允许使用工具: ${call.name}`,
        ));
        unknownToolStreak += 1;
      } else {
        unknownToolStreak = 0;
        const validationError = this.registry.validate(call);
        if (validationError) {
          results.set(index, validationError);
        } else {
          const policyResult = await this.policy?.authorize({
            call,
            tool,
            mode: options.mode,
            iteration,
            rootDir: this.registry.rootDir,
            signal: options.signal,
          });
          if (policyResult) {
            results.set(index, policyResult);
            continue;
          }
          const hookResult = await this.hooks?.beforeToolUse(call, options.signal);
          if (hookResult?.denied) {
            results.set(index, createToolError('HOOK_DENIED', hookResult.denied.reason, {
              hookLayer: hookResult.denied.source.layer,
              hookRule: hookResult.denied.source.index + 1,
            }));
            continue;
          }
          if (this.registry.isSystem(call.name)) {
            (tool.effect === 'read_only' ? readOnly : sideEffects).push({ index, call });
            continue;
          }
          options.onProgress({
            type: 'progress',
            iteration,
            maxIterations: options.maxIterations,
            stage: 'checking_permissions',
            toolName: call.name,
            toolCallId: call.id,
          });
          const authorization = await this.permissionManager.authorize(call, tool, {
            signal: options.signal,
            decider: options.permissionDecider,
            onRequest: request => {
              options.onProgress({ type: 'permission_request', iteration, request });
              options.onProgress({
                type: 'progress',
                iteration,
                maxIterations: options.maxIterations,
                stage: 'waiting_permission',
                toolName: call.name,
                toolCallId: call.id,
              });
            },
          });
          options.onProgress({
            type: 'permission_decision',
            iteration,
            ...(authorization.requestId ? { requestId: authorization.requestId } : {}),
            toolCallId: call.id,
            toolName: call.name,
            allowed: authorization.allowed,
            source: authorization.source,
            ...('choice' in authorization && authorization.choice
              ? { choice: authorization.choice }
              : {}),
          });
          if (authorization.allowed) {
            (tool.effect === 'read_only' ? readOnly : sideEffects).push({ index, call });
          } else {
            results.set(index, authorization.result);
          }
        }
      }

      if (unknownToolStreak >= options.unknownToolLimit) {
        unknownToolLimitReached = true;
      }
    }

    const execute = async ({ index, call }: IndexedCall): Promise<void> => {
      if (options.signal.aborted) {
        results.set(index, cancelledResult('工具执行已由用户取消'));
        return;
      }
      options.onProgress({
        type: 'progress',
        iteration,
        maxIterations: options.maxIterations,
        stage: 'executing_tools',
        toolName: call.name,
        toolCallId: call.id,
      });
      try {
        options.onBeforeExecute?.(call);
      } catch {
        // 快照失败不能阻断已获授权的工具调用。
      }
      const tool = this.registry.get(call.name)!;
      const observation = {
        call,
        tool,
        mode: options.mode,
        iteration,
        rootDir: this.registry.rootDir,
        signal: options.signal,
      };
      try {
        await this.observer?.beforeExecute(observation);
      } catch (error) {
        results.set(index, createToolError(
          'TEAM_STATE_ERROR',
          `工具执行前状态持久化失败: ${error instanceof Error ? error.message : String(error)}`,
        ));
        return;
      }
      executedIndices.add(index);
      let result = await this.registry.execute(call, options.signal, this.executionState);
      try {
        await this.observer?.afterExecute({ ...observation, result });
      } catch (error) {
        result = createToolError(
          'TEAM_STATE_ERROR',
          `工具执行结果持久化失败: ${error instanceof Error ? error.message : String(error)}`,
          { originalOk: result.ok },
          result.output,
        );
      }
      results.set(index, result);
      if (result.ok && this.registry.effectOf(call.name) === 'side_effect') {
        const filePath = call.arguments.path;
        if ((call.name === 'write_file' || call.name === 'edit_file') && typeof filePath === 'string') {
          const absolute = path.resolve(this.registry.rootDir, filePath);
          try {
            this.executionState?.invalidateFile(realpathSync(absolute));
          } catch {
            this.executionState?.invalidateFile(absolute);
          }
        } else {
          this.executionState?.invalidateAllFiles();
        }
      }
    };

    await Promise.all(readOnly.map(execute));

    for (const indexedCall of sideEffects) {
      if (options.signal.aborted) {
        results.set(indexedCall.index, cancelledResult('工具执行已由用户取消'));
        continue;
      }
      await execute(indexedCall);
    }

    for (const [index] of calls.entries()) {
      if (!results.has(index)) {
        results.set(index, cancelledResult('工具执行已由用户取消'));
      }
    }

    return {
      results: calls.map((call, index) => ({
        call,
        result: results.get(index)!,
        executed: executedIndices.has(index),
      })),
      unknownToolStreak,
      unknownToolLimitReached,
      cancelled: options.signal.aborted,
    };
  }
}
