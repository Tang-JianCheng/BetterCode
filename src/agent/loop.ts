import { serializeToolResult } from '../tool/output-limit.js';
import { ToolRegistry } from '../tool/registry.js';
import type { Message, TokenUsage } from '../provider/types.js';
import { buildSystemPrompt } from '../prompt/builder.js';
import { buildSystemReminder, collectEnvironment } from '../prompt/reminder.js';
import type { SupplementalPromptContent } from '../prompt/types.js';
import type { PermissionManager } from '../permission/manager.js';
import { StreamCollector } from './stream-collector.js';
import { ToolScheduler } from './tool-scheduler.js';
import type {
  AgentEvent,
  AgentLoopOptions,
  AgentLoopRequest,
  AgentOutcome,
  AgentStopReason,
} from './types.js';

const DEFAULT_OPTIONS: AgentLoopOptions = {
  maxIterations: 10,
  unknownToolLimit: 3,
};

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

export class AgentLoop {
  private readonly options: AgentLoopOptions;
  private readonly collector = new StreamCollector();
  private readonly scheduler: ToolScheduler;
  private readonly systemPrompt = buildSystemPrompt();

  constructor(
    private readonly registry: ToolRegistry,
    permissionManager: PermissionManager,
    options: Partial<AgentLoopOptions> = {},
    private readonly supplemental: SupplementalPromptContent = {},
  ) {
    this.options = {
      maxIterations: Math.max(1, options.maxIterations ?? DEFAULT_OPTIONS.maxIterations),
      unknownToolLimit: Math.max(1, options.unknownToolLimit ?? DEFAULT_OPTIONS.unknownToolLimit),
    };
    this.scheduler = new ToolScheduler(registry, permissionManager);
  }

  async execute(
    request: AgentLoopRequest,
    emit: (event: AgentEvent) => void,
  ): Promise<AgentOutcome> {
    const history: Message[] = [...request.history, { role: 'user', content: request.userMessage }];
    const cumulativeUsage = { ...EMPTY_USAGE };
    let finalText = '';
    let unknownToolStreak = 0;
    let completedIterations = 0;
    let startedIterations = 0;
    const definitions = request.mode === 'plan'
      ? this.registry.definitions('read_only')
      : this.registry.definitions();

    const finish = (reason: AgentStopReason, iterations: number): AgentOutcome => {
      emit({ type: 'stopped', reason, iterations, finalText });
      return {
        reason,
        iterations,
        finalText,
        history,
        usage: { ...cumulativeUsage },
      };
    };

    try {
      for (let iteration = 1; iteration <= this.options.maxIterations; iteration += 1) {
        if (request.signal.aborted) return finish('cancelled', completedIterations);
        startedIterations = iteration;

        emit({
          type: 'progress',
          iteration,
          maxIterations: this.options.maxIterations,
          stage: 'requesting_model',
        });
        const environment = collectEnvironment(this.registry.rootDir, request.mode);
        const reminder = buildSystemReminder({
          environment,
          iteration,
          supplemental: this.supplemental,
        });
        const turn = await this.collector.collect(
          request.provider,
          {
            systemPrompt: this.systemPrompt,
            messages: [...history, { role: 'instruction', content: reminder }],
            tools: definitions,
          },
          iteration,
          request.signal,
          emit,
        );

        if (turn.status === 'cancelled') return finish('cancelled', startedIterations);
        if (turn.status === 'stream_error') {
          emit({
            type: 'error',
            iteration,
            message: turn.error ?? '模型响应流错误',
          });
          return finish('stream_error', startedIterations);
        }

        completedIterations = iteration;
        finalText += turn.text;
        emit({
          type: 'progress',
          iteration,
          maxIterations: this.options.maxIterations,
          stage: 'model_complete',
        });

        if (turn.usage) {
          cumulativeUsage.inputTokens += turn.usage.inputTokens;
          cumulativeUsage.outputTokens += turn.usage.outputTokens;
          cumulativeUsage.totalTokens += turn.usage.totalTokens;
          cumulativeUsage.cacheCreationInputTokens += turn.usage.cacheCreationInputTokens;
          cumulativeUsage.cacheReadInputTokens += turn.usage.cacheReadInputTokens;
          emit({
            type: 'usage',
            iteration,
            current: turn.usage,
            cumulative: { ...cumulativeUsage },
          });
        }

        if (turn.toolCalls.length === 0) {
          if (turn.text) history.push({ role: 'assistant', content: turn.text });
          return finish('completed', iteration);
        }

        emit({
          type: 'progress',
          iteration,
          maxIterations: this.options.maxIterations,
          stage: 'executing_tools',
        });
        const batch = await this.scheduler.executeBatch(turn.toolCalls, iteration, {
          mode: request.mode,
          initialUnknownToolStreak: unknownToolStreak,
          unknownToolLimit: this.options.unknownToolLimit,
          maxIterations: this.options.maxIterations,
          signal: request.signal,
          permissionDecider: request.permissionDecider,
          onProgress: emit,
        });
        unknownToolStreak = batch.unknownToolStreak;

        history.push({
          role: 'assistant',
          content: turn.text,
          toolCalls: turn.toolCalls,
        });
        for (const { call, result } of batch.results) {
          history.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: serializeToolResult(result),
            isError: !result.ok,
          });
          emit({ type: 'tool_result', iteration, call, result });
        }
        emit({
          type: 'progress',
          iteration,
          maxIterations: this.options.maxIterations,
          stage: 'tools_complete',
        });

        if (batch.cancelled || request.signal.aborted) return finish('cancelled', iteration);
        if (batch.unknownToolLimitReached) return finish('unknown_tool_limit', iteration);
        if (iteration === this.options.maxIterations) return finish('max_iterations', iteration);
      }
    } catch (error) {
      emit({
        type: 'error',
        iteration: Math.max(1, startedIterations),
        message: error instanceof Error ? error.message : String(error),
      });
      return finish('stream_error', startedIterations);
    }

    return finish('max_iterations', completedIterations);
  }
}
