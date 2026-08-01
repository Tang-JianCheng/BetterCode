import { AtomicJsonStore, isRevisionedRecord } from './atomic-store.js';
import { TeamError } from './errors.js';
import { TeamPathGuard } from './path-guard.js';
import { TeamRepository } from './repository.js';
import type {
  LeadActor,
  MemberActor,
  TeamActor,
  TeamTaskCollection,
  TeamTaskRecord,
  TeamTaskState,
} from './types.js';

const TERMINAL_STATES = new Set<TeamTaskState>(['completed', 'failed', 'cancelled']);
const MAX_TASKS = 10_000;
const MAX_DEPENDENCIES = 100;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validCollection(value: unknown): value is TeamTaskCollection {
  return isRevisionedRecord(value) && object(value) && value.version === 1 &&
    Number.isInteger(value.nextId) && object(value.tasks);
}

function emptyCollection(): TeamTaskCollection {
  return { version: 1, revision: 0, nextId: 1, tasks: {} };
}

export interface CreateTeamTaskInput {
  title: string;
  description: string;
  dependencies?: readonly string[];
}

export interface UpdateTeamTaskInput {
  taskId: string;
  title?: string;
  description?: string;
  dependencies?: readonly string[];
}

export interface ReportTaskInput {
  taskId: string;
  state: 'running' | 'completed' | 'failed';
  resultSummary?: string;
  branch?: string;
  commit?: string;
}

export class TeamTaskService {
  constructor(
    private readonly guard: TeamPathGuard,
    private readonly repository: TeamRepository,
  ) {}

  create(actor: LeadActor, input: CreateTeamTaskInput): TeamTaskRecord {
    this.assertLead(actor);
    return this.updateCollection(actor.team, collection => {
      if (Object.keys(collection.tasks).length >= MAX_TASKS) {
        throw new TeamError('TEAM_STATE_ERROR', `团队任务数量不能超过 ${MAX_TASKS}`);
      }
      const title = input.title.trim();
      const description = input.description.trim();
      if (!title || !description) throw new TeamError('TEAM_STATE_ERROR', '任务标题和描述不能为空');
      const id = `task-${String(collection.nextId).padStart(4, '0')}`;
      const dependencies = this.normalizeDependencies(input.dependencies ?? [], id, collection.tasks);
      const now = new Date().toISOString();
      const state: TeamTaskState = dependencies.every(dependency =>
        collection.tasks[dependency].state === 'completed') ? 'pending' : 'blocked';
      const task: TeamTaskRecord = {
        id,
        title,
        description,
        state,
        dependencies,
        createdBy: 'lead',
        createdAt: now,
        updatedAt: now,
        history: [{ to: state, actor: 'lead', reason: '创建任务', timestamp: now }],
      };
      collection.tasks[id] = task;
      collection.nextId += 1;
      this.assertAcyclic(collection.tasks);
      return task;
    });
  }

  update(actor: LeadActor, input: UpdateTeamTaskInput): TeamTaskRecord {
    this.assertLead(actor);
    return this.updateCollection(actor.team, collection => {
      const task = this.requireTask(collection, input.taskId);
      if (TERMINAL_STATES.has(task.state)) throw new TeamError('TEAM_STATE_ERROR', '终态任务必须先重新打开');
      const dependencies = input.dependencies === undefined
        ? task.dependencies
        : this.normalizeDependencies(input.dependencies, task.id, collection.tasks);
      const next = {
        ...task,
        ...(input.title === undefined ? {} : { title: this.nonEmpty(input.title, '任务标题') }),
        ...(input.description === undefined ? {} : { description: this.nonEmpty(input.description, '任务描述') }),
        dependencies,
        updatedAt: new Date().toISOString(),
      };
      collection.tasks[task.id] = next;
      this.assertAcyclic(collection.tasks);
      this.recompute(collection, 'lead', '任务依赖已更新');
      return collection.tasks[task.id];
    });
  }

