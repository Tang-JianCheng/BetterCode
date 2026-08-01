# BetterCode 团队协作系统 Plan

## 架构概览

团队系统采用独立编排层，复用 BetterCode 已有的角色定义、Provider、Agent Loop、权限、Hook、ProjectRuntime 和 Worktree 基础设施，不把长期成员塞进现有短生命周期 `SubAgentTaskManager`。

整体分为六层：

1. **持久化层**：`TeamStore`、`TaskStore`、`MailboxStore`、`ApprovalStore` 和 `MemberContextStore` 以用户目录为事实源，使用原子快照、文件锁和版本号处理跨进程并发。
2. **领域层**：`TeamManager`、`TeamTaskService`、`TeamMailboxService`、`TeamApprovalService` 维护团队、成员、任务 DAG、消息协议和审批状态机。
3. **运行层**：`TeamMemberRunner` 把持久化成员恢复为独立 Agent Runtime，在每个安全边界保存上下文和工具操作日志。
4. **后端层**：`TeamBackendManager` 统一调度 tmux、WezTerm、iTerm2、自定义终端和协程后端，禁止自动降级到协程。
5. **集成层**：`TeamIntegrationManager` 在临时 Worktree 中按任务拓扑顺序合并成员分支，成功后快速前移 Lead 分支，失败则保持 Lead 工作区不变。
6. **接入层**：`TeamCoordinator`、团队工具、`/team` 命令、动态提示和 UI 事件把团队能力接入主 Agent；普通子 Agent 通过工具过滤继续看不到团队工具。

```text
主 BetterCode / Team Lead
        │
        ├── TeamCoordinator ─── Team 工具 / /team 命令 / 动态提示
        │          │
        │          ├── TeamManager ─── TeamStore / TaskStore / ApprovalStore
        │          ├── MailboxService ─── MailboxStore + FileLock
        │          ├── BackendManager ─── tmux / WezTerm / iTerm2 / 自定义 / 协程
        │          └── IntegrationManager ─── GitIntegrationClient + WorktreeManager
        │
        └── TeamMemberRunner
                   ├── AgentDefinitionManager / ProviderResolver
                   ├── ProjectRuntimeFactory / Permission / Hook
                   ├── AgentLoop + TeamExecutionPolicy
                   └── MemberContextStore / OperationJournal
```

## 配置设计

### AppConfig 扩展

```typescript
interface TeamConfig {
  coordinator?: {
    enabled?: boolean;
  };
  mailbox?: {
    lock_timeout_ms?: number;
    retry_interval_ms?: number;
    stale_lock_ms?: number;
  };
  runtime?: {
    heartbeat_interval_ms?: number;
    heartbeat_timeout_ms?: number;
    stop_timeout_ms?: number;
    inbox_poll_interval_ms?: number;
  };
  integration?: {
    timeout_ms?: number;
    validation_commands?: string[];
  };
  custom_terminals?: CustomTerminalConfig[];
}

interface CustomTerminalConfig {
  name: string;
  detect: ProcessTemplate;
  spawn: ProcessTemplate;
  wake: ProcessTemplate;
  terminate?: ProcessTemplate;
}

interface ProcessTemplate {
  command: string;
  args?: string[];
}
```

`AppConfig` 增加可选 `teams?: TeamConfig`。配置加载器拒绝未知字段、空命令、重复适配器名称和超出边界的超时。自定义终端参数使用 `{worker_descriptor}`、`{cwd}`、`{pane_id}` 三种受控占位符，按单个 argv 元素替换，绝不拼成 shell 字符串。

默认值：

| 配置 | 默认值 | 约束 |
|------|--------|------|
| `coordinator.enabled` | `false` | 还需 `BETTERCODE_COORDINATOR_MODE=1` |
| `mailbox.lock_timeout_ms` | `5000` | 100-60000ms |
| `mailbox.retry_interval_ms` | `50` | 10-5000ms |
| `mailbox.stale_lock_ms` | `30000` | 必须大于重试间隔 |
| `runtime.heartbeat_interval_ms` | `2000` | 250-60000ms |
| `runtime.heartbeat_timeout_ms` | `10000` | 必须大于心跳间隔 |
| `runtime.stop_timeout_ms` | `10000` | 1000-120000ms |
| `runtime.inbox_poll_interval_ms` | `2000` | 250-60000ms，窗格唤醒失败的兜底 |
| `integration.timeout_ms` | `300000` | 1000-3600000ms |
| `integration.validation_commands` | `[]` | 用户可信配置，逐条串行执行 |

Coordinator 状态在进程启动时解析为不可变值：

```typescript
interface CoordinatorCapability {
  configEnabled: boolean;
  environmentEnabled: boolean;
  active: boolean;
  missingLocks: readonly ('config' | 'environment')[];
}
```

