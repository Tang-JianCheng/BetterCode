import { AgentLoop } from '../agent/loop.js';
import { createEventStream } from '../agent/event-stream.js';
import { buildExecutePlanRequest, buildPlanRequest } from '../agent/prompts.js';
import type {
  AgentEvent,
  AgentLoopOptions,
  AgentRunOptions,
  SavedPlan,
} from '../agent/types.js';
import type { LLMProvider, Message } from '../provider/types.js';
import { ToolRegistry } from '../tool/registry.js';

export class NoPlanError extends Error {
  constructor() {
    super('当前会话没有可执行的计划，请先使用 /plan <任务>');
    this.name = 'NoPlanError';
  }
}

export class ChatManager {
  private history: Message[] = [];
  private latestPlan: SavedPlan | undefined;
  private active = false;
  private readonly loop: AgentLoop;

  constructor(
    toolRegistry: ToolRegistry,
    options: Partial<AgentLoopOptions> = {},
    systemPrompt?: string,
  ) {
    this.loop = new AgentLoop(toolRegistry, options);
    if (systemPrompt) this.history.push({ role: 'user', content: systemPrompt });
  }

  run(
    userInput: string,
    provider: LLMProvider,
    options: AgentRunOptions = {},
  ): AsyncIterable<AgentEvent> {
    const mode = options.mode ?? 'act';
    const modelInput = mode === 'plan' ? buildPlanRequest(userInput) : userInput;
    return this.start(modelInput, provider, mode, options.signal, mode === 'plan' ? userInput : undefined);
  }

  executeLatestPlan(
    provider: LLMProvider,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    if (!this.latestPlan) throw new NoPlanError();
    const plan = { ...this.latestPlan };
    return this.start(buildExecutePlanRequest(plan), provider, 'act', signal);
  }

  getHistory(): ReadonlyArray<Message> {
    return [...this.history];
  }

  getLatestPlan(): Readonly<SavedPlan> | undefined {
    return this.latestPlan ? { ...this.latestPlan } : undefined;
  }

  clear(): void {
    this.history = [];
    this.latestPlan = undefined;
  }

  get turnCount(): number {
    return this.history.filter(message => message.role === 'user').length;
  }

  private start(
    userMessage: string,
    provider: LLMProvider,
    mode: 'act' | 'plan',
    signal = new AbortController().signal,
    planTask?: string,
  ): AsyncIterable<AgentEvent> {
    return createEventStream(async emit => {
      if (this.active) {
        emit({ type: 'error', iteration: 0, message: '已有 Agent 任务正在运行' });
        emit({
          type: 'stopped',
          reason: 'stream_error',
          iterations: 0,
          finalText: '',
        });
        return;
      }

      this.active = true;
      let terminalEvent: Extract<AgentEvent, { type: 'stopped' }> | undefined;
      try {
        const outcome = await this.loop.execute({
          history: this.history,
          userMessage,
          mode,
          provider,
          signal,
        }, event => {
          if (event.type === 'stopped') terminalEvent = event;
          else emit(event);
        });

        this.history = [...outcome.history];
        if (mode === 'plan' && planTask !== undefined &&
            outcome.reason === 'completed' && outcome.finalText.trim()) {
          this.latestPlan = { task: planTask, content: outcome.finalText };
        }
      } catch (error) {
        emit({
          type: 'error',
          iteration: 0,
          message: error instanceof Error ? error.message : String(error),
        });
        terminalEvent = {
          type: 'stopped',
          reason: 'stream_error',
          iterations: 0,
          finalText: '',
        };
      } finally {
        this.active = false;
      }

      if (terminalEvent) emit(terminalEvent);
    });
  }
}