  assign(actor: LeadActor, taskId: string, memberName: string): TeamTaskRecord {
    this.assertLead(actor);
    const member = this.repository.getMember(actor.team, memberName);
    if (!member || member.state === 'terminated') {
      throw new TeamError('TEAM_MEMBER_NOT_FOUND', `团队成员不存在或已终止: ${memberName}`);
    }
    return this.updateCollection(actor.team, collection => {
      const task = this.requireTask(collection, taskId);
      if (task.state === 'running' && task.assignee !== member.name) {
        throw new TeamError('TEAM_STATE_ERROR', '运行中的任务必须先停止原负责人');
      }
      const now = new Date().toISOString();
      const state = task.dependencies.every(id => collection.tasks[id].state === 'completed') ? 'ready' : 'blocked';
      const next = this.transition({ ...task, assignee: member.name }, state, 'lead', `分派给 ${member.name}`, now);
      collection.tasks[task.id] = next;
      return next;
    });
  }

  report(actor: MemberActor, input: ReportTaskInput): TeamTaskRecord {
    this.assertMember(actor);
    return this.updateCollection(actor.team, collection => {
      const task = this.requireTask(collection, input.taskId);
      if (task.assignee !== actor.member) throw new TeamError('TEAM_STATE_ERROR', '成员只能更新分派给自己的任务');
      const allowed = input.state === 'running'
        ? task.state === 'ready' || task.state === 'waiting_approval'
        : task.state === 'running';
      if (!allowed) throw new TeamError('TEAM_STATE_ERROR', `任务状态不能从 ${task.state} 变为 ${input.state}`);
      if (input.state === 'completed' && (input.branch || input.commit) && (!input.branch || !input.commit)) {
        throw new TeamError('TEAM_STATE_ERROR', '代码任务完成时 branch 和 commit 必须同时提供');
      }
      const now = new Date().toISOString();
      const next = this.transition({
        ...task,
        ...(input.resultSummary ? { resultSummary: input.resultSummary.trim().slice(0, 10_000) } : {}),
        ...(input.branch ? { branch: input.branch.trim() } : {}),
        ...(input.commit ? { commit: input.commit.trim() } : {}),
      }, input.state, actor.member, '成员报告任务状态', now);
      collection.tasks[task.id] = next;
      this.recompute(collection, actor.member, `前置任务 ${task.id} 状态变化`);
      return collection.tasks[task.id];
    });
  }

  markWaitingApproval(actor: MemberActor, taskId: string): TeamTaskRecord {
    return this.setMemberState(actor, taskId, 'waiting_approval', '成员提交审批计划');
  }

  markReadyAfterRejection(actor: LeadActor, taskId: string): TeamTaskRecord {
    this.assertLead(actor);
    return this.updateCollection(actor.team, collection => {
      const task = this.requireTask(collection, taskId);
      if (task.state !== 'waiting_approval') throw new TeamError('TEAM_STATE_ERROR', '任务不在等待审批状态');
      const next = this.transition(task, 'ready', 'lead', '计划被驳回，需要修订', new Date().toISOString());
      collection.tasks[task.id] = next;
      return next;
    });
  }

  approve(actor: LeadActor, taskId: string): TeamTaskRecord {
    this.assertLead(actor);
    return this.updateCollection(actor.team, collection => {
      const task = this.requireTask(collection, taskId);
      if (task.state !== 'waiting_approval') throw new TeamError('TEAM_STATE_ERROR', '任务不在等待审批状态');
      const next = this.transition(task, 'running', 'lead', '计划已批准', new Date().toISOString());
      collection.tasks[task.id] = next;
      return next;
    });
  }

  cancel(actor: LeadActor, taskId: string, reason: string): TeamTaskRecord {
    this.assertLead(actor);
    return this.updateCollection(actor.team, collection => {
      const task = this.requireTask(collection, taskId);
      if (TERMINAL_STATES.has(task.state)) return task;
      const next = this.transition(task, 'cancelled', 'lead', this.nonEmpty(reason, '取消原因'), new Date().toISOString());
      collection.tasks[task.id] = next;
      this.recompute(collection, 'lead', `前置任务 ${task.id} 已取消`);
      return next;
    });
  }

