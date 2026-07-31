# BetterCode 子 Agent 系统 Plan

## 架构概览

本章新增独立的 `subagent` 领域层，不把子 Agent 塞进 SkillRunner，也不为每个角色复制一套 Agent 实现。现有 `AgentLoop` 继续作为唯一 ReAct 执行内核；子 Agent 层负责角色定义、运行配置、工具过滤、任务状态、前后台切换、结果回流和 Hook 适配。

整体分为六个协作部分：

1. `AgentDefinitionManager` 加载并热更新插件、内置、用户和项目四级角色定义，只发布不可变快照。
2. 稳定的系统工具 `agent` 只验证统一参数并生成“待调度”工具结果，不在 ToolRegistry 内直接启动子 Agent。
3. `SubAgentCoordinator` 在父 Agent 已拿到完整 ProviderRequest 快照后解释 `agent` 工具结果，构造定义式或 Fork 式运行任务。
4. `SubAgentRunner` 为每个任务创建独立 ContextManager、PermissionManager、工具读取缓存、HookRuntime 作用域和 AgentLoop。
5. `SubAgentTaskManager` 维护任务状态机、前后台切换、取消、Token 用量和终态保留；`SubAgentResultInbox` 负责完成结果的两阶段回流。
6. Chat、Command、UI 和 Hook 只依赖稳定控制接口，不直接操作子 Agent 内部消息或 Promise。

```text
Provider 工具列表
    |
    v
agent（固定系统工具）
    |
    | ToolResultTransformer + 当前 ProviderRequest 快照
    v
SubAgentCoordinator
    |-- AgentDefinitionManager      角色快照与模型档位
    |-- SubAgentToolFilter          多层工具收窄
    |-- SubAgentTaskManager         状态、切后台、取消、用量
    |-- SubAgentResultInbox         后台结果排队与两阶段消费
    `-- SubAgentRunner
          |-- AgentLoop             复用 ReAct 内核
          |-- ContextManager        每任务独立
          |-- PermissionManager     每任务独立会话规则
          |-- ToolExecutionState    每任务独立读取缓存
          `-- HookRuntimeScope      规则共享、上下文与 Prompt 队列隔离

ChatManager
    |-- 组合 Skill/SubAgent ToolResultTransformer
    |-- 在 Provider 请求边界消费 ResultInbox
    |-- 持久化 subagent_result 指令
    |-- 会话切换时取消并清理旧任务
    `-- 为子 Agent 文件修改登记 rewind 快照

TUI /tasks + Ctrl+B <--> ChatManager 子 Agent 控制接口
Hook agent action ------> SubAgentCoordinator 定义式入口
```

### 方案与 Spec 对齐

| Spec | 技术归属 |
|------|----------|
| F1 | `AgentTool` + AgentLoop ToolResultTransformer 扩展 |
| F2-F4 | parser、loader、definition manager、配置模型别名 |
| F5-F6 | `SubAgentCoordinator` + `SubAgentRunner` + AgentLoop 请求快照 |
| F7-F8 | 每任务 Context/Permission/ToolExecution/Hook scope |
| F9 | `SubAgentToolFilter` + AgentLoop 请求与执行双重校验 |
| F10 | 现有 AgentLoop + 子 Agent 运行配置 |
| F11-F12 | `SubAgentTaskManager` 前后台状态机 |
| F13 | `SubAgentResultInbox` + AgentLoop 两阶段指令提交 |
| F14 | `/tasks` + `Ctrl+B` + UI 订阅 |
| F15 | Hook compiler、executor 和 scoped runtime |
| F16 | `SubAgentEvent` 事件总线与有界格式化 |

## 核心数据结构

### 配置结构

`config.yaml` 顶层增加两个可选字段。未配置时不影响现有 Provider 选择。

```typescript
export type AgentModelTier = 'haiku' | 'sonnet' | 'opus';

export interface AgentModelAliases {
  haiku?: string;
  sonnet?: string;
  opus?: string;
}

export interface SubAgentConfig {
  foreground_timeout_ms?: number;
  fork_max_iterations?: number;
  retained_tasks?: number;
  denied_tools?: string[];
}

export interface AppConfig {
  providers: ProviderConfig[];
  agent_models?: AgentModelAliases;
  subagents?: SubAgentConfig;
}
```

解析后统一得到完整运行选项：

```typescript
export interface ResolvedSubAgentOptions {
  foregroundTimeoutMs: number; // 默认 120_000
  forkMaxIterations: number;   // 默认 10
  retainedTasks: number;       // 默认 100，只统计终态任务
  deniedTools: ReadonlySet<string>;
}
```

`agent` 与 `load_skill` 是不可配置移除的全局禁用工具：前者阻止递归子 Agent，后者阻止通过独立 Skill 间接嵌套新的 AgentLoop。`subagents.denied_tools` 只能追加禁用项。全局配置字段类型、范围或工具名错误时阻止启动；角色级错误仍按单角色隔离。

建议范围：前台超时 `1_000..3_600_000` 毫秒，Fork 最大迭代 `1..100`，终态保留数 `1..10_000`。

### 角色定义

```typescript
export type AgentDefinitionScope = 'plugin' | 'builtin' | 'user' | 'project';
export type AgentDefinitionModel = 'inherit' | AgentModelTier;

export interface AgentDefinitionMetadata {
  name: string;
  description: string;
  tools?: readonly string[];
  disallowedTools: readonly string[];
  backgroundTools: readonly string[];
  model: AgentDefinitionModel;
  maxIterations: number;
  permissionMode: PermissionMode;
}

export interface AgentDefinition extends AgentDefinitionMetadata {
  scope: AgentDefinitionScope;
  entryPath: string;
  body: string;
}

export interface AgentDefinitionDiagnostic {
  scope: AgentDefinitionScope;
  file: string;
  name?: string;
  code:
    | 'INVALID_DEFINITION'
    | 'DUPLICATE_DEFINITION'
    | 'UNKNOWN_TOOL'
    | 'FORBIDDEN_TOOL'
    | 'UNKNOWN_MODEL_ALIAS';
  message: string;
}