## 持久化布局

团队根目录固定为 `~/.bettercode/teams`，目录与文件权限分别为 `0700` 和 `0600`。

```text
~/.bettercode/teams/
├── index.json                         # 团队索引、会话到活跃团队的绑定
└── <team-name>/
    ├── team.json                      # 团队元数据、Lead、运行代次
    ├── tasks.json                     # 任务 DAG、状态和历史
    ├── approvals.json                 # 审批请求与响应
    ├── integrations/
    │   └── <integration-id>.json      # 集成事务状态
    ├── members/
    │   └── <member-name>.json         # 花名册成员状态
    ├── contexts/
    │   └── <member-name>.json         # 可恢复 Agent 上下文快照
    ├── operations/
    │   └── <member-name>.jsonl        # 副作用工具开始/结束日志
    ├── mailboxes/
    │   ├── <member-name>.jsonl        # 成员邮箱，Lead 使用保留名 lead
    │   └── <member-name>.lock         # 邮箱锁
    ├── runtime/
    │   ├── <member-name>.lease.json   # PID、实例 ID、心跳、窗格标识
    │   └── <member-name>.worker.json  # 0600 的 Worker 启动描述文件
    └── diagnostics.jsonl              # 脱敏诊断
```

`team.json`、`tasks.json`、`approvals.json`、成员文件和上下文文件使用“同目录临时文件、`fsync`、原子 `rename`”更新，并包含 `version` 与递增 `revision`。写入时传入期望 revision，不匹配返回 `TEAM_CONFLICT`，调用方重新读取后重试有限次数。

邮箱保留 JSONL 追加语义。持锁后单次写入完整一行并 `fsync`；加载时接受完整合法前缀，对末尾残缺行产生诊断并隔离，不覆盖已有消息。

## 核心数据结构

### TeamRecord

```typescript
interface TeamRecord {
  version: 1;
  revision: number;
  name: string;
  repositoryId: string;
  projectRoot: string;
  lead: string;
  state: 'active' | 'archiving' | 'archived';
  generation: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}
```

`generation` 是运行代次。每次主进程接管团队时递增；成员租约和所有 Worker 写入都必须携带当前代次。旧进程即使仍存活，也会因代次不匹配停止写入并退出，防止重启后双跑。

### TeamMemberRecord

```typescript
type TeamMemberState =
  | 'creating'
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'interrupted'
  | 'stopping'
  | 'terminated'
  | 'failed';

type TeamBackendKind = 'tmux' | 'wezterm' | 'iterm2' | 'custom' | 'coroutine';

interface TeamMemberRecord {
  version: 1;
  revision: number;
  name: string;
  role: string;
  roleRevision: number;
  state: TeamMemberState;
  backend: TeamBackendKind;
  backendName?: string;
  backendInstanceId?: string;
  requiresApproval: boolean;
  rootDir: string;
  worktreeName?: string;
  worktreeBranch?: string;
  currentTaskId?: string;
  contextPath: string;
  generation: number;
  usage: TokenUsage;
  createdAt: string;
  lastActiveAt: string;
  lastError?: TeamDiagnostic;
}
```

成员是否需要 Worktree 由角色过滤后的**普通工具**决定：任一工具 `effect === 'side_effect'` 即为可写成员。团队消息、任务和审批工具不参与该判断，因为它们只修改团队用户数据，不修改项目工作区。

### TeamTaskRecord

```typescript
type TeamTaskState =
  | 'pending'
  | 'blocked'
  | 'ready'
  | 'waiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface TeamTaskRecord {
  id: string;
  title: string;
  description: string;
  state: TeamTaskState;
  assignee?: string;
  dependencies: readonly string[];
  createdBy: string;
  resultSummary?: string;
  branch?: string;
  commit?: string;
  integrationId?: string;
  createdAt: string;
  updatedAt: string;
  history: readonly TeamTaskTransition[];
}
```

任务服务在每次创建、改依赖、完成、失败、取消和重新打开时重新计算受影响节点。拓扑检查使用 Kahn 算法；任务量设置合理上限，避免恶意任务图占满进程。

### TeamMessage

```typescript
type TeamMessage =
  | TextMessage
  | TaskNotificationMessage
  | StatusNotificationMessage
  | ApprovalRequestMessage
  | ApprovalResponseMessage
  | MemberIdleMessage
  | MemberInterruptedMessage
  | SystemNotificationMessage;

interface TeamMessageBase {
  id: string;
  type: string;
  sender: string;
  recipient: string;
  body: string;
  summary: string;
  timestamp: string;
  read: boolean;
}
```

协议消息在基础字段外携带 `taskId`、`approvalId`、`planVersion`、`decision` 等判别字段。时间戳、消息 ID、发件人和未读状态由服务端生成，不接受工具参数覆盖。

