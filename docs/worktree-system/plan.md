# BetterCode Worktree 隔离系统 Plan

## 架构概览

本章新增独立的 `worktree` 领域层，并在 `subagent` 与工具运行时之间增加按项目根目录构造作用域的工厂。Git Worktree 的创建、恢复、租约、保护删除和定时清理由 `WorktreeManager` 统一负责；`SubAgentRunner` 不直接拼接路径或执行 Git 命令。

整体分为六个协作部分：

1. `WorktreeName` 与 `WorktreePathGuard` 在所有磁盘和 Git 操作前完成名称、规范化路径、符号链接和仓库边界校验。
2. `GitWorktreeClient` 用无 shell 的 Git 子进程封装仓库识别、Worktree 创建、hooks 配置、变更检查、上游检查和安全移除。
3. `WorktreeMetadataStore` 以原子 JSON 文件记录归属和生命周期；`WorktreeInitializer` 执行复制、忽略文件补齐和依赖软链。
4. `WorktreeManager` 串联创建、快速恢复、进入、退出、删除和过期清理，并用名称级互斥与引用计数租约保证并发一致性。
5. `ProjectRuntimeFactory` 从主工具注册表复制稳定的非核心工具，为目标绝对根目录重建核心文件工具、路径沙箱、权限、上下文、项目指令和记忆补充信息。
6. `SubAgentRunner` 根据角色的 `isolation` 声明申请 Worktree 租约，使用对应项目运行时执行 Agent Loop，最终释放租约并触发安全自动清理；任务管理器记录并发布隔离状态。

```text
定义式 Agent 调度
    |
    | definition.isolation === 'worktree'
    v
WorktreeManager.acquire(role/taskId)
    |-- WorktreeName / WorktreePathGuard
    |-- WorktreeMetadataStore
    |-- GitWorktreeClient
    `-- WorktreeInitializer
            |
            v
      WorktreeLease { cwd, branch, baseCommit }
            |
            v
ProjectRuntimeFactory.create(cwd)
    |-- Scoped ToolRegistry + PathGuard
    |-- PermissionManager
    |-- ContextManager
    |-- ToolExecutionState
    |-- 项目指令 + 项目记忆
    `-- Scoped HookRuntime(projectRoot = cwd)
            |
            v
       SubAgentRunner / AgentLoop
            |
            v
release lease -> safe cleanup -> deleted | retained
```

### Spec 对齐

| Spec | 技术归属 |
|------|----------|
| F1 | 角色 parser、loader、`AgentDefinitionMetadata.isolation` |
| F2-F3 | `name.ts`、`path-guard.ts`、固定目录与分支映射 |
| F4-F5 | `WorktreeManager`、`WorktreeMetadataStore`、租约状态 |
| F6 | `WorktreeInitializer`、`WorktreeConfig` |
| F7-F8 | `ProjectRuntimeFactory`、绝对路径文件读取缓存 |
| F9 | `SubAgentRunner`、子 Agent Prompt、任务隔离状态 |
| F10-F11 | Git 状态检查、删除保护、任务结束清理 |
| F12 | `WorktreeCleanupScheduler` |
| F13 | `WorktreeError`、`WorktreeEvent`、任务事件映射 |
| F14 | Config loader、启动与关闭编排、兼容路径 |

## 核心数据结构

### 配置结构

`config.yaml` 顶层增加可选 `worktrees`。规则中的路径始终相对主工作区，配置解析阶段拒绝绝对路径和 `..` 段，应用阶段仍会再次执行真实路径边界校验。

```typescript
export interface WorktreeCopyRuleConfig {
  source: string;
  target?: string;
  required?: boolean;
}

export interface WorktreeSymlinkRuleConfig {
  source: string;
  target?: string;
  required?: boolean;
}

export interface WorktreeConfig {
  retention_days?: number;
  cleanup_interval_ms?: number;
  copy_files?: WorktreeCopyRuleConfig[];
  ignored_files?: WorktreeCopyRuleConfig[];
  symlinks?: WorktreeSymlinkRuleConfig[];
}

export interface AppConfig {
  // 既有字段保持不变
  worktrees?: WorktreeConfig;
}
```

解析后统一为毫秒和完整规则：