export interface AgentDefinitionSnapshot {
  revision: number;
  definitions: ReadonlyMap<string, AgentDefinition>;
  disabledNames: ReadonlySet<string>;
  diagnostics: readonly AgentDefinitionDiagnostic[];
}
```

frontmatter 使用以下字段名：

```yaml
---
name: explorer
description: 调研代码结构并给出证据
tools: [read_file, find_files, search_code]
disallowed_tools: []
background_tools: [read_file, find_files, search_code]
model: inherit
max_iterations: 10
permission_mode: default
---
```

`tools` 缺省与显式空数组语义不同，因此解析结果保留 `undefined`。其余列表归一化为去重的小写工具名。角色名采用与 Skill 相同的安全命名规则并统一小写；正文必须非空。

### Agent 工具调用

Provider 始终只看到一个名为 `agent` 的工具：

```typescript
export const AGENT_TOOL_NAME = 'agent';

export type AgentToolInput =
  | {
      type: 'defined';
      task: string;
      role: string;
      background?: boolean;
    }
  | {
      type: 'fork';
      task: string;
    };
```

Schema 使用一个稳定对象，固定声明 `type`、`task`、`role`、`background` 四个属性，基础层要求 `type` 与 `task`；执行时再严格校验联合类型约束。这样避免部分 OpenAI 兼容模型对复杂 `oneOf` 支持不一致，也不会因角色变化重建 Schema。

`AgentTool.execute` 不直接运行模型，只返回：

```typescript
createToolSuccess('子 Agent 请求已准备调度。', {
  subagentDispatch: true,
  subagentType: input.type,
});
```

真正调度发生在 AgentLoop 的工具结果转换阶段，因为那里同时拥有父 ProviderRequest、父模式、父 Provider、父历史和取消信号。`agent` 标记为 `read_only` 系统工具，使它在 Plan Mode 中仍可用于只读委派；Coordinator 会把父模式传给子 Agent，并由 AgentLoop 和工具过滤再次强制 Plan Mode。

### 父请求快照

AgentLoop 的工具结果转换输入增加刚刚实际发送的请求：

```typescript
export interface ToolResultTransformInput {
  call: ToolCall;
  result: ToolResult;
  history: readonly Message[];
  request: AgentLoopRequest;
  providerRequest: Readonly<ProviderRequest>;
  iteration: number;
  emit(event: AgentEvent): void;
}
```

快照在 ContextManager 返回 `ready` 后创建，保持 `systemPrompt`、`messages` 和 `tools` 的顺序。Fork 使用该快照的 `messages` 作为初始 history，在末尾追加 Fork task；不会复制产生 `agent` 调用的当前助手消息。

`AgentLoopRequest` 增加两个只对子 Agent 使用的可选固定项：

```typescript
export interface AgentLoopRequest {
  // 既有字段保持不变
  systemPrompt?: string;
  toolDefinitions?: readonly ToolDefinition[];
}
```

- 定义式只传 `systemPrompt`，工具集合由动态可见工具回调提供，以便前台转后台后收窄。
- Fork 同时传父快照的 `systemPrompt` 和过滤后的 `toolDefinitions`，整个 Fork 生命周期固定使用该工具顺序。
- 主 Agent 不传这两个字段，行为与当前完全一致。

### 任务模型

```typescript
export type SubAgentKind = 'defined' | 'fork';
export type SubAgentTaskState = 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SubAgentExecutionMode = 'foreground' | 'background';
export type SubAgentBackgroundReason = 'explicit' | 'timeout' | 'manual' | 'fork' | 'hook';

export interface SubAgentTaskRecord {
  id: string;
  kind: SubAgentKind;
  role?: string;
  task: string;
  origin: 'tool' | 'hook';
  sessionId: string;
  parentTurnId?: string;
  executionMode: SubAgentExecutionMode;
  backgroundReason?: SubAgentBackgroundReason;
  state: SubAgentTaskState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  stopReason?: AgentStopReason;
  iterations: number;
  usage: TokenUsage;
  result?: string;
  error?: { code: string; message: string };
}

export type SubAgentTaskSnapshot = Readonly<SubAgentTaskRecord>;
```

任务 ID 使用 `sa-` 前缀加随机 UUID。内部 `TaskControl` 额外持有 AbortController、运行 Promise、前台等待 resolver、终态锁和工具快照，但这些不暴露给 UI。

状态转移固定为：

```text
waiting -> running -> completed
                   -> failed
                   -> cancelled

foreground -> background 只能发生一次
终态不可再次修改
```

### 子 Agent 事件

```typescript
export type SubAgentEvent =
  | { type: 'task_created'; task: SubAgentTaskSnapshot }
  | { type: 'task_started'; task: SubAgentTaskSnapshot }
  | {
      type: 'task_progress';
      taskId: string;
      iteration: number;
      stage: AgentProgressStage;
      toolName?: string;
    }
  | { type: 'task_tool_call'; taskId: string; iteration: number; call: ToolCall }
  | { type: 'task_tool_result'; taskId: string; iteration: number; call: ToolCall; result: ToolResult }
  | { type: 'task_usage'; taskId: string; usage: TokenUsage }
  | {
      type: 'task_backgrounded';
      task: SubAgentTaskSnapshot;
      reason: SubAgentBackgroundReason;
    }
  | { type: 'task_finished'; task: SubAgentTaskSnapshot };
```

TaskManager 提供 `subscribe(listener): () => void`。事件对象在发布前复制冻结；UI 只消费状态和终态通知，不渲染子 Agent 的中间文本。Tool call/result 事件仍供测试、未来面板和非 TUI 调用方使用。

### 后台结果收件箱

```typescript
export interface SubAgentResultEntry {
  id: number;
  taskId: string;
  sessionId: string;
  content: string;
  createdAt: string;
}

export interface PreparedSubAgentResultBatch {
  throughId: number;
  entries: readonly SubAgentResultEntry[];
  messages: readonly Extract<Message, { role: 'instruction' }>[];
}