### TeamApprovalRecord

```typescript
type TeamApprovalState = 'pending' | 'approved' | 'rejected' | 'superseded' | 'cancelled';

interface TeamApprovalRecord {
  id: string;
  taskId: string;
  member: string;
  planVersion: number;
  plan: string;
  expectedOperations: readonly string[];
  state: TeamApprovalState;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  comment?: string;
}
```

审批有效键为 `(team, taskId, member, planVersion, approvalId)`。任务改派、重新打开或新计划提交时，旧 pending/approved 记录转为 `superseded`。

### MemberContextSnapshot

```typescript
interface MemberContextSnapshot {
  version: 1;
  revision: number;
  team: string;
  member: string;
  generation: number;
  roleRevision: number;
  systemPromptHash: string;
  messages: readonly Message[];
  usage: TokenUsage;
  mailboxCursor?: string;
  currentTaskId?: string;
  lastSafeIteration: number;
  uncertainOperationIds: readonly string[];
  updatedAt: string;
}
```

上下文在每轮模型响应与工具结果完整配对后保存。副作用工具执行前先写 `tool_started`，执行完成后写 `tool_finished`。启动时发现没有结束记录的副作用操作，将成员标记为 `interrupted` 并要求 Lead 明确处理，不自动重放。

### TeamIntegrationRecord

```typescript
type TeamIntegrationState =
  | 'preparing'
  | 'merging'
  | 'conflicted'
  | 'validating'
  | 'ready'
  | 'completed'
  | 'aborted'
  | 'failed';

interface TeamIntegrationRecord {
  id: string;
  team: string;
  leadBranch: string;
  leadHead: string;
  worktreeName: string;
  worktreeRoot: string;
  branch: string;
  orderedTaskIds: readonly string[];
  mergedTaskIds: readonly string[];
  currentTaskId?: string;
  state: TeamIntegrationState;
  conflictFiles: readonly string[];
  validationResults: readonly IntegrationValidationResult[];
  createdAt: string;
  updatedAt: string;
}
```

## 核心接口

### 持久化与锁

```typescript
interface RevisionStore<T extends { revision: number }> {
  read(): T | undefined;
  write(value: T, expectedRevision: number): T;
}

interface FileLock {
  withLock<T>(resource: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

interface TeamRepository {
  create(input: CreateTeamInput): TeamRecord;
  list(): readonly TeamSummary[];
  get(name: string): TeamSnapshot | undefined;
  activate(name: string, sessionId: string): TeamSnapshot;
  archive(name: string): Promise<TeamArchiveResult>;
  restore(name: string): TeamSnapshot;
}
```

`FileLock` 使用 `open(..., 'wx')` 创建锁，锁内容含 PID、实例 ID、创建时间和过期时间。只有超出 `stale_lock_ms` 且 PID 不存在或租约代次失效时才回收。重试使用有上限的间隔并响应取消信号。

### 任务与审批

```typescript
interface TeamTaskService {
  create(actor: TeamActor, input: CreateTeamTaskInput): TeamTaskRecord;
  update(actor: TeamActor, input: UpdateTeamTaskInput): TeamTaskRecord;
  assign(actor: TeamActor, taskId: string, member: string): Promise<TeamTaskRecord>;
  report(actor: MemberActor, input: ReportTaskInput): TeamTaskRecord;
  reopen(actor: LeadActor, taskId: string): TeamTaskRecord;
  cancel(actor: LeadActor, taskId: string, reason: string): TeamTaskRecord;
  list(actor: TeamActor, filter?: TeamTaskFilter): readonly TeamTaskRecord[];
  topologicalOrder(taskIds: readonly string[]): readonly TeamTaskRecord[];
}

interface TeamApprovalService {
  submit(actor: MemberActor, input: SubmitPlanInput): TeamApprovalRecord;
  decide(actor: LeadActor, input: DecidePlanInput): TeamApprovalRecord;
  activeApproval(team: string, taskId: string, member: string): TeamApprovalRecord | undefined;
  authorizeTool(actor: MemberActor, taskId: string, tool: Tool): ToolResult | undefined;
}
```

### 邮箱

```typescript
interface TeamMailboxService {
  send(actor: TeamActor, input: SendMessageInput): Promise<TeamMessage>;
  broadcast(actor: TeamActor, input: BroadcastMessageInput): Promise<readonly TeamMessage[]>;
  unread(actor: TeamActor, options?: ReadMailboxOptions): Promise<readonly TeamMessage[]>;
  markRead(actor: TeamActor, ids: readonly string[]): Promise<void>;
  subscribe(listener: (event: TeamMailboxEvent) => void): () => void;
}
```

消息先持久化，再调用后端 `wake`。唤醒失败只改变投递诊断，不回滚已写入消息。

