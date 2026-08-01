import { createHash } from 'node:crypto';
import { AgentLoop } from '../agent/loop.js';
import type { AgentEvent, AgentOutcome } from '../agent/types.js';
import type { LLMProvider, Message, TokenUsage } from '../provider/types.js';
import type { ProjectRuntimeFactory, ProjectRuntimeScope } from '../runtime/project-runtime.js';
import { createToolError, type ToolExecutionObserver } from '../tool/types.js';
import type { WorktreeManager } from '../worktree/manager.js';
import type { WorktreeLease } from '../worktree/types.js';
import type { TeamApprovalService } from './approval-service.js';
import type { MemberContextStore } from './context-store.js';
import { TeamError, teamDiagnostic } from './errors.js';
import type { TeamMailboxService } from './mailbox-service.js';
import type { OperationJournal } from './operation-journal.js';
import { buildMemberSupplemental, buildMemberSystemPrompt, buildMemberTaskPrompt } from './prompts.js';
import type { TeamRepository } from './repository.js';
import type { TeamTaskService } from './task-service.js';
import { TeamToolPolicy } from './tool-policy.js';
import type { MemberContextSnapshot, TeamMemberRecord, TeamTaskRecord } from './types.js';
import type { TeamMemberRuntimeResolver, TeamMemberRuntimeSnapshot } from './member-runtime.js';

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

export interface TeamMemberRunnerInput {
  team: string;
  member: string;
  taskId: string;
  provider: LLMProvider;
  signal: AbortSignal;
}

export interface TeamMemberRunnerOptions {
  runtimeFactory: ProjectRuntimeFactory;
  runtimeResolver: TeamMemberRuntimeResolver;
  repository: TeamRepository;
  tasks: TeamTaskService;
  mailbox: TeamMailboxService;
  approvals: TeamApprovalService;
  contexts: MemberContextStore;
  journal(team: string, member: string): OperationJournal;
  worktrees?: WorktreeManager;
}

export class TeamMemberRunner {
  constructor(private readonly options: TeamMemberRunnerOptions) {}