export interface AgentInstructionRuntime {
  prepare(): PreparedSubAgentResultBatch | undefined;
  commit(throughId: number): readonly SubAgentResultEntry[];
}
```

结果消息使用 `instructionKind: 'subagent_result'` 和专用标签：

```text
<subagent-result task_id="sa-550e8400-e29b-41d4-a716-446655440000">
状态、停止原因、摘要和 Token 用量
</subagent-result>
```

子 Agent 输出中的同名标签必须转义。单条回流消息限制 4 KiB，任务完整结果限制 64 KiB；完整结果只存在 TaskManager 内。收件箱按完成顺序排队，`prepare` 不删除，`commit` 只删除不大于 `throughId` 的条目。

### 文件读取缓存

现有工具层没有运行时读取缓存，因此新增轻量执行状态：

```typescript
export interface CachedFileRead {
  relativePath: string;
  size: number;
  mtimeMs: number;
  content: string;
}

export class ToolExecutionState {
  getFileRead(path: string, size: number, mtimeMs: number): string | undefined;
  setFileRead(entry: CachedFileRead): void;
  invalidateFile(path: string): void;
  invalidateAllFiles(): void;
  clear(): void;
}
```

`ToolContext` 增加可选 `executionState`，`ToolRegistry.execute` 接收并下传。ReadFileTool 在文件大小和 mtime 均相同时复用缓存，否则重新读取；写文件、编辑文件和任何成功的副作用工具执行后使当前 Agent 的缓存失效。其他 Agent 的写入会因 stat 指纹变化使缓存失效。每个 SubAgentRunner 创建独立状态，任务结束后清空。

## 模块设计

### `src/subagent/parser.ts`

**职责：** 解析角色 frontmatter 和正文，严格校验字段、未知键、名称、数组、枚举和数值范围。

**接口：**

```typescript
export function extractAgentDefinitionName(content: string, fallback: string): string;
export function parseAgentDefinitionDocument(content: string): {
  metadata: AgentDefinitionMetadata;
  body: string;
};
```

解析失败抛带中文原因的 `AgentDefinitionParseError`。parser 只做文档结构校验，不判断 Provider 映射和工具是否存在。

### `src/subagent/loader.ts`

**职责：** 扫描角色来源、执行来源优先级和同层重复判定，隔离单角色错误。

目录约定：

```text
插件贡献目录/*.md 或 */AGENT.md       rank 0
仓库 agents/*.md 或 */AGENT.md         rank 1
~/.bettercode/agents/{*.md,*/AGENT.md}  rank 2
<project>/.bettercode/agents/{*.md,*/AGENT.md} rank 3
```

**接口：**

```typescript
export interface AgentDefinitionLoaderOptions {
  userHome?: string;
  builtinDirectory?: string;
  pluginDirectories?: readonly string[];
}

export class AgentDefinitionLoader {
  readonly directories: readonly { scope: AgentDefinitionScope; path: string; rank: number }[];
  load(): LoadedAgentDefinitions;
  fingerprint(): string;
}
```

同名组只解析最高 rank 候选；最高层重复或解析错误时禁用该名称，不回退。插件目录之间视为同一来源层。

### `src/subagent/definition-manager.ts`

**职责：** 在 loader 结果上验证工具、全局禁用项和模型档位，发布热更新快照。

```typescript
export interface AgentDefinitionManagerOptions extends AgentDefinitionLoaderOptions {
  modelAliases: Readonly<Partial<Record<AgentModelTier, string>>>;
  providerNames: readonly string[];
  deniedTools: ReadonlySet<string>;
  watchIntervalMs?: number;
}

export class AgentDefinitionManager {
  initialize(): AgentDefinitionSnapshot;
  reload(): AgentDefinitionSnapshot;
  get(name: string): AgentDefinition | undefined;
  getSnapshot(): AgentDefinitionSnapshot;
  resolveProviderName(definition: AgentDefinition): string | undefined;
  subscribe(listener: (snapshot: AgentDefinitionSnapshot) => void): () => void;
  startWatching(): void;
  close(): Promise<void>;
}
```

每次 reload 都可发布“部分成功”快照：某角色失效只删除该角色并追加诊断。角色引用 `agent`、`load_skill` 或全局禁用工具时按 `FORBIDDEN_TOOL` 禁用。运行任务持有启动时 definition 对象，不读取后续快照。

SkillManager 成功更新专属工具后触发一次角色重新校验。SubAgent 运行期间调用 `SkillManager.beginExecution/endExecution` 形成工具注册租约，避免专属工具在运行中被卸载。

### `src/subagent/agent-tool.ts`

**职责：** 提供稳定系统工具定义，完成联合参数语义校验并返回待调度标记。

```typescript
export class AgentTool implements Tool {
  readonly name = AGENT_TOOL_NAME;
  readonly effect = 'read_only';
  execute(input: JsonObject, context: ToolContext): Promise<ToolResult>;
}
```

工具描述同时强调：定义式需要 role，Fork 强制后台，子 Agent 不能再委派，后台结果稍后回流。AgentTool 不依赖 Coordinator，便于在启动早期注册并保持 SkillManager 捕获到稳定系统工具。

### `src/subagent/tool-filter.ts`

**职责：** 纯函数计算前台、后台和 Fork 工具快照，集中实现过滤优先级。

```typescript
export interface SubAgentToolSnapshot {
  foreground: ReadonlySet<string>;
  background: ReadonlySet<string>;
}

export function resolveDefinedToolSnapshot(input: {
  registryNames: readonly string[];
  definition: AgentDefinition;
  deniedTools: ReadonlySet<string>;
}): SubAgentToolSnapshot;

export function resolveForkToolDefinitions(input: {
  parentTools: readonly ToolDefinition[];
  deniedTools: ReadonlySet<string>;
}): readonly ToolDefinition[];
```

定义式结果顺序沿用 ToolRegistry 注册顺序；Fork 顺序沿用父 ProviderRequest。所有集合都强制移除 `agent` 和 `load_skill`。Plan Mode 的只读过滤仍由 AgentLoop/ToolScheduler 作为独立安全层执行。

### `src/subagent/task-manager.ts`

**职责：** 管理任务状态、前后台转换、前台唯一指针、取消、事件和终态淘汰。

```typescript
export interface StartSubAgentTaskInput {
  kind: SubAgentKind;
  role?: string;
  task: string;
  origin: 'tool' | 'hook';
  sessionId: string;
  parentTurnId?: string;
  background?: SubAgentBackgroundReason;
}