```typescript
export interface ResolvedWorktreeOptions {
  retentionMs: number;          // 默认 7 天
  cleanupIntervalMs: number;    // 默认 3_600_000
  copyFiles: readonly WorktreeCopyRule[];
  ignoredFiles: readonly WorktreeCopyRule[];
  symlinks: readonly WorktreeSymlinkRule[];
}
```

建议范围：保留天数 `1..3650`，扫描间隔 `60_000..86_400_000` 毫秒，每类项目规则最多 100 条。内置可选规则不写入用户配置：复制 `.env`、`.env.local`、`.env.*.local` 和 `BETTERCODE.local.md`，软链已存在的 `node_modules`。`ignored_files` 匹配结果必须经过 Git 忽略检查后才复制；单条 glob 最多处理 1000 个条目。

示例：

```yaml
worktrees:
  retention_days: 7
  cleanup_interval_ms: 3600000
  copy_files:
    - source: config/development.local.yaml
      required: true
  ignored_files:
    - source: generated/runtime/**
  symlinks:
    - source: .venv
      target: .venv
```

### 名称与路径

```typescript
export const MAX_WORKTREE_NAME_LENGTH = 120;
export const MAX_WORKTREE_SEGMENT_LENGTH = 48;

export interface WorktreeLocation {
  name: string;
  rootDir: string;
  branch: string;
  metadataPath: string;
}

export function validateWorktreeName(input: string): string;

export class WorktreePathGuard {
  readonly mainRoot: string;
  readonly worktreesRoot: string;
  readonly metadataRoot: string;

  location(name: string): WorktreeLocation;
  assertExistingWorktree(path: string): string;
  assertSource(path: string): string;
  assertTarget(path: string): string;
}
```

每段使用 `^[a-z0-9](?:[a-z0-9._-]*[a-z0-9_-])?$`，并额外拒绝空段、`.`、`..`、连续点号、`.lock` 结尾、`@{`、控制字符和 Git 不接受的引用形式。总长不超过 120，单段不超过 48。目录为 `.bettercode/worktrees/<name>`，元数据为 `.bettercode/worktree-state/<name>.json`，分支为 `bettercode/worktree/<name>`。

### 元数据与状态

```typescript
export type WorktreeLifecycleState =
  | 'creating'
  | 'ready'
  | 'deleting'
  | 'retained'
  | 'error';

export interface WorktreeMetadata {
  version: 1;
  name: string;
  repositoryId: string;
  mainRoot: string;
  worktreeRoot: string;
  gitDir: string;
  branch: string;
  baseCommit: string;
  state: WorktreeLifecycleState;
  createdAt: string;
  lastUsedAt: string;
  initializationComplete: boolean;
  lastError?: { code: WorktreeErrorCode; message: string };
}

export class WorktreeMetadataStore {
  read(name: string): WorktreeMetadata | undefined;
  write(metadata: WorktreeMetadata): void;
  remove(name: string): void;
  list(limit?: number): WorktreeMetadata[];
}
```

状态文件写入同目录临时文件后原子重命名。快速恢复只接受 `version`、仓库身份、规范化路径、名称、分支、Git 目录指针和 `initializationComplete` 全部一致的 `ready` 或 `retained` 元数据。恢复时通过读取 Worktree 根目录的 `.git` 指针及其 `HEAD` 文件确认分支，不调用 Git 子进程。

### Git 客户端

```typescript
export interface GitRepositoryIdentity {
  mainRoot: string;
  commonGitDir: string;
  repositoryId: string;
}

export interface GitProtectionStatus {
  dirty: boolean;
  unpushed: boolean;
  hasNewCommits: boolean;
  upstream?: string;
  reasons: readonly string[];
}

export interface GitWorktreeClient {
  inspectRepository(rootDir: string): Promise<GitRepositoryIdentity>;
  resolveHead(rootDir: string): Promise<string>;
  create(input: { mainRoot: string; rootDir: string; branch: string; baseCommit: string }): Promise<string>;
  configureHooks(mainRoot: string, rootDir: string): Promise<void>;
  isIgnored(mainRoot: string, paths: readonly string[]): Promise<ReadonlySet<string>>;
  inspectProtection(metadata: WorktreeMetadata): Promise<GitProtectionStatus>;
  assertRegistered(metadata: WorktreeMetadata): Promise<void>;
  removeWorktree(metadata: WorktreeMetadata, force: boolean): Promise<void>;
  deleteBranch(metadata: WorktreeMetadata, force: boolean): Promise<void>;
}
```