### 成员后端

```typescript
interface TeamMemberBackend {
  readonly kind: TeamBackendKind;
  probe(context: BackendProbeContext): Promise<BackendProbeResult>;
  spawn(input: SpawnMemberInput): Promise<BackendInstance>;
  wake(instance: BackendInstance): Promise<void>;
  terminate(instance: BackendInstance, signal: AbortSignal): Promise<TerminateResult>;
  recover(lease: MemberRuntimeLease): Promise<BackendInstance | undefined>;
}

interface TeamBackendManager {
  select(requested: TeamBackendRequest, context: BackendProbeContext): Promise<BackendSelection>;
  spawn(member: TeamMemberRecord, selection: BackendSelection): Promise<BackendInstance>;
  wake(member: TeamMemberRecord): Promise<WakeResult>;
  terminate(member: TeamMemberRecord): Promise<TerminateResult>;
}
```

自动选择依次探测 tmux、当前终端对应的 WezTerm/iTerm2、自定义终端。全部不可用时返回 `TEAM_BACKEND_UNAVAILABLE` 和探测详情，不调用协程。只有 `requested.kind === 'coroutine'` 才允许协程后端。

### 成员运行

```typescript
interface TeamMemberRunner {
  run(input: TeamMemberRunInput, signal: AbortSignal): Promise<TeamMemberOutcome>;
  resume(input: TeamMemberResumeInput, signal: AbortSignal): Promise<TeamMemberOutcome>;
}

interface TeamExecutionPolicy {
  authorize(input: ToolPolicyInput): Promise<ToolResult | undefined>;
}

interface ToolExecutionObserver {
  beforeExecute(input: ToolExecutionObservation): Promise<void>;
  afterExecute(input: ToolExecutionObservation & { result: ToolResult }): Promise<void>;
}
```

`ToolScheduler` 增加可选硬策略和执行观察器。顺序固定为：工具存在与 Schema 校验、可见工具检查、Plan Mode、`TeamExecutionPolicy`、Hook、权限系统、执行。团队策略拒绝时返回普通结构化工具结果并继续 Agent Loop。

### 团队协调器

```typescript
interface TeamCoordinator {
  setSession(sessionId: string): Promise<void>;
  activeTeam(): TeamSnapshot | undefined;
  createMember(input: CreateTeamMemberInput): Promise<TeamMemberRecord>;
  resumeMember(name: string): Promise<TeamMemberRecord>;
  terminateMember(name: string, reason: string): Promise<TeamMemberRecord>;
  visibleLeadTools(): ReadonlySet<string>;
  leadPromptContent(): SupplementalPromptContent;
  instructionRuntime(sessionId: string): AgentInstructionRuntime;
  subscribe(listener: (event: TeamEvent) => void): () => void;
  close(): Promise<void>;
}
```

## 工具设计

团队工具在主 Registry 中以固定名称注册，并标记 owner 为 `team`。工具实现自身做 actor、团队、动作和对象归属校验；`TeamExecutionPolicy` 在执行前再做一层硬校验。

| 工具 | Lead | 成员 | 主要动作 |
|------|------|------|----------|
| `team_status` | 是 | 是 | 团队、成员、任务、阻塞和用量概览 |
| `team_member` | 是 | 否 | `list`、`create`、`resume`、`terminate` |
| `team_task` | 是 | 是（仅自身） | `create`、`get`、`list`、`update`、`assign`、`report`、`reopen`、`cancel` |
| `team_message` | 是 | 是 | `send`、`broadcast`、`read`、`mark_read` |
| `team_approval` | 是 | 是 | 成员 `submit`；Lead `list`、`decide` |
| `team_integrate` | 是 | 否 | `start`、`status`、`continue`、`abort`、`finalize` |

工具采用带 `action` 判别字段的 JSON Schema `oneOf`。执行前校验动作级身份，不能只依赖模型可见性。团队工具属于系统编排工具，不触发普通项目权限确认，但仍受 Plan Mode、团队 actor 策略和状态机约束。

普通子 Agent 的不可变禁用集合加入全部 `team_*` 工具。角色定义即使显式引用团队工具也视为 `FORBIDDEN_TOOL`。团队成员的协作工具由系统追加，不要求角色白名单声明，也不能通过角色黑名单移除恢复与报告所需的最小工具。

## 工具可见性组合

新增 `ToolVisibilityResolver` 统一组合 Skill 与团队能力：

1. 从 Registry 普通工具开始；
2. 应用 Skill 白名单；
3. 未激活团队时移除全部 `team_*`；
4. Team Lead 激活时追加 Lead 团队工具；
5. Coordinator 启用时移除 `Agent`、写文件、改文件及所有普通副作用工具，只重新加入受限 `run_command` 和团队编排工具；
6. Plan Mode 只保留只读普通工具和允许查询的团队动作，变更动作由执行策略再次拒绝。