export type ForegroundWaitResult =
  | { status: 'finished'; task: SubAgentTaskSnapshot }
  | { status: 'backgrounded'; task: SubAgentTaskSnapshot };

export class SubAgentTaskManager {
  start(
    input: StartSubAgentTaskInput,
    operation: (signal: AbortSignal, emit: (event: AgentEvent) => void) => Promise<AgentOutcome>,
  ): SubAgentTaskSnapshot;
  waitForeground(taskId: string, parentSignal: AbortSignal): Promise<ForegroundWaitResult>;
  moveForegroundToBackground(sessionId: string, reason: 'manual' | 'timeout'): SubAgentTaskSnapshot | undefined;
  list(sessionId: string): SubAgentTaskSnapshot[];
  get(sessionId: string, taskId: string): SubAgentTaskSnapshot | undefined;
  cancelSession(sessionId: string, reason: string): Promise<void>;
  cancelAll(reason: string): Promise<void>;
  subscribe(listener: (event: SubAgentEvent) => void): () => void;
  close(): Promise<void>;
}
```

`waitForeground` 内部启动 120 秒配置计时器。父 signal 只在任务仍为前台时联动取消；任务转后台后立即解除父 signal 监听。显式后台、Fork 和后台 Hook 不进入前台唯一指针。运行 Promise 始终由 manager 捕获并落终态，避免未处理拒绝。

终态映射：`completed` 且有文本为 completed；`cancelled` 为 cancelled；其他停止原因或异常为 failed。达到上限时保留已有最终文本作为诊断，但前台工具结果仍返回失败。

### `src/subagent/result-inbox.ts`

**职责：** 把已进入后台的任务终态转换为有界指令，按 session 排队并支持 prepare/commit。

```typescript
export class SubAgentResultInbox {
  enqueue(task: SubAgentTaskSnapshot): void;
  runtime(sessionId: string): AgentInstructionRuntime;
  discardSession(sessionId: string): void;
  close(): void;
}
```

只有真正进入过后台且未因会话替换/应用关闭取消的任务才入队。前台完成结果只走当前工具结果，不重复回流。failed 任务同样回流失败摘要，便于主 Agent 调整。

### `src/subagent/prompts.ts`

**职责：** 构建定义式固定 System Prompt 和 Fork task 文本。

```typescript
export function buildDefinedAgentSystemPrompt(definition: AgentDefinition): string;
export function buildDefinedAgentTask(task: string): string;
export function buildForkAgentTask(task: string): string;
```

定义式 System Prompt 在现有七个固定模块间加入：

- 优先级 575 的“子 Agent 约束”：非交互、禁止委派、只输出独立结果、如实停止；
- 优先级 550 的“角色定义”：角色 Markdown 正文。

Fork 不修改父 System Prompt，以保持缓存前缀；非交互与结果要求写入追加的 Fork task。工具过滤和权限负责强制安全，不依赖文字约束。

### `src/subagent/runner.ts`

**职责：** 为一个任务组装隔离运行时并执行 AgentLoop。

```typescript
export type SubAgentRunSpec = DefinedAgentRunSpec | ForkAgentRunSpec;

export interface DefinedAgentRunSpec {
  kind: 'defined';
  definition: AgentDefinition;
  provider: LLMProvider;
  task: string;
  mode: AgentMode;
  foregroundTools: ReadonlySet<string>;
  backgroundTools: ReadonlySet<string>;
  isBackground(): boolean;
}

export interface ForkAgentRunSpec {
  kind: 'fork';
  provider: LLMProvider;
  task: string;
  mode: AgentMode;
  parentRequest: Readonly<ProviderRequest>;
  toolDefinitions: readonly ToolDefinition[];
  maxIterations: number;
}

export class SubAgentRunner {
  run(
    taskId: string,
    sessionId: string,
    spec: SubAgentRunSpec,
    signal: AbortSignal,
    emit: (event: AgentEvent) => void,
    callbacks: { beforeToolExecution(call: ToolCall): void },
  ): Promise<AgentOutcome>;
}
```

每次 run：

1. 根据角色模式或父权限模式创建全新 PermissionManager，不传 permissionDecider。
2. 创建 ContextManager、ToolExecutionState 和 scoped HookRuntime。
3. 定义式 history 为空，Fork history 为父 ProviderRequest.messages 的结构化副本。
4. 定义式通过 `visibleToolNames` 动态读取当前前后台状态；Fork使用固定 ToolDefinition 顺序。
5. 把子 AgentEvent 转发给 TaskManager；不转发 text/thinking 到主 Agent UI。
6. finally 中关闭 ContextManager、清空读取缓存、释放 Hook scope 和 Skill 工具租约。

定义式保留项目自定义指令和长期记忆，但不注入可用/激活 Skill；Fork 首轮直接继承父请求中已有运行时消息。子 Agent不触发新的 session/turn/user_message Hook，只触发 scoped assistant/tool Hook。

### `src/subagent/coordinator.ts`

**职责：** 统一解释 Tool 和 Hook 的子 Agent请求、解析角色/Provider、创建任务并格式化返回。

```typescript
export interface SubAgentToolDispatchInput extends ToolResultTransformInput {
  sessionId: string;
  parentPermissionMode: PermissionMode;
  beforeToolExecution(call: ToolCall): void;
}

export interface HookAgentRunInput {
  role?: string;
  prompt: string;
  background: boolean;
  sessionId: string;
  mode: AgentMode;
  signal: AbortSignal;
}

export interface HookAgentRunner {
  runHookAgent(input: HookAgentRunInput): Promise<HookAgentRunResult>;
}

export type HookAgentRunResult =
  | { status: 'completed'; output: string }
  | { status: 'backgrounded'; taskId: string }
  | { status: 'failed'; code: string; message: string };