默认实现使用 `spawn` 或 `execFile` 参数数组执行 `git`，禁止 `shell: true`，单次命令有超时、输出上限和取消处理。创建使用等价于 `git worktree add -b <branch> <path> <baseCommit>` 的参数。删除前通过 `git worktree list --porcelain` 校验路径、分支和 Git 登记一致。

未推送检查固定为：先验证当前分支仍包含创建基点；再计算创建基点到 `HEAD` 的新增提交；没有新增提交时不视为未推送；存在新增提交但没有上游时视为未推送；存在上游时，只要 `HEAD` 有上游未包含的提交就视为未推送。分支偏离创建基点、上游查询失败或状态无法确认时按保护性失败处理。

### 初始化规则

```typescript
export interface WorktreeInitializationDiagnostic {
  kind: 'copy' | 'ignored_file' | 'symlink' | 'git_hooks';
  source?: string;
  target?: string;
  required: boolean;
  message: string;
}

export interface WorktreeInitializationResult {
  diagnostics: readonly WorktreeInitializationDiagnostic[];
}

export class WorktreeInitializer {
  initialize(metadata: WorktreeMetadata, signal?: AbortSignal): Promise<WorktreeInitializationResult>;
}
```

初始化顺序为 Git hooks、内置复制、项目复制、忽略文件复制、内置软链、项目软链。复制保留文件权限并按相对结构创建父目录；目录复制不跟随内部符号链接。软链使用从目标目录到主工作区源的相对链接，目标存在时只有内容等价或指向同一源才视为成功，否则拒绝覆盖。

Git hooks 优先复用主工作区有效的 `core.hooksPath`；没有自定义路径时确认共享 Git 目录的默认 hooks 可见。需要 Worktree 独立配置时启用 Git 的 worktree config，并只写入目标 Worktree 的 `core.hooksPath`。

### 生命周期、租约与结果

```typescript
export interface WorktreeHandle {
  name: string;
  cwd: string;
  branch: string;
  baseCommit: string;
  recovered: boolean;
  diagnostics: readonly WorktreeInitializationDiagnostic[];
}

export interface WorktreeLease extends WorktreeHandle {
  leaseId: string;
}

export type WorktreeRemovalResult =
  | { status: 'deleted'; name: string; cwd: string; branch: string }
  | { status: 'retained'; name: string; cwd: string; branch: string; reasons: readonly string[] }
  | { status: 'missing'; name: string };

export interface WorktreeManager {
  initialize(): Promise<void>;
  create(name: string, signal?: AbortSignal): Promise<WorktreeHandle>;
  enter(name: string): Promise<WorktreeLease>;
  acquire(name: string, signal?: AbortSignal): Promise<WorktreeLease>;
  exit(leaseId: string): Promise<void>;
  remove(name: string, options?: { force?: boolean }): Promise<WorktreeRemovalResult>;
  finalize(leaseId: string): Promise<WorktreeRemovalResult>;
  cleanupExpired(now?: Date): Promise<readonly WorktreeRemovalResult[]>;
  subscribe(listener: (event: WorktreeEvent) => void): () => void;
  close(): Promise<void>;
}
```

`acquire` 是 `create` 加 `enter` 的编排入口。每个安全名称通过内部 Promise 队列串行化，避免两个任务同时创建或删除同一目录。租约使用随机 ID 存入内存映射并按名称计数；`exit` 幂等，`finalize` 先释放指定租约，再在没有活动租约时尝试非强制删除。

快速恢复路径不执行 Git，也不重复环境初始化。它读取元数据、目录 `.git` 指针和关联 `HEAD`，更新内存句柄及最后使用时间后返回 `recovered: true`。元数据状态不完整时拒绝恢复，交给用户显式处理。

### 错误与事件