  reopen(actor: LeadActor, taskId: string): TeamTaskRecord {
    this.assertLead(actor);
    return this.updateCollection(actor.team, collection => {
      const task = this.requireTask(collection, taskId);
      if (!TERMINAL_STATES.has(task.state)) throw new TeamError('TEAM_STATE_ERROR', '只有终态任务可以重新打开');
      const dependenciesReady = task.dependencies.every(id => collection.tasks[id].state === 'completed');
      const state: TeamTaskState = dependenciesReady ? (task.assignee ? 'ready' : 'pending') : 'blocked';
      const next = this.transition({ ...task, integrationId: undefined }, state, 'lead', '重新打开任务', new Date().toISOString());
      collection.tasks[task.id] = next;
      this.recompute(collection, 'lead', `前置任务 ${task.id} 已重新打开`);
      return next;
    });
  }

  get(team: string, taskId: string): TeamTaskRecord | undefined {
    return this.collection(team).tasks[taskId] ? structuredClone(this.collection(team).tasks[taskId]) : undefined;
  }

  list(actor: TeamActor): TeamTaskRecord[] {
    actor.kind === 'lead' ? this.assertLead(actor) : this.assertMember(actor);
    const tasks = Object.values(this.collection(actor.team).tasks);
    const visible = actor.kind === 'lead' ? tasks : tasks.filter(task => task.assignee === actor.member);
    return visible.sort((left, right) => left.id.localeCompare(right.id)).map(task => structuredClone(task));
  }

  topologicalOrder(team: string, taskIds?: readonly string[]): TeamTaskRecord[] {
    const tasks = this.collection(team).tasks;
    const allowed = taskIds ? new Set(taskIds) : new Set(Object.keys(tasks));
    for (const id of allowed) this.requireTask({ tasks } as TeamTaskCollection, id);
    const indegree = new Map<string, number>();
    const children = new Map<string, string[]>();
    for (const id of allowed) {
      const dependencies = tasks[id].dependencies.filter(dependency => allowed.has(dependency));
      indegree.set(id, dependencies.length);
      for (const dependency of dependencies) children.set(dependency, [...(children.get(dependency) ?? []), id]);
    }
    const queue = [...allowed].filter(id => indegree.get(id) === 0).sort();
    const ordered: TeamTaskRecord[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      ordered.push(structuredClone(tasks[id]));
      for (const child of (children.get(id) ?? []).sort()) {
        indegree.set(child, indegree.get(child)! - 1);
        if (indegree.get(child) === 0) {
          queue.push(child);
          queue.sort();
        }
      }
    }
    if (ordered.length !== allowed.size) throw new TeamError('TEAM_STATE_ERROR', '任务依赖存在循环');
    return ordered;
  }

  private setMemberState(
    actor: MemberActor,
    taskId: string,
    state: TeamTaskState,
    reason: string,
  ): TeamTaskRecord {
    this.assertMember(actor);
    return this.updateCollection(actor.team, collection => {
      const task = this.requireTask(collection, taskId);
      if (task.assignee !== actor.member || task.state !== 'ready') {
        throw new TeamError('TEAM_STATE_ERROR', '当前任务不能提交审批计划');
      }
      const next = this.transition(task, state, actor.member, reason, new Date().toISOString());
      collection.tasks[task.id] = next;
      return next;
    });
  }

  private collection(team: string): TeamTaskCollection {
    return this.store(team).read() ?? emptyCollection();
  }