export class SubAgentCoordinator implements HookAgentRunner {
  transformToolResult(input: SubAgentToolDispatchInput): Promise<ToolResult>;
  runHookAgent(input: HookAgentRunInput): Promise<HookAgentRunResult>;
  moveForegroundToBackground(sessionId: string): SubAgentTaskSnapshot | undefined;
  listTasks(sessionId: string): SubAgentTaskSnapshot[];
  getTask(sessionId: string, id: string): SubAgentTaskSnapshot | undefined;
  cancelSession(sessionId: string, reason: string): Promise<void>;
  close(): Promise<void>;
}
```

Tool 路径只有 call.name 为 `agent` 且原结果包含 dispatch 标记时处理；其他结果原样返回。定义式先冻结角色快照和工具集合，Fork先冻结父请求与父实际工具。显式/强制后台立即返回 task ID；前台等待完成、超时或 Ctrl+B。

角色 `inherit` 使用当前 Provider，模型档位通过共享 Provider resolver 解析。Fork 权限模式继承父 PermissionManager 当前模式，但重新加载持久规则且不复制 session 规则。

### `src/agent/loop.ts`

**职责变化：** 提供子 Agent 所需的固定请求快照、外部指令队列和执行状态注入，不包含任何角色或后台业务。

`AgentLoopRuntime` 增加：

```typescript
export interface AgentLoopRuntime {
  // 既有字段保持
  instructionRuntime?: AgentInstructionRuntime;
  toolExecutionState?: ToolExecutionState;
  onInstructionsCommitted?: (messages: readonly Message[]) => void;
}
```

每轮顺序调整为：

1. prepare Hook Prompt 和 SubAgent Result batch；
2. 计算本轮请求可见工具；
3. ContextManager 处理 history + result messages + runtime reminder；
4. `ready` 后 commit 两种队列，把 result messages 追加到 managed history 并通知持久化；
5. 保存 ProviderRequest 快照并请求模型；
6. 工具调度前重新读取执行时可见工具，确保 Ctrl+B 后尚未执行的前台工具被后台白名单拒绝；
7. 调用 ToolResultTransformer 时传入本轮 ProviderRequest 快照。

主 Agent 没有 instructionRuntime 时行为不变。固定 `request.toolDefinitions` 存在时不从 Registry 重建工具定义，但执行仍通过 Registry 和 allowed names 校验。

### `src/agent/tool-scheduler.ts` 与工具运行时

ToolScheduler 构造时接收可选 ToolExecutionState，调用 Registry 时下传。执行时 visible names 使用 AgentLoop 在模型响应完成后重新计算的集合。

成功副作用工具之后执行缓存失效：`write_file`、`edit_file` 可按路径失效；`run_command`、MCP 或其他副作用工具全量失效。失败调用不改变缓存。

Plan Mode 检查继续先于系统工具权限判断；`agent` 自身 effect 为 read_only，因此可进入，但子 Runner 仍使用 `mode: plan`，普通副作用工具在子 Agent 调度时被拒绝。

### `src/permission/factory.ts`

保持 PermissionManager 外部行为不变，只增加可复用 factory 闭包：

```typescript
export type PermissionManagerFactory = (mode: PermissionMode) => PermissionManager;
```

Coordinator 每次运行调用 factory，确保 RuleEngine 和 session rule map 独立；PermissionConfigStore 可重新读取同一用户/项目/本地配置。子 Agent不传 decider，因此 default 未命中自然返回 `PERMISSION_UNAVAILABLE`。为满足产品语义，子 Agent Runner 在结果回灌前把该代码归一化为普通 `PERMISSION_DENIED` 文案，避免模型误以为应该等待 UI。

### `src/hook/manager.ts` 与 Hook scope

并发子 Agent不能直接共享 HookManager 当前 turn 和全局 prompt 队列，因此新增作用域：

```typescript
export interface HookAgentScope {
  taskId: string;
  kind: SubAgentKind;
  role?: string;
  sessionId: string;
  parentTurnId?: string;
}

export interface ScopedHookRuntime extends HookRuntime {
  close(): void;
}

export class HookManager {
  createAgentScope(scope: HookAgentScope): ScopedHookRuntime;
}
```

HookEventContext 增加可选 `agent` 字段，field matcher 支持 `agent.id`、`agent.kind`、`agent.role`。Scope 捕获创建时 session/turn 快照，assistant/pre/post 事件不依赖 HookManager 后续可变 turn。规则、once 状态、logger、executor 和 shutdown signal 共享；每个 scope 使用独立 prompt queue，子 Agent Hook prompt 只进入该子 Agent 下一请求。

当 scoped context 再匹配 `action.type: agent` 时，HookManager 返回并记录 `NESTED_AGENT_FORBIDDEN`，阻止通过 Hook 间接递归。Scope 不发布 system/session/turn/user_message 事件。

### `src/hook/compiler.ts` 与 `src/hook/action-executor.ts`

agent action 扩展为：

```yaml
action:
  type: agent
  role: explorer # 可选，缺省 general
  prompt: "检查 {{message.content}} 并返回风险摘要"