```typescript
export type WorktreeErrorCode =
  | 'INVALID_NAME'
  | 'NOT_GIT_REPOSITORY'
  | 'PATH_OUTSIDE_ROOT'
  | 'DIRECTORY_CONFLICT'
  | 'METADATA_MISMATCH'
  | 'GIT_CREATE_FAILED'
  | 'INITIALIZATION_FAILED'
  | 'ACTIVE_LEASE'
  | 'DIRTY_WORKTREE'
  | 'UNPUSHED_COMMITS'
  | 'GIT_STATE_UNKNOWN'
  | 'DELETE_FAILED'
  | 'CANCELLED';

export class WorktreeError extends Error {
  readonly code: WorktreeErrorCode;
  readonly details: Record<string, string | number | boolean>;
}

export type WorktreeEvent =
  | { type: 'creating'; name: string; cwd: string; branch: string }
  | { type: 'created'; handle: WorktreeHandle }
  | { type: 'recovered'; handle: WorktreeHandle }
  | { type: 'entered'; name: string; leaseId: string; activeLeases: number }
  | { type: 'exited'; name: string; leaseId: string; activeLeases: number }
  | { type: 'retained'; result: Extract<WorktreeRemovalResult, { status: 'retained' }> }
  | { type: 'deleted'; result: Extract<WorktreeRemovalResult, { status: 'deleted' }> }
  | { type: 'cleanup_failed'; name: string; code: WorktreeErrorCode; message: string };
```

事件发布时复制并冻结数据，监听器异常不影响生命周期。错误详情只包含路径、分支、计数和错误码，不包含文件内容、命令环境或配置值。

### 项目运行时作用域

```typescript
export interface ProjectRuntimeScope {
  rootDir: string;
  registry: ToolRegistry;
  permissionManager: PermissionManager;
  contextManager: ContextManager;
  executionState: ToolExecutionState;
  supplemental: SupplementalPromptContent;
  close(): Promise<void>;
}

export interface ProjectRuntimeFactory {
  create(rootDir: string, permissionMode: PermissionMode): ProjectRuntimeScope;
}
```

主注册表新增只读注册快照能力，返回工具实例和 `owner/system` 元信息。工厂先为目标根目录创建新的六个核心工具，再复制主注册表中的非核心工具实例及注册元信息。核心文件工具由新 `PathGuard` 构造；命令、Skill 脚本和其他读取 `ToolContext.rootDir` 的工具自然使用新目录；MCP 适配器继续共享已缓存连接。`agent` 与 `load_skill` 虽可被复制以保持工具集合稳定，仍会被子 Agent 的全局过滤层移除。

权限管理工厂扩展为可接受目标注册表，项目、local 规则和沙箱均从目标绝对根目录加载。项目指令通过 `loadInstructions(rootDir)` 读取，长期记忆通过 `MemoryManager(rootDir)` 读取。运行时作用域不持有进程级“当前目录”。

`ToolExecutionState` 的文件读取键从相对路径改为规范化绝对路径：

```typescript
export interface CachedFileRead {
  absolutePath: string;
  size: number;
  mtimeMs: number;
  content: string;
}
```

`read_file` 使用 `PathGuard` 返回的绝对路径读写缓存。`ContextManager`、项目指令和记忆实例均以 `path.resolve(rootDir)` 构造；需要跨作用域保存的资源映射只允许使用规范化绝对根目录作为 key。

### 子 Agent 隔离状态

角色定义增加：

```typescript
export type AgentIsolation = 'none' | 'worktree';

export interface AgentDefinitionMetadata {
  // 既有字段保持不变
  isolation: AgentIsolation;
}
```

frontmatter 缺省归一化为 `none`。内置角色保持 `none`，除非其定义显式声明。任务记录增加有界状态：

```typescript
export interface SubAgentWorktreeState {
  isolation: 'worktree';
  name: string;
  path?: string;
  branch?: string;
  baseCommit?: string;
  state: 'preparing' | 'active' | 'deleted' | 'retained' | 'failed';
  reasons?: readonly string[];
}

export interface SubAgentTaskRecord {
  // 既有字段保持不变
  worktree?: SubAgentWorktreeState;
}
```