  async run(
    input: TeamMemberRunnerInput,
    emit: (event: AgentEvent) => void = () => {},
  ): Promise<AgentOutcome> {
    const team = this.options.repository.get(input.team)?.team;
    let member = this.options.repository.getMember(input.team, input.member);
    const task = this.options.tasks.get(input.team, input.taskId);
    if (!team || !member || !task || task.assignee !== member.name) {
      throw new TeamError('TEAM_STATE_ERROR', '成员、团队或分派任务不存在');
    }
    if (team.generation !== member.generation) throw new TeamError('TEAM_STATE_ERROR', '成员运行代次已失效');
    const resolved = this.options.runtimeResolver.resolve(input.team, member, task, input.provider);
    let lease: WorktreeLease | undefined;
    let runtime: ProjectRuntimeScope | undefined;
    let context = this.options.contexts.read(input.team, input.member, team.generation);
    const baseContextUsage = context?.usage ?? EMPTY_USAGE;
    try {
      if (context && resolved.requiresWorktree && !member.worktreeName) {
        throw new TeamError('TEAM_STATE_ERROR', '成员角色新增副作用工具，不能从共享根目录上下文恢复；请重置成员上下文后重试');
      }
      lease = await this.acquireWorkspace(team.projectRoot, member, resolved);
      const rootDir = lease?.cwd ?? team.projectRoot;
      if (resolved.requiresWorktree && !lease) throw new TeamError('TEAM_STATE_ERROR', '可写成员必须使用独立 Worktree');
      member = this.updateMember(input.team, member, {
        state: 'running',
        rootDir,
        currentTaskId: task.id,
        roleRevision: resolved.roleRevision,
        lastActiveAt: new Date().toISOString(),
        ...(lease ? { worktreeName: lease.name, worktreeBranch: lease.branch } : {}),
      });
      runtime = this.options.runtimeFactory.create(rootDir, resolved.permissionMode);
      const unread = this.options.mailbox.unread(resolved.actor, context?.mailboxCursor);
      const environment = { team: input.team, member, task, cwd: rootDir, ...(lease ? { branch: lease.branch } : {}), messages: unread };
      const systemPrompt = buildMemberSystemPrompt(resolved.definition, environment);
      const systemPromptHash = createHash('sha256').update(systemPrompt).digest('hex');
      if (context && (context.roleRevision !== resolved.roleRevision || context.systemPromptHash !== systemPromptHash)) {
        context = { ...context, roleRevision: resolved.roleRevision, systemPromptHash };
      }
      const journal = this.options.journal(input.team, input.member);
      const operationIds = new Map<string, string>();
      const observer = this.operationObserver(journal, resolved, () => context?.revision ?? 0, operationIds);
      const loop = new AgentLoop(
        runtime.registry,
        runtime.permissionManager,
        { maxIterations: resolved.maxIterations },
        { ...runtime.supplemental, ...buildMemberSupplemental(environment) },
        runtime.contextManager,
        {},
        {
          visibleToolNames: () => resolved.visibleToolNames,
          toolExecutionState: runtime.executionState,
          toolPolicy: new TeamToolPolicy({
            actor: () => resolved.actor,
            currentTaskId: () => task.id,
            approvals: this.options.approvals,
          }),
          toolObserver: observer,
          transformToolResult: async ({ result }) => result.error?.code === 'PERMISSION_UNAVAILABLE'
            ? createToolError('PERMISSION_DENIED', '团队成员非交互运行，当前工具没有明确放行规则')
            : result,
          onCheckpoint: checkpoint => {
            context = this.saveContext({
              previous: context,
              team: input.team,
              member: member!,
              resolved,
              systemPromptHash,
              messages: checkpoint.history,
              usage: addUsage(baseContextUsage, checkpoint.usage),
              iteration: checkpoint.iteration,
              mailboxCursor: unread.at(-1)?.id ?? context?.mailboxCursor,
              uncertainOperationIds: journal.uncertain(),
            });
          },
        },
      );
      const outcome = await loop.execute({
        history: context?.messages.map(message => structuredClone(message)) ?? [],
        userMessage: buildMemberTaskPrompt(environment),
        mode: 'act',
        provider: resolved.provider,
        signal: input.signal,
        systemPrompt,
      }, emit);
      if (unread.length > 0 && context?.mailboxCursor === unread.at(-1)?.id) {
        await this.options.mailbox.markRead(resolved.actor, unread.map(message => message.id), input.signal);
      }
      member = await this.finishRun(input, member, task, outcome, lease);
      return outcome;
    } catch (error) {
      if (member) {
        this.updateMember(input.team, member, {
          state: input.signal.aborted ? 'interrupted' : 'failed',
          lastActiveAt: new Date().toISOString(),
          lastError: teamDiagnostic('TEAM_STATE_ERROR', error instanceof Error ? error.message : String(error)),
        });
      }
      throw error;
    } finally {
      await runtime?.close();
      if (lease) await this.options.worktrees?.exit(lease.leaseId);
    }
  }

  private async acquireWorkspace(
    projectRoot: string,
    member: TeamMemberRecord,
    resolved: TeamMemberRuntimeSnapshot,
  ): Promise<WorktreeLease | undefined> {
    if (!resolved.requiresWorktree) return undefined;
    if (!this.options.worktrees) throw new TeamError('TEAM_STATE_ERROR', '当前项目不支持 Git Worktree 隔离');
    const name = member.worktreeName ?? `team/${resolved.actor.team}/${member.name}`;
    return member.worktreeName
      ? this.options.worktrees.enter(name)
      : this.options.worktrees.acquire(name);
  }