```

Compiled action：

```typescript
{ type: 'agent'; role?: string; prompt: CompiledTextTemplate }
```

保持 `pre_tool_use` 禁止 agent、agent 不接受 `timeout_ms` 的既有规则。DefaultHookActionExecutor 构造函数增加可选 HookAgentRunner；执行 agent action 时渲染 prompt 并调用 runner。同步完成返回 output，后台或自动转后台返回 task ID 成功；失败返回 `AGENT_FAILED`。没有 runner 只在单元测试兼容场景返回明确失败，不再使用运行期占位实现。

### `src/chat/manager.ts`

ChatManager 注入 Coordinator 和 ResultInbox，并对外暴露 UI 控制方法：

```typescript
listSubAgentTasks(): SubAgentTaskSnapshot[];
getSubAgentTask(id: string): SubAgentTaskSnapshot | undefined;
backgroundCurrentSubAgent(): SubAgentTaskSnapshot | undefined;
subscribeSubAgent(listener: (event: SubAgentEvent) => void): () => void;
```

主 AgentLoop runtime 组合三个能力：

- SkillRunner 先处理 `load_skill`；
- SubAgentCoordinator 再处理 `agent`；
- 当前 session 的 ResultInbox 作为 instructionRuntime。

两种 transformer 根据工具名互斥，组合顺序不改变普通 ToolResult。Coordinator dispatch 从 ChatManager 获取 sessionId、父权限模式和文件修改回调。

ResultInbox commit 时，ChatManager 把 `subagent_result` 消息写入当前 history，并调用 session 持久化。AgentLoop outcome 覆盖 history 时这些消息已在 outcome 内，不会丢失。

`clear`、`resumeSession`、`close` 的顺序统一为：取消旧 session 子任务并等待 settle，丢弃旧 inbox，结束旧 Hook session，清理/替换 Chat 状态，再启动新 session。这样迟到任务无法写入新会话。子 Agent beforeToolExecution 复用 `trackToolEdit`，保证 rewind 能看到子 Agent 的 write/edit。

### `src/session/session.ts`

InstructionKind 增加 `subagent_result`。SessionMessage type 从单一 compact boundary 扩展为联合：

```typescript
export const SUBAGENT_RESULT = 'subagent_result';
export type SessionSystemType = typeof COMPACT_BOUNDARY | typeof SUBAGENT_RESULT;
```

新增 `saveSubAgentResult`。`rebuildFromSession` 返回完整 Message 数组：普通用户/助手消息照旧，合法 subagent result 恢复为 instruction；compact boundary 之前的结果由摘要代表，之后的结果原样恢复。UI 恢复时把该 instruction 显示为“后台任务结果”系统通知，不伪装成助手生成内容。

### `src/command/builtins.ts`

增加命令：

```text
/tasks          列出当前会话任务
/tasks <任务ID> 查看任务详情
```

CommandUIController 增加 `showSubAgentTasks(taskId?: string): void`。格式化函数放在 `src/subagent/format.ts`，保持命令 handler 只负责参数分发。列表按创建时间倒序，详情显示状态、类型/角色、后台原因、停止原因、迭代、Token、缓存创建/命中和有界结果。

### `src/ui/app.tsx`

新增两条 UI 接线：

1. 订阅 SubAgentEvent；进入后台时显示任务 ID，后台任务终止时立即追加一条系统通知。前台任务完成不重复通知。
2. 全局 `useInput` 在 `isStreaming` 且收到 `Ctrl+B` 时调用 `chatManager.backgroundCurrentSubAgent()`；成功显示“已转后台”，无任务时不改变界面。`Ctrl+C` 行为保持取消当前主任务。

运行中提示增加 `Ctrl+B 将前台子 Agent 转到后台`，但只在确有前台子 Agent 时显示。为此 ChatManager 提供 `hasForegroundSubAgent()` 或 UI 根据 task event 维护布尔状态。

启动诊断增加角色定义诊断，样式与 Skill 诊断一致。`/status` 可附加“后台任务：运行 N / 已结束 M”，但不展开结果。

### `src/index.tsx` 启动编排

启动顺序必须解决 AgentTool、SkillManager、PermissionManager、HookManager 和 Coordinator 的依赖：

```text
1. 加载 AppConfig，创建 Provider resolver
2. 创建 core registry，初始化 MCP
3. 注册无依赖的 AgentTool（system: true）
4. 创建并初始化 SkillManager，使 base tools 包含 agent
5. 解析 subagent 全局配置
6. 创建并初始化 AgentDefinitionManager，验证完整工具集
7. 创建主 PermissionManager 和子 Agent PermissionManagerFactory
8. 创建 TaskManager、ResultInbox、Runner、Coordinator
9. 用延迟 hooks getter 让 Runner 在运行时取得 HookManager
10. 创建 DefaultHookActionExecutor(Coordinator) 与 HookManager
11. 创建 SkillRunner、ChatManager，传入 Coordinator/Inbox
12. 启动 Hook system/session，再渲染 App
```

Runner 接收 `hooks: () => HookManager | undefined`，而不是构造时强依赖实例。HookManager 在任何生命周期事件触发前已经赋值，因此不会发生运行期空引用，同时避免可变 setter。

关闭顺序：ChatManager 先取消子任务并等待；Coordinator/TaskManager/DefinitionManager 再关闭；随后 HookManager、SkillManager、MCP。这样子 Agent 不会在 Hook 或工具基础设施关闭后继续运行。

## 模块交互

### 定义式前台完成

```text
主模型 -> agent { type: defined, role, task }
AgentTool -> prepared ToolResult
AgentLoop -> transform(result, parent ProviderRequest)
Coordinator -> 冻结 role/provider/tools/permission/session
TaskManager -> waiting -> running（foreground）
Runner -> 独立 AgentLoop 跑到底
TaskManager -> completed
Coordinator -> final text ToolResult
主 AgentLoop -> 写入 tool message -> 下一轮模型请求
```

### 定义式转后台

```text
TaskManager running(foreground)
   |-- 明确 background: 创建时直接 background
   |-- 120 秒 timer: background(reason=timeout)
   `-- Ctrl+B: background(reason=manual)

Coordinator 前台等待被 background transition 唤醒
 -> agent 工具返回 task ID
 -> 子 Agent 原 Promise 继续
 -> 下一轮重新计算 background tool whitelist
 -> 终态事件 -> UI 通知 + ResultInbox.enqueue
 -> 主 Agent 下一个自然 Provider 请求 prepare/commit
 -> subagent_result 进入请求和可恢复 history
```

### Fork 缓存路径

```text
父 ProviderRequest = { system S, tools T, messages M }
当前模型响应产生 agent fork 调用（该响应不进入 Fork）
Coordinator:
  T' = T - denied - agent - load_skill
  history = clone(M)
  system = S
  task = fork task
Runner 首次请求:
  system S
  tools T'（保持 T 相对顺序）
  messages M + fork task + child runtime reminder
Provider usage -> cacheReadInputTokens -> TaskManager
```

如果父工具集合中包含全局禁用项，工具段会在该项处发生变化；System 与之前消息仍保持稳定前缀。测试不假设所有 Provider 都支持缓存，只验证请求结构和已返回 cache usage 的透传。

### 后台结果两阶段提交