`AgentLoop` 的 Provider definitions 和 `ToolScheduler.allowedToolNames` 使用同一份快照，避免“模型看不到但能伪造执行”或“模型看得到但执行层拒绝原因不一致”。

## 模块设计

### TeamPathGuard

**职责：** 校验团队名、成员名、团队数据根目录和所有持久化路径。

名称统一转小写，字符集限制为 ASCII 小写字母、数字、短横线和下划线，长度 1-64；保留 `lead` 作为邮箱身份，不允许成员占用。所有已存在路径先解析符号链接再检查归属，新路径检查最近存在父目录，防止用户目录符号链接逃逸。

### TeamStore 与 AtomicJsonStore

**职责：** 原子读写团队索引、元数据、成员、任务、审批、上下文和集成记录。

读取严格校验版本、字段和路径归属；未知新版本产生诊断，不尝试猜测。团队枚举按目录隔离错误。更新使用 revision CAS，避免独立 Worker 覆盖 Lead 的新状态。

### TeamTaskService

**职责：** 维护 DAG、任务状态、所有权和历史。

任务状态由显式转换表驱动。依赖完成后，未分派任务进入 `pending`，已分派任务进入 `ready`；需要审批的成员开始规划后进入 `waiting_approval`；获批或无需审批后进入 `running`。依赖失败、取消或重新打开时，尚未开始的后继任务回到 `blocked`。

### TeamMailboxService

**职责：** 名称解析、结构化消息校验、并发追加、读取游标、广播展开和后端唤醒。

Lead 邮箱使用保留身份 `lead`。广播在同一调用中为每个收件人生成不同消息 ID，逐邮箱锁定；部分失败返回成功与失败清单，不撤销已投递消息。

### TeamApprovalService

**职责：** 逐任务计划版本、响应关联和副作用授权。

成员等待审批时 Provider 仅看到角色允许的只读普通工具和成员协作工具。执行层仍检查所有普通副作用工具，防止伪造调用。批准后恢复角色工具快照；新计划、改派、重开任务立即使旧批准失效。

### TeamMemberRunner

**职责：** 恢复成员上下文、创建 scoped runtime、运行 Agent Loop、保存检查点和进入空闲。

定义式成员首次运行使用角色正文、团队固定协作规则和任务作为上下文；后续运行加载 `MemberContextSnapshot`，追加经过校验的未读任务或消息。每轮结束保存完整消息历史、Token 和邮箱游标。自然停止后将任务结果、成员状态和上下文快照作为一个受锁领域事务提交，再发送 `member_idle` 通知。

可写成员创建 `team/<team>/<member>` Worktree，任务之间只 `exit` 租约不调用 `finalize`；恢复时使用 `enter`。只读成员使用 Lead 项目根目录。角色工具能力变化时重新计算隔离，不能在共享目录中恢复新增副作用能力。

### OperationJournal

**职责：** 记录副作用工具不确定性。

执行前写 `tool_started`，包含调用 ID、工具名、参数摘要、任务和上下文 revision；完成后写 `tool_finished` 和结果摘要。参数与输出按现有敏感信息策略截断和脱敏。启动恢复时未配对记录进入 `uncertainOperationIds`，阻止自动恢复，Lead 处理后写 `tool_resolved`。

### Team Worker

**职责：** 在独立窗格中运行完整成员实例。

主入口抽取 `createApplicationServices()`，普通 TUI 与 Worker 共用 Provider、工具、MCP、角色、权限、Hook、ProjectRuntime 和 Worktree 初始化。隐藏 CLI 参数 `--team-worker <descriptor-path>` 进入 Worker 模式，不渲染 Ink；Worker 校验 0600 描述文件、团队路径、成员、代次和租约后启动 `TeamWorkerHost`。

Worker 空闲时保持轻量事件循环，监听 stdin 唤醒并按 `inbox_poll_interval_ms` 轮询邮箱兜底。每次写状态前检查团队 generation。心跳包含 PID、实例 ID、后端、窗格 ID、代次和时间戳。

### TeamBackendManager

**职责：** 后端探测、选择、启动、唤醒、恢复和终止。

- `TmuxBackend`：要求 `TMUX` 有效，使用 `tmux split-window -P -F` 获取 pane ID，唤醒使用 `send-keys Enter`。
- `WezTermBackend`：检测 `TERM_PROGRAM=WezTerm` 和 `wezterm cli`，使用 `split-pane`，记录 pane ID，使用 `send-text` 唤醒。
- `ITermBackend`：仅在 macOS 且识别 iTerm2 时使用 `osascript` 调用受控脚本，返回 session ID，通过固定脚本写入换行唤醒。
- `ConfiguredTerminalBackend`：按 argv 模板执行探测、启动和唤醒，不使用 shell。
- `CoroutineBackend`：在进程内创建 AbortController 和 Promise，运行同一个 `TeamMemberRunner`。