`SubAgentTaskManager.updateWorktree(taskId, update)` 是唯一写入口，并发布 `task_worktree` 事件。前台工具结果、后台结果回流和 `/tasks <id>` 格式化都包含最终隔离状态；隔离准备失败映射为 `SUBAGENT_WORKTREE_ERROR`，不执行 Agent Loop。

## 模块设计

### WorktreeName 与 WorktreePathGuard

**职责：** 在所有副作用之前完成安全名称、目录映射、真实路径和符号链接边界检查。

**对外接口：** `validateWorktreeName`、`WorktreePathGuard.location`、`assertExistingWorktree`、`assertSource`、`assertTarget`。

**依赖：** Node.js `path`、`fs.realpath`、仓库初始化得到的主根目录。

路径守卫使用 `path.relative` 判断包含关系，不使用字符串前缀。目标尚不存在时向上寻找最近的已存在父目录并解析真实路径；目标已存在时同时拒绝根目录本身是符号链接的情况。

### GitWorktreeClient

**职责：** 以参数数组执行受限 Git 子命令，归一化 Git 输出和错误，提供可测试的仓库操作接口。

**对外接口：** 仓库识别、解析 HEAD、创建、hooks 配置、ignored 检查、保护状态、登记校验、移除目录和删除分支。

**依赖：** Node.js 子进程、AbortSignal、输出限制工具。

每次命令都显式传 `cwd`，不调用 `process.chdir`。分支和路径只能来自已验证的 `WorktreeLocation`。stderr 先截断再写入内部诊断，用户错误只保留稳定摘要。

### WorktreeMetadataStore

**职责：** 持久化 Worktree 归属、状态和恢复信息，提供有界扫描。

**对外接口：** `read`、`write`、`remove`、`list`。

**依赖：** `WorktreePathGuard`、原子文件写入。

元数据文件按安全名称嵌套，避免单一共享 JSON 在并发任务中产生覆盖。读取时严格校验字段、版本和路径，不兼容版本返回诊断而不是猜测迁移。

### WorktreeInitializer

**职责：** 应用内置和项目初始化规则，并按 required 语义汇总结果。

**对外接口：** `initialize`。

**依赖：** `WorktreePathGuard`、`GitWorktreeClient`、`fast-glob`、文件系统。

初始化只在首次成功创建时运行。必需步骤失败抛出 `INITIALIZATION_FAILED`；可选失败写入结果诊断。复制前后二次检查真实路径，拒绝递归复制 `.bettercode/worktrees` 和 `.bettercode/worktree-state`。

### WorktreeManager

**职责：** 实现生命周期状态机、名称级互斥、租约计数、保护删除、回滚和事件。

**对外接口：** `initialize`、`create`、`enter`、`acquire`、`exit`、`remove`、`finalize`、`cleanupExpired`、`subscribe`、`close`。

**依赖：** 名称与路径守卫、Git 客户端、元数据存储、初始化器。

首次创建先写 `creating` 元数据，再建立 Git Worktree、更新 Git 目录信息、初始化环境，最后写 `ready`。失败时只清理由本次调用确认创建的资源。删除先写 `deleting`，成功移除目录和分支后才删除元数据；失败则写 `error` 并保留重试信息。

### WorktreeCleanupScheduler

**职责：** 启动扫描和每小时定时扫描，筛选七天前的候选并调用普通删除。

**对外接口：** `start`、`runNow`、`close`。

**依赖：** `WorktreeMetadataStore`、`WorktreeManager`。

定时器使用 `unref`，同一时间只允许一个扫描运行。过滤顺序固定为路径、归属、变更；每个候选独立捕获异常。关闭只停止新扫描并等待当前扫描结束，不强制删除任何目录。

### ProjectRuntimeFactory

**职责：** 为主工作区或 Worktree 创建根目录绑定的工具、权限、上下文、提示和缓存状态。

**对外接口：** `create`。

**依赖：** 主 `ToolRegistry`、核心工具工厂、权限工厂、`ContextManager`、`MemoryManager`、项目指令加载器。

工厂不复制 Provider 或 MCP 会话。作用域关闭时清除本任务读取缓存并关闭 ContextManager，不修改共享注册表、Skill 状态、Hook 定义或其他作用域。

### SubAgentRunner 与 Coordinator

**职责：** 根据定义式角色隔离声明选择主项目作用域或 Worktree 作用域，更新任务状态并保证 finally 清理。