```text
task terminal -> inbox.enqueue(entry)

AgentLoop iteration:
  batch = inbox.prepare()       // 不删除
  runtimeMessages = batch.messages + systemReminder
  ContextManager.manage(history, runtimeMessages)
  cancelled/blocked -> 保留 batch
  ready:
    inbox.commit(batch.id)      // 消费
    history += batch.messages   // 后续轮次可见
    persistSubAgentResult()     // 会话恢复可见
    provider.chat(request)      // 请求真正发出
```

完成事件不创建新的 AgentLoop，也不调用 Provider。若当前主 Agent 已自然结束，batch 保留到下一次用户任务。

### Hook agent 动作

```text
HookManager dispatch rule
 -> DefaultHookActionExecutor render prompt/role
 -> Coordinator.runHookAgent(defined)
 -> sync: 等待完成或自动转后台
 -> background: 立即得到 task ID
 -> failure: HookActionResult failed -> hooks.jsonl

子 Agent scoped hooks
 -> assistant/pre/post 使用捕获的 agent/session/turn context
 -> prompt action 进入 scoped prompt queue
 -> agent action 被 NESTED_AGENT_FORBIDDEN 拦截
```

## 文件组织

```text
agents/
└── general.md                         内置通用定义式角色

src/
├── subagent/
│   ├── types.ts                       角色、任务、事件、运行契约
│   ├── parser.ts                      frontmatter 解析
│   ├── parser.test.ts
│   ├── loader.ts                      四来源发现与覆盖
│   ├── loader.test.ts
│   ├── definition-manager.ts          校验、快照、热更新
│   ├── definition-manager.test.ts
│   ├── agent-tool.ts                  固定 agent 系统工具
│   ├── agent-tool.test.ts
│   ├── tool-filter.ts                 定义式/Fork 工具收窄
│   ├── tool-filter.test.ts
│   ├── task-manager.ts                状态机、切后台、取消、事件
│   ├── task-manager.test.ts
│   ├── result-inbox.ts                两阶段结果回流
│   ├── result-inbox.test.ts
│   ├── prompts.ts                     定义式系统提示与 Fork task
│   ├── prompts.test.ts
│   ├── runner.ts                      隔离 AgentLoop 运行
│   ├── runner.test.ts
│   ├── coordinator.ts                 Tool/Hook 统一调度入口
│   ├── coordinator.test.ts
│   ├── integration.test.ts            前后台、Fork、回流端到端
│   └── format.ts                      /tasks 与通知格式化
├── tool/
│   ├── execution-state.ts             每 Agent 文件读取缓存
│   ├── execution-state.test.ts
│   ├── types.ts                       ToolContext 执行状态
│   ├── registry.ts                    下传执行状态
│   └── tools/read-file.ts             指纹缓存
├── agent/
│   ├── types.ts                       请求固定项
│   ├── loop.ts                        快照、指令两阶段提交、执行时工具重算
│   └── tool-scheduler.ts              执行状态与缓存失效
├── hook/
│   ├── types.ts                       agent context、scope、失败码
│   ├── field.ts                       agent matcher 字段
│   ├── compiler.ts                    agent role 字段
│   ├── action-executor.ts             真实子 Agent 动作
│   └── manager.ts                     scoped HookRuntime
├── permission/factory.ts              子 Agent factory 类型
├── provider/types.ts                  subagent_result instruction kind
├── session/session.ts                 子 Agent 结果持久化与恢复
├── skill/manager.ts                   主上下文 agent 可见、独立 Skill 禁止 agent
├── skill/runner.ts                    与 SubAgent transformer 组合边界
├── chat/manager.ts                    会话宿主、结果 inbox、任务控制
├── command/types.ts                   showSubAgentTasks
├── command/builtins.ts                /tasks
├── ui/app.tsx                         通知、Ctrl+B、任务诊断
├── config/types.ts                    agent_models、subagents
├── config/loader.ts                   配置校验与默认值
└── index.tsx                          启动与关闭编排

docs/subagent-system/
├── spec.md
├── plan.md
├── task.md
└── checklist.md
```

既有测试文件按模块增加回归场景，不要求把所有测试集中到 `subagent/`。README 增加角色格式、目录优先级、`agent` 工具、后台规则、`/tasks`、Ctrl+B、Hook agent 和无 Worktree 风险说明。

## 错误处理

| 场景 | 处理 |
|------|------|
| 全局 subagents 配置非法 | 启动失败并指出字段 |
| 单角色解析/工具/模型非法 | 禁用该角色，保留诊断，不回退同名低层 |
| agent 参数组合非法 | `INVALID_ARGUMENTS` ToolResult |
| 角色不存在或已禁用 | `SUBAGENT_UNAVAILABLE` ToolResult，附诊断摘要 |
| Fork 缺少父请求快照 | `SUBAGENT_CONTEXT_ERROR`，不创建任务 |
| 子 Agent未命中权限 | 普通 `PERMISSION_DENIED` 回灌，不弹 UI |
| 子 Agent模型流错误 | task failed；前台返回失败，后台回流失败摘要 |
| 前台父 signal 取消 | 未转后台则取消子任务并返回 cancelled |
| 转后台后父 signal 取消 | 子任务继续，除非会话被替换或应用关闭 |
| 重复 Ctrl+B | 第一次成功，后续无活动前台任务 |
| ResultInbox 请求未发送 | 不 commit，结果保留 |
| ResultInbox 迟到旧会话 | 丢弃且不持久化 |
| Hook agent 角色无效/运行失败 | Hook error 日志，主流程继续 |
| 子 Agent Hook 再触发 agent | `NESTED_AGENT_FORBIDDEN` 日志，禁止递归 |
| 动态专属工具准备卸载 | Skill reload 延后到子任务释放租约 |
| 读取缓存 stat 变化 | 缓存 miss，重新读取 |
| Task event listener 抛错 | 隔离 listener，其他订阅和任务继续 |

ToolErrorCode 增加：

```typescript
| 'SUBAGENT_UNAVAILABLE'
| 'SUBAGENT_CONTEXT_ERROR'
| 'SUBAGENT_FAILED'
```

HookFailureCode 增加 `AGENT_FAILED` 和 `NESTED_AGENT_FORBIDDEN`；`NOT_IMPLEMENTED` 可保留兼容旧日志类型，但真实 agent 路径不再返回它。