  private updateCollection<T>(team: string, update: (collection: TeamTaskCollection) => T): T {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const store = this.store(team);
      const current = store.read() ?? emptyCollection();
      const draft = structuredClone(current);
      const result = update(draft);
      try {
        store.write(draft, current.revision);
        return structuredClone(result);
      } catch (error) {
        if (!(error instanceof TeamError) || error.code !== 'TEAM_CONFLICT' || attempt === 2) throw error;
      }
    }
    throw new TeamError('TEAM_CONFLICT', '更新团队任务失败');
  }

  private store(team: string): AtomicJsonStore<TeamTaskCollection> {
    return new AtomicJsonStore(this.guard.team(team).tasksFile, validCollection);
  }

  private normalizeDependencies(
    input: readonly string[],
    taskId: string,
    tasks: Record<string, TeamTaskRecord>,
  ): string[] {
    if (input.length > MAX_DEPENDENCIES) throw new TeamError('TEAM_STATE_ERROR', '任务依赖数量过多');
    const dependencies = [...new Set(input.map(id => id.trim()).filter(Boolean))];
    if (dependencies.includes(taskId)) throw new TeamError('TEAM_STATE_ERROR', '任务不能依赖自身');
    for (const dependency of dependencies) {
      if (!tasks[dependency]) throw new TeamError('TEAM_TASK_NOT_FOUND', `依赖任务不存在: ${dependency}`);
    }
    return dependencies.sort();
  }

  private assertAcyclic(tasks: Record<string, TeamTaskRecord>): void {
    const indegree = new Map(Object.keys(tasks).map(id => [id, 0]));
    const children = new Map<string, string[]>();
    for (const task of Object.values(tasks)) {
      indegree.set(task.id, task.dependencies.length);
      for (const dependency of task.dependencies) children.set(dependency, [...(children.get(dependency) ?? []), task.id]);
    }
    const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
    let visited = 0;
    while (queue.length > 0) {
      const id = queue.shift()!;
      visited += 1;
      for (const child of children.get(id) ?? []) {
        const count = indegree.get(child)! - 1;
        indegree.set(child, count);
        if (count === 0) queue.push(child);
      }
    }
    if (visited !== Object.keys(tasks).length) throw new TeamError('TEAM_STATE_ERROR', '任务依赖不能形成循环');
  }

  private recompute(collection: TeamTaskCollection, actor: string, reason: string): void {
    const now = new Date().toISOString();
    for (const task of Object.values(collection.tasks)) {
      if (TERMINAL_STATES.has(task.state) || task.state === 'running' || task.state === 'waiting_approval') continue;
      const dependenciesReady = task.dependencies.every(id => collection.tasks[id].state === 'completed');
      const desired: TeamTaskState = dependenciesReady ? (task.assignee ? 'ready' : 'pending') : 'blocked';
      if (task.state !== desired) collection.tasks[task.id] = this.transition(task, desired, actor, reason, now);
    }
  }

  private transition(
    task: TeamTaskRecord,
    state: TeamTaskState,
    actor: string,
    reason: string,
    timestamp: string,
  ): TeamTaskRecord {
    if (task.state === state) return { ...task, updatedAt: timestamp };
    return {
      ...task,
      state,
      updatedAt: timestamp,
      history: [...task.history, { from: task.state, to: state, actor, reason, timestamp }],
    };
  }

  private requireTask(collection: Pick<TeamTaskCollection, 'tasks'>, taskId: string): TeamTaskRecord {
    const task = collection.tasks[taskId];
    if (!task) throw new TeamError('TEAM_TASK_NOT_FOUND', `团队任务不存在: ${taskId}`);
    return task;
  }

  private assertLead(actor: LeadActor): void {
    const team = this.repository.get(actor.team)?.team;
    if (!team || team.generation !== actor.generation || team.state !== 'active') {
      throw new TeamError('TEAM_STATE_ERROR', 'Team Lead 身份已失效');
    }
  }

  private assertMember(actor: MemberActor): void {
    const team = this.repository.get(actor.team)?.team;
    const member = this.repository.getMember(actor.team, actor.member);
    if (!team || !member || team.generation !== actor.generation || member.generation !== actor.generation ||
        member.state === 'terminated') {
      throw new TeamError('TEAM_STATE_ERROR', '团队成员身份已失效');
    }
  }

  private nonEmpty(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new TeamError('TEAM_STATE_ERROR', `${label}不能为空`);
    return normalized;
  }
}