**对外接口：** 保持 `SubAgentRunner.run` 和 Coordinator 的统一 `agent` 工具入口；运行上下文增加 Worktree 状态更新回调。

**依赖：** `ProjectRuntimeFactory`、`WorktreeManager`、任务管理器、Hook manager。

Coordinator 在任务 ID 生成后仍按现有微任务启动运行，Runner 使用 `<definition.name>/<taskId>` 生成名称。Fork 路径跳过 WorktreeManager。隔离定义式路径先 acquire，再创建 runtime；Prompt 增加优先级高于普通环境提醒的 Worktree 约束段。finally 顺序为关闭 Hook scope、清除执行状态、关闭上下文、释放 Skill 执行锁、关闭项目运行时、`WorktreeManager.finalize`。

### Hook 作用域

**职责：** 让共享 Hook 规则在子 Agent 的实际项目根目录执行。

**对外接口：** `HookManager.createAgentScope` 输入增加可选 `projectRoot`。

**依赖：** 现有 Hook 规则和 ActionExecutor。

子 Agent Hook 上下文的 `projectRoot` 使用运行时根目录。命令动作改为使用事件上下文中的 `projectRoot` 作为 cwd，而不是 ActionExecutor 构造时的主根目录；主 Agent 事件仍传主根目录。HTTP、提示词和 Agent 动作行为不变。

## 模块交互

### 启动

1. 解析主工作区和 `worktrees` 配置，创建主工具注册表及共享 MCP、Skill、角色定义。
2. `GitWorktreeClient.inspectRepository` 确认当前目录为 Git 工作区并得到 common Git dir；如果当前项目不是 Git 仓库，只禁用 Worktree 隔离能力，未启用隔离的 BetterCode 仍可启动。
3. 构造 PathGuard、MetadataStore、Initializer、WorktreeManager 和 CleanupScheduler。
4. WorktreeManager 完成运行目录边界检查，CleanupScheduler 异步执行一次启动扫描并启动 `unref` 定时器。
5. 将 WorktreeManager 和 ProjectRuntimeFactory 注入 SubAgentRunner。

### 创建并运行隔离子 Agent

1. Coordinator 解析定义式角色并创建 `sa-<uuid>` 任务，任务管理器将隔离状态置为 `preparing`。
2. Runner 生成 `<角色>/<任务编号>`，调用 WorktreeManager.acquire。
3. Manager 在名称级互斥中校验名称和路径。目录不存在时读取主 `HEAD`、创建分支与 Worktree、写元数据并初始化；目录存在时只读文件系统和元数据完成快速恢复。
4. Manager 创建租约并发布 entered；Runner 把路径、分支和基点写入任务状态。
5. ProjectRuntimeFactory 为租约 `cwd` 创建作用域，Runner 基于该 registry 和 permission manager 创建 AgentLoop。
6. AgentLoop 每轮从作用域根目录构造环境提醒，工具调度显式使用 scoped registry；Hook command 使用同一 `projectRoot`。
7. 子 Agent 完成、失败或取消后 Runner 在 finally 中关闭运行时并调用 finalize。
8. finalize 释放租约并执行普通删除。安全时状态变为 `deleted`；存在变更或未推送提交时状态变为 `retained`，任务原结果保持不变。

### 快速恢复

1. acquire 发现目标目录已存在，读取对应元数据。
2. PathGuard 验证目录真实路径；MetadataStore 验证仓库身份、名称和记录路径。
3. 读取 `.git` 指针，验证 Git dir 位于记录的 common Git dir 下；读取关联 HEAD 文件验证专属分支。
4. 确认初始化完成后更新最后使用时间、创建租约并返回，全程不调用 Git 客户端。

### 默认删除与强制删除

1. 名称级互斥锁阻止并发创建或删除，活动租约检查始终最先执行。
2. 重新验证元数据、真实路径和 Git Worktree 登记。
3. 非强制删除调用保护检查；dirty、unpushed 或状态未知均返回 retained。
4. 强制删除跳过 dirty 和 unpushed 拒绝，但不跳过租约、路径、仓库、元数据和 Git 登记校验。
5. Git 客户端移除 Worktree，再删除专属本地分支，最后删除元数据和空父目录。