## 并发与生命周期不变量

1. 一个任务只有一个 AbortController、一个运行 Promise 和一个终态写入者。
2. 任务转后台只改变等待关系和后续工具集合，不重建 Runner。
3. 一个 session 最多一个 foreground task pointer，但可有多个 background task。
4. TaskManager 捕获所有 operation rejection，调用方不持有裸 Promise。
5. 结果只在 `executionMode === background` 且 session 仍有效时入 inbox。
6. Inbox entry 只有 Provider 请求 ready 后才 commit，每个 ID 最多消费一次。
7. Hook scope 的 prompt queue 不与主 Agent 或其他子 Agent共享。
8. 角色、工具定义和父请求在任务创建时结构化复制；运行中热更新不改变快照。
9. 会话切换先取消任务再替换 sessionId，任何迟到 completion 都因旧 session 被拒绝。
10. 本章不提供跨 Agent 文件锁；后台角色开放写工具时，用户承担同一工作区并发编辑风险。

## 测试策略

### 单元测试

- parser：完整 frontmatter、缺字段、未知字段、空正文、枚举、数组、数值范围。
- loader：四级覆盖、插件目录、同层重复、最高层损坏不回退、其他角色继续。
- definition manager：未知/禁用工具、模型档位、热更新、运行快照不变。
- agent tool：Schema 稳定、defined/fork 参数组合、dispatch metadata。
- tool filter：白名单、黑名单、全局禁用、后台交集、Fork 顺序、Agent 永久移除。
- execution state：cache hit、stat 变化、自身副作用失效、任务隔离。
- task manager：所有状态转移、终态锁、显式/timeout/manual/fork、父取消、转后台后解绑、保留淘汰。
- result inbox：完成顺序、大小限制、标签转义、prepare/commit、旧 session 丢弃。
- prompts：角色优先级、BetterCode 名称、Fork System 不变。
- session：subagent_result 保存/恢复、compact boundary 前后行为。
- Hook scope：捕获上下文、独立 Prompt、once 共享、嵌套 agent 拒绝。
- `/tasks`：列表、详情、未知 ID、Token/cache 格式。

### Agent/Provider 集成测试

- 定义式前台从空 history 请求，连续工具调用后结果回父 Agent。
- 定义式 default 权限不弹 decider，拒绝结果可让模型调整后完成。
- Plan Mode 可调用 agent，但子 Agent只能看到/执行只读工具。
- Ctrl+B 或短测试阈值使同一运行任务转后台，不重复 Provider/工具调用。
- 多个后台任务并发，单个失败不影响其他。
- Fork 首请求 System、消息前缀、工具相对顺序与父快照一致，不含当前 agent 工具调用消息。
- Anthropic/OpenAI 模拟 usage 的 cache 字段进入任务详情。
- 后台完成时不额外调用 Provider；下一次自然请求恰好注入一次。
- 结果在 ContextManager blocked/cancelled 时不丢失。
- 会话 clear/resume/close 取消任务并阻止迟到回流。
- 子 Agent写文件进入 FileHistory，rewind 可恢复。
- Hook agent 旧格式 general、指定 role、同步、后台、失败开放和禁止递归。

### 回归测试

- AgentLoop 无新增 runtime 时请求结构不变。
- 主 PermissionManager 的交互确认和 session rule 保持原行为。
- Skill shared/isolated 测试保持通过，独立 Skill 不暴露 agent。
- Hook 无 agent 动作时生命周期、Prompt、deny 和日志保持原行为。
- Context、Memory、Session、MCP 与两个 Provider 的既有测试全部通过。
- 最终执行 `pnpm check` 和 `git diff --check`。

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 子 Agent 内核 | 复用 AgentLoop，新增 subagent 领域层 | 保持 ReAct、上下文、流式工具调用和停止语义唯一 |
| 工具入口 | 固定 `agent` 系统工具 + 结果转换阶段调度 | Tool execute 缺少父 ProviderRequest，转换阶段信息完整且已有 Skill 先例 |
| AgentTool effect | read_only，但子任务继承父 mode | Plan Mode 可委派只读研究，实际副作用仍被子 Agent Mode 强制拦截 |
| 定义式上下文 | 空 history + 固定角色 System | 满足干净上下文并保持角色整个生命周期可见 |
| Fork 上下文 | 复用父已发送请求前缀 | 保证消息合法并最大化 prompt cache 复用 |
| Fork 工具 | 父 ToolDefinition 顺序快照减禁用项 | 同时保持父可见性和缓存相对顺序 |
| 权限实例 | 每任务新建 PermissionManager | session 临时规则天然隔离，持久规则继续共享来源 |
| 非交互 default | 无 decider，归一化为 deny | 不挂起后台任务，模型仍能根据错误调整 |
| 前后台切换 | TaskManager 切等待关系，不重启 Runner | 保证上下文、工具执行和 Token 连续 |
| 后台工具 | 定义式角色 background_tools；Fork 继承父工具 | 对应用户确认的两类策略 |
| 结果回流 | session inbox prepare/commit | 不主动唤醒、不丢结果、可在自然下一请求消费 |
| 结果消息 | instructionKind=subagent_result | 不伪装用户消息，也不污染稳定 System Prompt |
| Hook 共享 | 每任务 scoped HookRuntime | 共享规则与日志，同时隔离 turn 快照和 prompt queue |
| 防递归 | 隐藏 agent/load_skill + scoped Hook 拒绝 agent action | 同时封住直接工具、Skill 和 Hook 三条嵌套路径 |
| 动态工具稳定 | 子任务持快照并占用 Skill 执行租约 | 运行中不因热更新丢失工具实现 |
| 读取缓存 | 每 Agent stat 指纹缓存，副作用失效 | 提供真实隔离缓存且降低陈旧内容风险 |
| 任务持久化 | 仅结果入会话，任务记录进程内 | 符合本章不做跨会话/重启后台恢复的范围 |
| 文件并发 | 共享工作区，不自动加锁/合并 | Worktree 与多 Agent 协调明确留到后续章节 |