窗格启动只传 Worker 描述文件路径，不在命令行暴露 API Key、消息正文或计划内容。终止先发送协作取消和正常信号，超过超时后才按后端能力升级终止。

### TeamCoordinator

**职责：** 绑定主会话与活跃团队、管理成员生命周期、接入 Lead 工具、转发通知和关闭资源。

激活团队时递增 generation、验证 repositoryId、把遗留运行成员转为 `interrupted`、作废旧租约，再绑定当前会话。切换团队先停止当前团队在本进程的协程成员并释放监听器，但不归档团队。

Lead 关键通知通过 `TeamLeadInbox` 在下一个自然模型请求边界注入 `instruction` 消息，同时 UI 订阅事件立即显示简短状态。通知不会主动发起新的主 Agent 请求。

### TeamIntegrationManager

**职责：** 事务式代码集成。

开始集成前检查 Lead 工作区干净、当前分支和 HEAD 可识别、任务已完成、成员 Worktree 无未提交修改、提交属于对应分支。随后创建 `team-integration/<team>/<id>` Worktree，从记录的 Lead HEAD 建立临时分支，按任务 DAG 的稳定拓扑顺序执行 `git merge --no-ff --no-edit <member-branch>`。

发生冲突时记录冲突文件并暂停在 `conflicted`。普通 Lead 可以在临时 Worktree 内解决；Coordinator 必须把冲突解决任务分派给拥有专属 Worktree 写能力的成员，并明确把该成员临时 scoped cwd 绑定到集成 Worktree。`continue` 再次检查索引无未合并项后继续。无法解决时 `abort` 执行 merge abort 并删除或保留临时环境。

所有分支合并后，在临时 Worktree 串行运行配置的验证命令。验证全部通过且 Lead 分支仍指向原 `leadHead` 时，使用 `git merge --ff-only <integration-branch>` 一次性更新 Lead 分支；否则拒绝 finalize 并保留集成分支。

成功后，扩展 `WorktreeManager` 提供 `removeIntegrated(name, targetRef)`：只有 Worktree 干净、无租约且 Worktree HEAD 已被目标引用包含时才允许安全强制清理，不再把“已合入但未推送”误判为必须保留。成员 Worktree 同样在任务完成集成后使用该入口清理。

### Coordinator Shell Policy

**职责：** 在 Coordinator 模式下限制 `run_command`。

策略先拒绝 shell 元字符、重定向、管道、命令替换、换行、控制符和脚本解释器，再把命令解析为受限 argv。只接受 `git` 及精确白名单子命令：`status`、`diff`、`log`、`show`、`rev-parse`、`merge-base`、`branch --list`、`worktree list`，以及仅在当前活动集成 Worktree 中允许的 `merge --continue`、`merge --abort`。分支创建、删除、Worktree 创建和最终合并由 `team_integrate` 专用工具执行，不开放任意 Git 写命令。

白名单策略先于 Hook 和权限执行；通过后仍继续经过危险命令黑名单、沙箱、Hook 与权限规则。

### Team Command 与 UI

新增 `/team` 本地命令：

```text
/team list
/team create <名称>
/team use <名称>
/team status
/team archive <名称>
/team restore <名称>
```

命令通过 `CommandUIController.manageTeam(args)` 调用 TeamCoordinator，不经过模型。状态栏在活跃团队时显示 `[TEAM:<name>]`，Coordinator 生效时追加 `[COORDINATOR]`。`/status` 增加成员、任务、待审批、未读消息和集成状态。团队事件以简短中文消息显示，不渲染完整敏感消息正文。

## 状态机

### 成员状态

```text
creating ──成功──> idle
    └──失败──────> failed

idle ──任务/唤醒──> running
running ──提交计划──> waiting_approval
waiting_approval ──批准/驳回唤醒──> running
running ──自然完成──> idle
running ──异常──────> failed
running/waiting_approval ──进程失联/代次变化──> interrupted

idle/running/waiting_approval/interrupted/failed
    ──终止──> stopping ──> terminated
```

### 任务状态

```text
blocked ──依赖完成──> pending
pending ──分派且依赖完成──> ready
ready ──需要审批并提交计划──> waiting_approval
ready ──无需审批开始────────> running
waiting_approval ──批准─────> running
waiting_approval ──驳回─────> ready
running ──报告完成──────────> completed
running ──异常──────────────> failed
非终态 ──Lead 取消──────────> cancelled
completed/failed/cancelled ──Lead 重开──> blocked|pending|ready
```

状态更新必须同时校验当前 revision 和允许转换表。迟到事件只记录诊断，不回退终态。

