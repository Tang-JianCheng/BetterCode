import { AgentLoop, type AgentLoopRuntime } from '../agent/loop.js';
import { createEventStream } from '../agent/event-stream.js';
import type { AgentEvent, AgentLoopOptions, AgentOutcome, AgentRunOptions } from '../agent/types.js';
import { ContextManager } from '../context/manager.js';
import type { ContextManagerOptions } from '../context/types.js';
import type { PermissionManager } from '../permission/manager.js';
import type { SupplementalPromptContent } from '../prompt/types.js';
import type { LLMProvider, Message } from '../provider/types.js';
import type { ToolRegistry } from '../tool/registry.js';
import { createToolError, createToolSuccess, type ToolCall, type ToolResult } from '../tool/types.js';
import { LOAD_SKILL_TOOL_NAME } from './load-tool.js';
import type { SkillManager } from './manager.js';
import type { SkillExecutionScope, SkillProviderResolver } from './types.js';

function historyGroups(history: readonly Message[]): Message[][] {
  const filtered = history.filter(message => message.role !== 'instruction' || message.instructionKind !== 'runtime');
  const groups: Message[][] = [];
  for (let index = 0; index < filtered.length;) {
    const message = filtered[index];
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const group: Message[] = [message];
      for (const call of message.toolCalls) {
        const result = filtered[index + group.length];
        if (result?.role !== 'tool' || result.toolCallId !== call.id) {
          throw new Error(`独立 Skill 历史中的工具结果不完整: ${call.id}`);
        }
        group.push(result);
      }
      groups.push(group);
      index += group.length;
    } else {
      if (message.role === 'tool') throw new Error(`独立 Skill 历史中存在孤立工具结果: ${message.toolCallId}`);
      groups.push([message]);
      index += 1;
    }
  }
  return groups;
}

export function selectRecentSkillHistory(history: readonly Message[], messageCount: number): Message[] {
  if (messageCount <= 0) return [];
  const groups = historyGroups(history);
  const selected: Message[][] = [];
  let count = 0;
  for (let index = groups.length - 1; index >= 0 && count < messageCount; index -= 1) {
    selected.unshift(groups[index]);
    count += groups[index].length;
  }
  return selected.flat().map(message => ({ ...message }));
}

export interface SkillRunnerOptions {
  loop?: Partial<AgentLoopOptions>;
  context?: Partial<ContextManagerOptions>;
  supplemental?: SupplementalPromptContent;
}

export class SkillRunner {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly permissionManager: PermissionManager,
    private readonly manager: SkillManager,
    private readonly providers: SkillProviderResolver<LLMProvider>,
    private readonly options: SkillRunnerOptions = {},
  ) {}

  run(
    name: string,
    args: string,
    history: readonly Message[],
    currentProvider: LLMProvider,
    options: AgentRunOptions = {},
  ): AsyncIterable<AgentEvent> {
    return createEventStream(async emit => {
      await this.execute(name, args, history, currentProvider, options, emit);
    });
  }

  async transformToolResult(input: {
    call: ToolCall;
    result: ToolResult;
    history: readonly Message[];
    currentProvider: LLMProvider;
    options: AgentRunOptions;
  }): Promise<ToolResult> {
    if (input.call.name !== LOAD_SKILL_TOOL_NAME || !input.result.ok ||
        input.result.metadata.skillMode !== 'isolated') return input.result;
    const name = String(input.result.metadata.skill ?? '');
    const args = String(input.result.metadata.skillArgs ?? '');
    try {
      const outcome = await this.execute(
        name,
        args,
        input.history,
        input.currentProvider,
        input.options,
        () => undefined,
      );
      if (outcome.reason !== 'completed' || !outcome.finalText.trim()) {
        return createToolError('EXECUTION_ERROR', `独立 Skill ${name} 未正常完成`);
      }
      return createToolSuccess(outcome.finalText, { skill: name, skillMode: 'isolated' });
    } catch (error) {
      return createToolError(
        'EXECUTION_ERROR',
        `独立 Skill ${name} 执行失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async execute(
    name: string,
    args: string,
    history: readonly Message[],
    currentProvider: LLMProvider,
    options: AgentRunOptions,
    emit: (event: AgentEvent) => void,
  ): Promise<AgentOutcome> {
    const skill = this.manager.get(name);
    if (!skill || skill.mode !== 'isolated') throw new Error(`独立 Skill 不存在或不可用: ${name}`);
    const provider = skill.model ? this.providers.resolve(skill.model) : currentProvider;
    const scope: SkillExecutionScope = { name: skill.name, args };
    const contextManager = new ContextManager(this.registry.rootDir, this.options.context);
    const runtime: AgentLoopRuntime = {
      supplemental: () => this.manager.promptContent(scope),
      visibleToolNames: () => this.manager.visibleTools(scope).names,
    };
    const loop = new AgentLoop(
      this.registry,
      this.permissionManager,
      this.options.loop,
      this.options.supplemental,
      contextManager,
      {},
      runtime,
    );
    const signal = options.signal ?? new AbortController().signal;
    try {
      return await this.manager.withIsolation(() => loop.execute({
        history: selectRecentSkillHistory(history, skill.history),
        userMessage: [
          args.trim() ? `Skill 参数：${args}` : `执行 Skill ${skill.name}。`,
          '完成任务后只输出可独立理解的简洁结果摘要。',
        ].join('\n'),
        mode: options.mode ?? 'act',
        provider,
        signal,
        permissionDecider: options.permissionDecider,
      }, emit));
    } finally {
      await contextManager.close();
    }
  }
}