### 过期清理

1. 启动或定时触发读取最多固定数量的元数据，按 lastUsedAt 排序。
2. 只处理超过保留期限的记录，先做路径过滤，再做归属与租约过滤，最后做 Git 变更过滤。
3. 通过者调用普通删除；任何失败只发布 cleanup_failed 并继续下一项。

## 文件组织

```text
src/
├── config/
│   ├── types.ts                         — WorktreeConfig 与规则配置
│   ├── loader.ts                        — worktrees 字段集中校验
│   └── loader.test.ts                   — 配置默认值、边界和非法规则
├── worktree/
│   ├── types.ts                         — 元数据、租约、结果、错误和事件类型
│   ├── name.ts                          — 安全名称与分支后缀校验
│   ├── name.test.ts                     — 路径遍历和 Git ref 边界
│   ├── path-guard.ts                    — 主仓库、Worktree、源与目标真实路径保护
│   ├── path-guard.test.ts               — 前缀碰撞和符号链接逃逸
│   ├── git-client.ts                    — 无 shell Git 子进程封装
│   ├── git-client.test.ts               — 创建、dirty、upstream 和登记检查
│   ├── metadata-store.ts                — 原子元数据与有界扫描
│   ├── metadata-store.test.ts           — 损坏、越界和并发写入
│   ├── initializer.ts                   — hooks、复制、ignored、软链初始化
│   ├── initializer.test.ts              — required 语义和路径安全
│   ├── manager.ts                       — 创建、恢复、租约、删除和回滚
│   ├── manager.test.ts                  — 生命周期、快速恢复和保护删除
│   ├── cleanup.ts                       — 启动与定时过期清理
│   └── cleanup.test.ts                  — 三层过滤、并发扫描和关闭
├── runtime/
│   ├── project-runtime.ts               — 按绝对根目录创建运行时作用域
│   └── project-runtime.test.ts           — 工具、权限、提示和缓存隔离
├── tool/
│   ├── registry.ts                      — 注册快照供作用域复制
│   ├── registry.test.ts                 — 核心替换与共享工具快照
│   ├── execution-state.ts               — 绝对路径读取缓存键
│   ├── execution-state.test.ts           — 跨根目录同名文件隔离
│   ├── factory.ts                       — scoped registry 构造
│   └── tools/read-file.ts               — 使用绝对路径缓存
├── permission/
│   ├── factory.ts                       — 支持目标 registry/root
│   └── manager.test.ts                  — Worktree 沙箱与规则根目录
├── hook/
│   ├── types.ts                         — Agent scope 接受 projectRoot
│   ├── manager.ts                       — scoped HookContext 根目录
│   ├── action-executor.ts               — command cwd 取 context.projectRoot
│   └── manager.test.ts                  — 主/子 Agent Hook cwd 隔离
├── subagent/
│   ├── types.ts                         — isolation 与任务 Worktree 状态
│   ├── parser.ts                        — isolation frontmatter 解析
│   ├── parser.test.ts                   — 缺省、合法值和非法值
│   ├── prompts.ts                       — Worktree 路径与分支约束段
│   ├── prompts.test.ts                  — 隔离提示内容
│   ├── runner.ts                        — acquire、scoped runtime、finally 清理
│   ├── runner.test.ts                   — 正常、失败、取消和 retained 路径
│   ├── task-manager.ts                  — Worktree 状态更新与事件
│   ├── task-manager.test.ts             — 状态机和终态保护
│   ├── coordinator.ts                   — 前台结果元数据和 Hook 入口接入
│   ├── format.ts                        — /tasks 与后台回流展示隔离结果
│   └── integration.test.ts              — 两个 Worktree 子 Agent 并发隔离
├── index.tsx                            — 构造、启动和关闭 Worktree 服务
└── ...
.gitignore                               — 忽略 worktrees 与 worktree-state
config.yaml                              — 增加注释化可选配置示例
docs/worktree-system/                    — 本章四份文档
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 隔离范围 | 仅 `isolation: worktree` 的定义式角色 | 与已确认范围一致，Fork 保持缓存和当前目录语义 |
| 创建基点 | 主工作区当前 `HEAD` | 不复制未提交修改，基准明确且可用于未推送判断 |
| 目录与分支 | 固定 `.bettercode/worktrees` 与 `bettercode/worktree/` | 可预测、易忽略、便于三层安全过滤 |
| 名称来源 | `<角色>/<任务编号>` 系统生成 | 支持并发且不扩大模型可控路径面 |
| Git 调用 | 参数数组、无 shell、显式 cwd | 避免命令注入和全局目录切换 |
| 快速恢复 | 文件系统 + 原子元数据 + Git 指针文件 | 满足不调用 Git，同时不接管未知目录 |
| 并发控制 | 名称级 Promise 互斥 + 引用计数租约 | 防止重复创建和运行中删除，无需全局串行化 |
| 运行时隔离 | 按根目录创建 ProjectRuntimeScope | 适配现有固定 PathGuard，避免共享可变 cwd |
| 非核心工具 | 从主注册表复制工具实例 | MCP 连接和 Skill 脚本可共享，工具列表保持一致 |
| 核心工具 | 每个根目录重新构造 | 文件工具内部持有 PathGuard，不能跨根目录复用 |
| 缓存键 | 规范化绝对路径 | 同名相对路径在不同 Worktree 中天然隔离 |
| Hook cwd | 使用事件 `projectRoot` | 共享规则定义的同时让命令动作落到正确 Worktree |
| 环境初始化 | 内置惯例 + 项目追加规则 | 当前项目开箱可用，同时支持其他技术栈 |
| 初始化失败 | required 严格、optional 诊断 | 核心环境可保证，非关键惯例不阻断任务 |
| 删除策略 | clean 且无 unpushed 自动删除 | 默认保护成果，安全时避免目录和分支堆积 |
| 强制删除 | 显式 force，仅绕过变更保护 | 保留用户处理能力，不削弱路径和归属硬边界 |
| 过期策略 | 启动一次 + 每小时，默认 7 天 | 兼顾恢复窗口和磁盘清理，定时器不阻止退出 |
| 失败策略 | 单 Worktree 故障隔离 | 隔离功能失败不拖垮主 Agent 或其他任务 |

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| `.bettercode` 或目标父目录被替换为符号链接 | 每次副作用前解析最近现存父目录，创建后再次 realpath 校验 |
| Git Worktree 已被外部命令改名或移除 | 元数据、`.git` 指针和 `git worktree list` 多重核对，状态未知时拒绝删除 |
| 子 Agent 完成时产生未追踪文件 | `git status --porcelain --untracked-files=all` 纳入 dirty 判断 |
| 无 upstream 导致误删本地 commit | 只要相对基点有新增提交且无 upstream 就按未推送保护 |
| 初始化 glob 匹配海量文件 | 每规则和总候选数量设上限，超限的 required 规则失败、optional 规则诊断 |
| 软链把工具写入主依赖目录 | 只对明确依赖规则建链，目标冲突拒绝；此章不承诺依赖目录写隔离 |
| Skill/MCP 热更新与作用域工具不同步 | 任务启动时复制不可变工具快照，运行中不改变该 Agent 工具集合 |
| 清理与任务启动竞态 | 同名互斥和活动租约过滤，删除前再次校验 |
| 应用退出时后台任务仍持有租约 | 先关闭 SubAgentCoordinator 并等待任务 finally，再关闭清理器和 WorktreeManager |

## 测试策略

- 名称、路径、元数据和配置使用纯单元测试覆盖恶意输入、符号链接、损坏状态与上限。
- Git 客户端与 Manager 使用临时真实 Git 仓库，测试分支创建、Worktree 登记、dirty、无 upstream、模拟 upstream 和删除。
- 快速恢复测试注入记录型 Git 客户端，断言目录已存在且元数据合法时没有任何 Git 方法调用。
- ProjectRuntimeFactory 在主目录和两个临时 Worktree 中创建同名文件，验证读取缓存、写入、命令 cwd、权限和项目指令互不串用。
- SubAgent 集成测试并发启动两个声明隔离的定义式任务，验证任务路径、分支、工具执行目录、保留/删除结果和事件。
- 回归运行 `pnpm typecheck`、相关 `tsx --test` 测试及最终 `pnpm check`。