  private operationObserver(
    journal: OperationJournal,
    resolved: TeamMemberRuntimeSnapshot,
    contextRevision: () => number,
    operationIds: Map<string, string>,
  ): ToolExecutionObserver {
    return {
      beforeExecute: async observation => {
        if (observation.tool.effect !== 'side_effect') return;
        const operationId = await journal.start({
          toolCallId: observation.call.id,
          toolName: observation.call.name,
          arguments: observation.call.arguments,
          taskId: resolved.task.id,
          contextRevision: contextRevision(),
        }, resolved.actor.generation);
        operationIds.set(observation.call.id, operationId);
      },
      afterExecute: async observation => {
        const operationId = operationIds.get(observation.call.id);
        if (!operationId) return;
        await journal.finish(operationId, observation.result.ok, JSON.stringify(observation.result), resolved.actor.generation);
        operationIds.delete(observation.call.id);
      },
    };
  }

  private saveContext(input: {
    previous?: MemberContextSnapshot;
    team: string;
    member: TeamMemberRecord;
    resolved: TeamMemberRuntimeSnapshot;
    systemPromptHash: string;
    messages: readonly Message[];
    usage: TokenUsage;
    iteration: number;
    mailboxCursor?: string;
    uncertainOperationIds: readonly string[];
  }): MemberContextSnapshot {
    const snapshot: MemberContextSnapshot = {
      version: 1,
      revision: input.previous?.revision ?? 0,
      team: input.team,
      member: input.member.name,
      generation: input.member.generation,
      roleRevision: input.resolved.roleRevision,
      systemPromptHash: input.systemPromptHash,
      messages: input.messages.map(message => structuredClone(message)),
      usage: { ...input.usage },
      ...(input.mailboxCursor ? { mailboxCursor: input.mailboxCursor } : {}),
      currentTaskId: input.resolved.task.id,
      lastSafeIteration: input.iteration,
      uncertainOperationIds: [...input.uncertainOperationIds],
      updatedAt: new Date().toISOString(),
    };
    return this.options.contexts.write(snapshot, input.previous?.revision ?? 0);
  }

  private async finishRun(
    input: TeamMemberRunnerInput,
    member: TeamMemberRecord,
    initialTask: TeamTaskRecord,
    outcome: AgentOutcome,
    lease?: WorktreeLease,
  ): Promise<TeamMemberRecord> {
    const actor = { kind: 'member', team: input.team, member: member.name, generation: member.generation } as const;
    let task = this.options.tasks.get(input.team, initialTask.id) ?? initialTask;
    if (outcome.reason === 'completed' && task.state === 'ready' && !member.requiresApproval) {
      task = this.options.tasks.report(actor, { taskId: task.id, state: 'running' });
    }
    if (outcome.reason === 'completed' && task.state === 'running') {
      task = this.options.tasks.report(actor, {
        taskId: task.id,
        state: 'completed',
        resultSummary: outcome.finalText || '成员已完成任务',
      });
    }
    const state = task.state === 'waiting_approval'
      ? 'waiting_approval'
      : task.state === 'completed' || task.state === 'failed'
        ? 'idle'
        : outcome.reason === 'completed' ? 'idle' : 'interrupted';
    const updated = this.updateMember(input.team, member, {
      state,
      currentTaskId: state === 'idle' ? undefined : task.id,
      usage: addUsage(member.usage, outcome.usage),
      lastActiveAt: new Date().toISOString(),
    });
    if (state === 'idle') {
      await this.options.mailbox.send(actor, {
        recipient: 'lead',
        type: 'member_idle',
        taskId: task.id,
        body: task.resultSummary || outcome.finalText || `成员 ${member.name} 已结束任务`,
        summary: `成员 ${member.name} 已完成任务 ${task.id}`,
      });
    }
    return updated;
  }

  private updateMember(team: string, member: TeamMemberRecord, changes: Partial<TeamMemberRecord>): TeamMemberRecord {
    return this.options.repository.writeMember(team, {
      ...member,
      ...changes,
    }, member.revision);
  }
}

function addUsage(left: TokenUsage, right: Readonly<TokenUsage>): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
    cacheReadInputTokens: left.cacheReadInputTokens + right.cacheReadInputTokens,
  };
}