## 关键交互流程

### 创建并启动成员

1. Lead 调用 `team_member(create)`，指定成员名、角色、审批要求和后端请求。
2. TeamCoordinator 获取角色快照，应用全局与角色工具过滤，计算普通工具副作用。
3. 可写成员获取长期 Worktree；只读成员绑定 Lead 根目录。
4. BackendManager 按优先级探测；自动模式没有独立后端时返回错误，不创建成员。
5. 原子写入成员记录和 Worker 描述文件，再启动后端。
6. Worker 或协程获取带 generation 的运行租约，心跳成功后成员从 `creating` 进入 `idle`。
7. 任一步失败都撤销未完成记录和安全释放新建资源；无法安全删除的 Worktree保留并报告。

### 分派、审批与完成

1. Lead 创建 DAG 任务并分派成员。
2. 任务依赖未完成时保持 blocked，不唤醒成员。
3. 依赖满足后写 task notification 并唤醒成员。
4. 需审批成员仅用只读工具形成计划，提交 `approval_request` 后进入等待。
5. Lead 回复结构化 `approval_response`；匹配批准恢复完整角色工具，驳回则要求新计划。
6. 成员运行时持续保存上下文安全边界和操作日志。
7. 完成后领域事务更新任务、成员和上下文，再通知 Lead 与依赖任务。

### 重启恢复

1. TeamRepository 扫描团队并隔离损坏对象。
2. 激活团队时 generation 加一，旧租约全部失效。
3. `running`、`stopping` 成员转为 `interrupted`；审批记录保持。
4. OperationJournal 检查未配对副作用操作，有不确定操作时禁止自动恢复。
5. Lead 显式 `resume` 后重新校验角色、工具、后端、工作目录和上下文。
6. 校验通过才启动新后端或协程，并从最后安全上下文继续。

### 团队归档

1. 团队进入 `archiving`，拒绝新的成员和任务变更。
2. 取消并终止活动成员，等待有限超时。
3. 对每个 Worktree 检查租约、脏状态、未推送状态和是否完成集成。
4. 安全对象清理；其余保留并记录原因。
5. 团队进入 `archived`，清除会话激活绑定但保留全部协作记录。

## 文件组织

```text
src/
├── bootstrap/
│   └── application.ts                 # 抽取普通 TUI 与 Team Worker 共用服务装配
├── config/
│   ├── types.ts                       # TeamConfig、终端适配配置
│   └── loader.ts                      # teams 配置解析与校验
├── agent/
│   ├── loop.ts                        # 接入统一可见性、执行策略和观察器
│   └── tool-scheduler.ts              # 硬策略与工具开始/结束回调
├── chat/
│   └── manager.ts                     # Team Lead 可见工具、提示和通知运行时
├── command/
│   ├── builtins.ts                    # /team 命令
│   └── types.ts                       # Team UI 控制接口
├── subagent/
│   ├── types.ts                       # 团队工具加入不可变禁用集合
│   └── tool-filter.ts                 # 普通子 Agent 排除团队工具
├── tool/
│   ├── visibility.ts                  # Skill、Team、Coordinator 可见性组合
│   └── types.ts                       # Team 错误码、执行策略公共类型
├── worktree/
│   ├── git-client.ts                  # 目标引用包含关系与集成安全检查
│   └── manager.ts                     # removeIntegrated
├── team/
│   ├── types.ts                       # 团队领域类型与状态枚举
│   ├── errors.ts                      # TeamError 与结构化错误码
│   ├── path-guard.ts                  # 名称和用户目录路径保护
│   ├── atomic-store.ts                # revision CAS 原子 JSON 存储
│   ├── file-lock.ts                   # 跨进程锁、重试与陈旧锁恢复
│   ├── repository.ts                  # 团队索引、元数据与恢复
│   ├── task-service.ts                # DAG 与任务状态机
│   ├── mailbox-store.ts               # JSONL 邮箱读写
│   ├── mailbox-service.ts             # 名称注册、协议、广播与唤醒
│   ├── approval-service.ts            # 审批版本与授权
│   ├── context-store.ts               # 成员上下文快照
│   ├── operation-journal.ts           # 副作用工具开始/结束日志
│   ├── member-runner.ts               # 长期成员 Agent Loop
│   ├── member-runtime.ts              # actor registry、ProjectRuntime 与提示
│   ├── coordinator.ts                 # Lead 编排、会话绑定与生命周期
│   ├── lead-inbox.ts                  # 请求边界通知注入
│   ├── tools.ts                       # 六个稳定团队工具
│   ├── tool-policy.ts                 # 审批、身份、Plan、Coordinator 策略
│   ├── prompts.ts                     # Lead 与成员动态补充指令
│   ├── worker-entry.ts                # 独立进程 Worker 模式
│   ├── worker-host.ts                 # 心跳、空闲、轮询和恢复
│   ├── integration-manager.ts         # 集成事务状态机
│   ├── integration-git.ts             # shell=false 的 Git 集成命令
│   ├── coordinator-shell.ts           # Coordinator Git 命令白名单
│   └── backend/
│       ├── types.ts                   # 后端接口
│       ├── process-runner.ts           # 有界输出与超时的 argv 执行
│       ├── manager.ts                 # 探测与显式选择
│       ├── tmux.ts                    # tmux 窗格
│       ├── wezterm.ts                 # WezTerm 窗格
│       ├── iterm2.ts                  # iTerm2 自动化
│       ├── configured.ts              # 用户配置适配器
│       └── coroutine.ts               # 同进程协程
├── ui/
│   └── app.tsx                        # Team 事件、状态栏和命令实现
└── index.tsx                           # 普通模式与 --team-worker 分流
```

每个领域模块配套同名 `.test.ts`。端到端测试集中在 `src/team/integration.test.ts`，使用临时用户目录、临时 Git 仓库、Fake Provider、Fake 后端和 Fake ProcessRunner，不依赖开发机安装 tmux、WezTerm 或 iTerm2。

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 长期团队与现有子 Agent 的关系 | 独立 Team 编排层，复用底层 Runner 能力 | 避免短任务状态与长期成员状态混合 |
| 事实源 | 用户目录中的版本化文件 | 满足跨进程、跨重启和人工检查，不引入数据库依赖 |
| 并发控制 | 原子 rename + revision CAS + 资源锁 | 同时覆盖快照一致性、并发更新和邮箱追加 |
| 旧 Worker 防双跑 | 团队 generation + 成员租约 + 心跳 | PID 检查不足以处理 PID 复用和主进程重启 |
| 成员上下文 | 每轮安全边界原子快照 | 空闲恢复直接，不依赖主会话历史 |
| 副作用崩溃恢复 | OperationJournal，不自动重放不确定操作 | 避免重复写文件、命令或外部工具调用 |
| 任务依赖 | 直接依赖 DAG + Kahn 检测 | 满足本章约束，算法可解释且易测试 |
| 审批 | 结构化协议与版本键 | 不解析自然语言，旧批准不能误放行新计划 |
| 后端降级 | 只有显式请求才能使用协程 | 严格满足“不静默降级” |
| 终端启动参数 | 0600 Worker 描述文件 | 命令行不暴露密钥、任务和消息正文 |
| 后端通信 | 文件邮箱 + 唤醒 + 低频轮询兜底 | 满足非实时通信，并避免唤醒失败丢任务 |
| 工具作用域 | Provider 可见性与执行前 actor 双检 | 防伪造调用和普通子 Agent 越权 |
| 审批拦截位置 | ToolScheduler 的硬策略层 | 比提示词或执行后转换更可靠，拒绝结果仍可回灌模型 |
| Coordinator Shell | argv 白名单与专用 Git 工具配合 | 保留必要查询能力，不给任意 shell 写文件通道 |
| Git 集成 | 临时 Worktree + 临时分支 + 最终 ff-only | 任一失败不改变 Lead 当前分支和工作区 |
| Worktree 清理 | 验证已被目标引用包含后专用清理 | 区分“未推送但已安全集成”和“可能丢失提交” |
| UI 接入 | `/team` 本地命令 + Agent 团队工具 | 生命周期操作确定且省 Token，Lead 编排仍可自主进行 |

## Spec 覆盖

| Spec | 技术归属 |
|------|----------|
| F1-F2 | TeamPathGuard、TeamRepository、generation 恢复流程 |
| F3 | AgentDefinitionManager 复用、TeamMemberRecord、成员创建校验 |
| F4 | TeamBackendManager 与五类后端适配器 |
| F5 | 角色工具副作用分析、WorktreeManager 长期租约 |
| F6 | Team 工具、ToolVisibilityResolver、TeamExecutionPolicy |
| F7-F8 | TeamTaskService、DAG 与任务状态机 |
| F9-F10 | FileLock、MailboxStore、MailboxService、结构化协议 |
| F11 | TeamApprovalService、审批期动态工具集与硬策略 |
| F12 | MemberContextStore、WorkerHost、空闲恢复流程 |
| F13-F14 | TeamCoordinator、LeadInbox、后端终止流程 |
| F15 | TeamIntegrationManager、IntegrationGit、removeIntegrated |
| F16-F17 | CoordinatorCapability、可见性过滤、CoordinatorShellPolicy |
| F18 | 归档状态机、Worktree 安全清理 |
| F19 | revision CAS、generation、故障隔离和脱敏诊断 |
| N1-N8 | 分层安全、原子持久化、超时、测试与兼容设计 |
