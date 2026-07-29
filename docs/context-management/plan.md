# BetterCode 上下文管理 Plan

## 架构概览

本章在 Provider、Agent、Chat 和 UI 之间增加独立 `context` 模块。Provider 只提供窗口、流和 usage；Agent Loop 负责每轮请求前接入；ContextManager 负责压缩事务与会话状态；ChatManager 负责手动命令和生命周期。

系统拆为八个组件：

1. **Provider 上下文能力**：暴露模型上下文窗口，允许摘要请求限制输出 Token。
2. **Token 估算器**：估算 Provider 可见请求，维护最近一次正常请求的 usage 锚点。
3. **工具结果存储器**：在项目 `.bettercode/context/` 中原子保存大结果并清理。
4. **轻量压缩器**：按单结果与批次阈值选择落盘对象，生成有界占位。
5. **历史规划器**：识别工具原子组，选择近期原文并保留全部用户消息。
6. **摘要器**：使用当前 Provider 和空工具列表生成、提取结构化摘要。
7. **上下文管理器**：编排两层压缩、估算、锚点、失败计数和熔断。
8. **Agent 与 Chat 集成**：自动路径逐轮执行，手动路径由 `/compact` 触发。

```text
ChatManager
  ├─ AgentLoop
  │    ├─ 构造本轮请求
  │    ├─ ContextManager.manage(automatic)
  │    │    ├─ LightweightCompactor -> ToolResultStore
  │    │    ├─ TokenEstimator
  │    │    ├─ HistoryPlanner
  │    │    └─ ContextSummarizer -> Provider（tools=[]）
  │    ├─ Provider.chat（正常请求）
  │    └─ ContextManager.recordUsage
  ├─ compact -> ContextManager.manage(manual)
  ├─ clear -> ContextManager.clear
  └─ close -> ContextManager.close
```

所有处理基于历史副本。文件写入、摘要解析和历史校验全部成功后，调用方才替换会话历史。

## 配置设计

Provider 配置增加可选窗口：

```yaml
providers:
  - name: deepseek-v4
    protocol: openai
    model: deepseek-v4-pro
    base_url: https://api.deepseek.com
    api_key: ${DEEPSEEK_API_KEY}
    context_window: 128000
```

`context_window` 必须为正整数。缺失时 Provider 使用 `128_000`，并记录该值来自默认配置；TUI 启动时提示用户为未知或自定义模型显式配置。系统不维护模型名称映射，也不从网络发现窗口。

内部阈值通过构造选项注入，生产使用默认值，测试可缩小。本章不增加新的上下文 YAML 文件。

```typescript
interface ContextManagerOptions {
  singleToolResultTokens: number;
  toolBatchTokens: number;
  toolPreviewTokens: number;
  recentHistoryTokens: number;
  recentHistoryMessages: number;
  automaticReserveTokens: number;
  manualReserveTokens: number;
  summaryMaxOutputTokens: number;
  summaryFailureLimit: number;
}

const DEFAULT_CONTEXT_OPTIONS: ContextManagerOptions = {
  singleToolResultTokens: 8_000,
  toolBatchTokens: 16_000,
  toolPreviewTokens: 1_000,
  recentHistoryTokens: 10_000,
  recentHistoryMessages: 5,
  automaticReserveTokens: 13_000,
  manualReserveTokens: 3_000,
  summaryMaxOutputTokens: 2_048,
  summaryFailureLimit: 3,
};
```

构造时校验所有值为正整数，并校验预览小于单结果阈值、手动余量小于自动余量。

## 核心数据结构

### Provider 能力

```typescript
interface ProviderRequest {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  maxOutputTokens?: number;
}

interface LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly contextWindow: number;
  readonly contextWindowIsDefault: boolean;
  chat(
    request: ProviderRequest,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}
```

OpenAI 只在请求指定时发送 `max_tokens`。Anthropic 使用 `request.maxOutputTokens ?? 4096`。摘要请求统一限制为 2048 Token。

### 消息内部元数据

```typescript
type InstructionKind = 'runtime' | 'context_summary' | 'context_boundary';

interface OffloadedToolResult {
  kind: 'offloaded_tool_result';
  relativePath: string;
  originalBytes: number;
  estimatedTokens: number;
  sha256: string;
}
```

`instruction` 消息增加可选 `instructionKind`，`tool` 消息增加可选 `contextReference`。Provider 映射忽略这些字段。内部元数据避免工具正文伪造落盘标记，并保证轻量处理幂等。

### 管理输入与结果

```typescript
type ContextTrigger = 'automatic' | 'manual';

interface ContextManageInput {
  history: readonly Message[];
  runtimeMessages: readonly Message[];
  systemPrompt: string;
  tools: readonly ToolDefinition[];
  provider: LLMProvider;
  trigger: ContextTrigger;
  iteration: number;
  signal: AbortSignal;
  emit(event: ContextEvent): void;
}

type ContextErrorCode =
  | 'CONTEXT_CAPACITY_EXCEEDED'
  | 'CONTEXT_NOTHING_TO_COMPACT'
  | 'CONTEXT_SUMMARY_FAILED'
  | 'CONTEXT_CIRCUIT_OPEN'
  | 'CONTEXT_HISTORY_INVALID';

type ContextManageResult =
  | {
      status: 'ready';
      history: Message[];
      request: ProviderRequest;
      beforeTokens: number;
      afterTokens: number;
      offloadedResults: number;
      summarizedMessages: number;
    }
  | {
      status: 'skipped';
      history: Message[];
      reason: 'nothing_to_compact';
      estimatedTokens: number;
      offloadedResults: number;
    }
  | { status: 'cancelled'; history: Message[] }
  | {
      status: 'blocked';
      history: Message[];
      code: ContextErrorCode;
      message: string;
      estimatedTokens: number;
    };
```

自动路径只发送 `ready.request`。`blocked` 让 Agent 以 `context_error` 停止，`cancelled` 沿用现有取消原因。`runtimeMessages` 只参与估算和请求，不进入持久历史。

### 锚点、历史与事件

```typescript
interface TokenAnchor {
  request: ProviderRequest;
  apiInputTokens: number;
  systemPromptHash: string;
  toolsHash: string;
  messageHashes: string[];
  messageTokens: number[];
}

interface HistoryUnit {
  start: number;
  endExclusive: number;
  messages: Message[];
  estimatedTokens: number;
  kind: 'single' | 'tool_batch';
}

interface CompactionPlan {
  sourceMessages: Message[];
  preservedUserMessages: Message[];
  recentMessages: Message[];
  summarizedMessageCount: number;
}
```

普通消息是单元素单元；assistant 工具调用和后续完整结果构成不可拆分的 `tool_batch`。

```typescript
type ContextEvent =
  | {
      type: 'context_progress';
      iteration: number;
      trigger: ContextTrigger;
      stage: 'lightweight' | 'estimating' | 'summarizing' | 'validating';
      estimatedTokens?: number;
      contextWindow: number;
    }
  | {
      type: 'context_offloaded';
      iteration: number;
      trigger: ContextTrigger;
      count: number;
    }
  | {
      type: 'context_compacted';
      iteration: number;
      trigger: ContextTrigger;
      beforeTokens: number;
      afterTokens: number;
      summarizedMessages: number;
      offloadedResults: number;
      consecutiveFailures: number;
      circuitOpen: boolean;
    }
  | {
      type: 'context_failed';
      iteration: number;
      trigger: ContextTrigger;
      code: ContextErrorCode;
      message: string;
      consecutiveFailures: number;
      circuitOpen: boolean;
    };
```

`AgentEvent` 并入 `ContextEvent`。上下文类型不依赖 Agent 类型，避免循环依赖。

## 模块设计

### `src/context/constants.ts`

定义默认窗口、阈值、上下文目录和七个摘要标题，并提供选项校验：

```typescript
const DEFAULT_CONTEXT_WINDOW = 128_000;
const CONTEXT_DIRECTORY = '.bettercode/context';
const CONTEXT_SUMMARY_HEADINGS: readonly string[];

function resolveContextOptions(
  input?: Partial<ContextManagerOptions>,
): ContextManagerOptions;
```

### `src/context/token-estimator.ts`

**职责：**

- 只估算 Provider 可见字段，忽略内部消息元数据。
- ASCII 按约 4 字符一个 Token、非 ASCII 按约 1 字符一个 Token 估算。
- 为消息、工具和结构字段增加固定开销，最终乘 1.1 安全系数并向上取整。
- 使用稳定 JSON 序列化工具定义、工具参数和消息协议字段。
- System Prompt 与工具哈希都相同才允许使用锚点。
- 查找消息哈希最长公共前缀，以“API 输入减旧后缀估算，加新后缀估算”计算当前值。
- usage 非正数、结构不兼容或锚点失效时回退全量估算。
- 重量改写后清除锚点；轻量替换可继续按变化后缀估算。

```typescript
class TokenEstimator {
  estimateText(value: string): number;
  estimateMessage(message: Message): number;
  estimateRequest(request: ProviderRequest): TokenEstimate;
  recordUsage(request: ProviderRequest, inputTokens: number): void;
  invalidate(): void;
  reset(): void;
}
```

缓存命中只影响费用，不从窗口估算中扣除。

### `src/context/tool-result-store.ts`

**职责：**

- 懒创建 `.bettercode/context/session-<uuid>/tool-results/`，无落盘时不产生目录。
- 用 `PathGuard` 校验项目与父目录，拒绝 `.bettercode`、`context` 或会话目录符号链接。
- 会话目录权限为 `0700`，结果文件权限为 `0600`。
- 文件名由批次序号、清理后的工具名和 SHA-256 前缀组成，不含参数或正文。
- 使用 `O_CREAT | O_EXCL | O_NOFOLLOW` 写同目录临时文件，完成写入和同步后重命名为 `.json`。
- 批量写入先完成所有临时文件；任一失败或取消时删除本批次全部临时文件和未引用成品。
- 返回 POSIX 风格项目相对路径。
- `clear()` 删除当前会话目录并重置惰性会话；`close()` 幂等清理。

```typescript
interface ToolResultWriteInput {
  toolCallId: string;
  toolName: string;
  content: string;
}

interface StoredToolResult {
  relativePath: string;
  originalBytes: number;
  sha256: string;
}

class ToolResultStore {
  constructor(rootDir: string);
  writeBatch(
    inputs: readonly ToolResultWriteInput[],
    signal: AbortSignal,
  ): Promise<StoredToolResult[]>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
```

本章不自动删除异常退出留下的旧目录。没有可靠跨进程所有权判断时，保留比误删活动会话安全。

### `src/context/lightweight-compactor.ts`

**职责：**

- 扫描尚无 `contextReference` 的工具消息。
- 先选择超过单结果阈值的消息。
- 再按 assistant 工具批次计算替换后合计，超限时按原始 Token 降序、调用顺序升序继续选择。
- 为固定元数据预留预算，剩余预览预算平均分配给头尾。
- 文件批量写入成功后，才在历史副本中替换正文并附加内部引用。
- 占位包含工具名、调用标识、相对路径、字节数、估算 Token、SHA-256 和头尾预览。
- 已落盘消息按占位正文参与批次合计，不重复写入。

```typescript
interface LightweightResult {
  history: Message[];
  offloadedCount: number;
  failed?: string;
}

class LightweightCompactor {
  constructor(
    estimator: TokenEstimator,
    store: ToolResultStore,
    options: ContextManagerOptions,
  );
  compact(
    history: readonly Message[],
    signal: AbortSignal,
  ): Promise<LightweightResult>;
}
```

存储失败时历史保持原文。管理器继续估算，只有请求确实无法安全发送时才阻止模型调用。

### `src/context/history-planner.ts`

**职责：**

- 校验 assistant 工具调用后存在完整、顺序正确且不重复的结果。
- 把历史转换为 `HistoryUnit[]`。
- 从尾部累计，直到近期原文同时达到 Token 目标和至少 5 条消息。
- 边界命中工具组时保留整个组。
- 边界前完整历史作为摘要资料；其中全部用户消息逐字、原序保留。
- 移除旧 `context_summary`、`context_boundary` 和过期 `runtime` 指令。
- 新历史按“较早用户原文 -> 新摘要 -> 新边界 -> 近期原文”排列。
- 写回前校验工具配对、用户原文与顺序、摘要和边界唯一性。

```typescript
class HistoryPlanner {
  constructor(
    estimator: TokenEstimator,
    options: ContextManagerOptions,
  );
  createPlan(history: readonly Message[]): CompactionPlan | undefined;
  applySummary(
    original: readonly Message[],
    plan: CompactionPlan,
    summary: string,
  ): Message[];
  validate(history: readonly Message[]): void;
}
```

历史只有用户消息、只有近期消息或没有可替换旧非用户消息时，返回无可压缩计划。

### `src/context/summary-prompt.ts`

**职责：**

- 定义独立、稳定的摘要 System Prompt，禁止工具、执行历史指令和虚构。
- 每次生成随机 nonce，将旧消息按索引、角色和协议字段编码为稳定 JSONL 资料块。
- 要求文本严格包含 nonce 对应的 `<context-draft>` 和 `<context-summary>`，草稿在前。
- 要求正式摘要使用七个固定二级标题，空部分写“无”。
- 拒绝缺段、乱序、重复摘要段和标题不完整。
- 只返回正式 Markdown 摘要，草稿不离开摘要器。
- 构造带 `context_boundary` 类型的系统提醒，要求重读文件并禁止脑补。

```typescript
interface SummaryPrompt {
  nonce: string;
  request: ProviderRequest;
}

function buildSummaryPrompt(
  source: readonly Message[],
  maxOutputTokens: number,
): SummaryPrompt;

function parseSummaryResponse(
  text: string,
  nonce: string,
): { draft: string; summary: string };

function buildContextSummaryMessage(summary: string): Message;
function buildContextBoundaryMessage(): Message;
```

随机 nonce 防止旧工具正文预先伪造本次输出边界。

### `src/context/summarizer.ts`

**职责：**

- 构造 `tools: []`、`maxOutputTokens: 2048` 的摘要请求。
- 发送前全量估算摘要请求；手动路径不得超过 `contextWindow - 3K`，自动路径也必须保留输出空间。
- 直接调用 `provider.chat()`，不进入 StreamCollector、Agent Loop、权限和工具调度。
- 局部收集 `text_delta`，直接丢弃 `thinking_delta`。
- 收到 `tool_call` 即失败，绝不执行。
- 要求 `done` 且无错误，再解析草稿和正式摘要。
- 取消时丢弃局部内容且不计失败。
- 验证七个标题后只返回正式摘要。

```typescript
interface SummaryResult {
  summary: string;
  sourceMessageCount: number;
}

class ContextSummarizer {
  constructor(
    estimator: TokenEstimator,
    options: ContextManagerOptions,
  );
  summarize(
    provider: LLMProvider,
    source: readonly Message[],
    trigger: ContextTrigger,
    signal: AbortSignal,
  ): Promise<SummaryResult>;
}
```

摘要 usage 不更新正常会话锚点。

### `src/context/manager.ts`

**职责：**

- 拥有估算器、存储器、轻量压缩器、历史规划器和摘要器。
- 持有连续摘要失败次数、熔断状态和累计落盘数。
- 使用 Promise 锁串行化自动管理、手动压缩、清理和关闭。
- 每次先轻量压缩，再构造完整请求并估算。
- 自动路径低于 `contextWindow - 13K` 直接返回 `ready`。
- 自动路径达到触发线且熔断打开时返回 `CONTEXT_CIRCUIT_OPEN`，不请求摘要。
- 手动路径忽略自动触发线和熔断开关，允许一次明确重试。
- 摘要成功后生成并校验新历史，清除锚点并重新估算。
- 摘要成功即清零失败计数；若压缩后仍超自动安全线，保留有效压缩历史但返回容量错误，不再次摘要。
- 摘要失败保留轻量处理后的历史并加一；达到三次后打开熔断。
- 取消不增加计数，不写回摘要。
- `recordUsage()` 只接受正常请求。
- `clear()` 重置锚点、计数、熔断和会话文件；`close()` 幂等清理并拒绝新事务。

```typescript
class ContextManager {
  constructor(
    rootDir: string,
    options?: Partial<ContextManagerOptions>,
  );
  manage(input: ContextManageInput): Promise<ContextManageResult>;
  recordUsage(request: ProviderRequest, usage?: TokenUsage): void;
  getStatus(): ContextStatus;
  clear(): Promise<void>;
  close(): Promise<void>;
}
```

等待事务锁期间收到取消会直接返回 `cancelled`，不会执行过期压缩。

## 现有模块改动

### 配置与 Provider

- `src/config/types.ts`：`ProviderConfig` 增加可选 `context_window`。
- `src/config/loader.ts`：校验其为正整数；缺失保持 `undefined`，不在 loader 中直接打印提示。
- `src/provider/types.ts`：增加窗口能力、`maxOutputTokens?` 和消息内部元数据。
- `src/provider/openai.ts`：使用配置窗口或默认 128K，仅在指定时发送 `max_tokens`。
- `src/provider/anthropic.ts`：使用配置窗口或默认 128K，发送 `request.maxOutputTokens ?? 4096`。
- 两种 Provider 的 usage 与缓存字段语义保持不变，内部消息元数据不进入 HTTP 请求。

### Agent

- `AgentStopReason` 增加 `context_error`，`AgentEvent` 并入 `ContextEvent`。
- AgentLoop 接收共享 ContextManager。
- 抽取请求构造逻辑，运行时提醒附加 `instructionKind: 'runtime'`。
- 每轮 `collector.collect()` 前调用自动管理，使用返回历史和请求。
- `blocked` 直接停止且不发送正常请求；`cancelled` 沿用取消路径。
- 正常响应获得 usage 后，用实际请求更新锚点。
- 工具结果仍先追加历史，下一轮请求前统一处理。
- 增加手动压缩入口，以 Act Mode 全工具和新鲜运行时提醒构造最大发电估算模板。

```typescript
class AgentLoop {
  compactHistory(
    history: readonly Message[],
    provider: LLMProvider,
    signal: AbortSignal,
    emit: (event: AgentEvent) => void,
  ): Promise<ContextManageResult>;
}
```

### ChatManager

- 创建并持有单个 ContextManager，再注入 AgentLoop。
- 构造选项兼容原 Agent 字段，并增加 `context` 测试选项。
- 增加 `compact(provider, signal)` 事件流，复用 `active` 锁。
- 手动成功后替换历史；跳过或失败保持结果返回的历史。
- `clear()` 改为异步，清空历史、计划、会话权限和上下文状态。
- 增加幂等 `close()` 清理 ContextManager。

```typescript
interface ChatManagerOptions extends Partial<AgentLoopOptions> {
  context?: Partial<ContextManagerOptions>;
}

class ChatManager {
  compact(
    provider: LLMProvider,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
```

`compact()` 不追加 `/compact` 用户消息，也不修改最近计划。

### UI、入口与 Git

- `src/ui/app.tsx` 帮助增加 `/compact`，默认 128K 时显示一次配置提示。
- `/clear` 等待异步清理；`/compact` 消费 ChatManager 事件流，不追加用户消息。
- 自动压缩只更新底部进度；手动成功显示压缩前后估算、摘要消息数、落盘数和熔断状态。
- `context_error` 使用独立停止提示，不误报模型流错误。
- UI 不显示摘要草稿、完整工具正文或内部摘要 Prompt。
- `src/index.tsx` 将 ChatManager 保存到 `finally` 可见变量，先关闭 ChatManager，再关闭 MCP Manager；一个关闭失败不阻断另一个。
- `.gitignore` 增加 `.bettercode/context/`，不忽略整个 `.bettercode/`。

## 模块交互

### 自动轻量处理

```text
AgentLoop 第 N 轮
  -> 构造 history + runtime messages + tools
  -> ContextManager.manage(automatic)
       -> LightweightCompactor.compact
       -> TokenEstimator.estimateRequest
       -> estimate < contextWindow - 13K
       -> ready(history, request)
  -> provider.chat(request)
  -> ContextManager.recordUsage(request, usage)
```

轻量落盘失败保留原正文并继续估算。低于自动线仍可请求；达到自动线则进入重量摘要。

### 自动重量压缩

```text
ContextManager.manage(automatic)
  -> 轻量处理与估算
  -> 达到 contextWindow - 13K
  -> 检查熔断
  -> HistoryPlanner.createPlan
       -> 尾部保留 >= 10K 且 >= 5 条
       -> 工具调用组不拆分
       -> 较早用户消息原文保留
  -> ContextSummarizer.summarize
       -> provider.chat({ tools: [], maxOutputTokens: 2048 })
       -> 收集草稿和正式摘要
       -> 验证七个标题并丢弃草稿
  -> HistoryPlanner.applySummary
  -> TokenEstimator.invalidate
  -> 重新估算正常请求
  -> ready 或容量不足 blocked
```

摘要请求不经过 Agent、权限或工具调度。模型返回工具调用只会导致摘要失败。

### 失败与熔断

```text
摘要失败
  -> 保留轻量处理后的历史
  -> consecutiveFailures += 1
  -> 三次后 circuitOpen = true
  -> blocked，正常请求不发送

后续自动触发且熔断打开
  -> 不请求摘要，直接 blocked

用户 /compact
  -> 允许一次人工重试
  -> 成功：计数清零、关闭熔断
  -> 失败：保持熔断
```

取消不修改失败计数。摘要成功但固定内容仍超限属于容量不足，不计摘要失败，也不重复摘要。

### 手动与清理

```text
/compact
  -> 不追加用户消息
  -> ChatManager.compact
       -> AgentLoop.compactHistory
       -> ContextManager.manage(manual)
            -> 强制尝试压缩计划
            -> 摘要请求低于 contextWindow - 3K
       -> 成功时替换 history

/clear
  -> ContextManager.clear
       -> 清会话目录、锚点、计数、熔断
  -> 清 history、latestPlan、会话权限

TUI 退出
  -> ChatManager.close
  -> McpManager.close
```

## 文件组织

```text
src/context/
├── constants.ts / constants.test.ts
├── types.ts
├── token-estimator.ts / token-estimator.test.ts
├── tool-result-store.ts / tool-result-store.test.ts
├── lightweight-compactor.ts / lightweight-compactor.test.ts
├── history-planner.ts / history-planner.test.ts
├── summary-prompt.ts / summary-prompt.test.ts
├── summarizer.ts / summarizer.test.ts
└── manager.ts / manager.test.ts

src/config/types.ts
src/config/loader.ts / loader.test.ts
src/provider/types.ts
src/provider/openai.ts / openai.test.ts
src/provider/anthropic.ts / anthropic.test.ts
src/agent/types.ts
src/agent/loop.ts / loop.test.ts
src/chat/manager.ts / manager.test.ts
src/ui/app.tsx / app.test.ts
src/index.tsx
.gitignore
```

不新增运行时依赖，继续使用 Node.js 标准库、现有 `PathGuard` 和 Provider 流接口。

## 测试设计

### 单元测试

- **Token 估算**：中英文、代码、内部元数据忽略、后缀增量、usage 缺失、锚点失效和缓存 usage。
- **轻量压缩**：单结果与批次超限、大小排序、稳定同大小顺序、替换后重算、头尾预览、幂等和存储失败。
- **结果存储**：权限、相对路径、SHA-256、符号链接逃逸、批量回滚、取消、清理和幂等关闭。
- **历史规划**：10K 与 5 条双条件、工具原子组、用户原文、旧摘要合并、无可压缩内容和孤立结果拒绝。
- **摘要 Prompt**：nonce、JSONL、提示注入、缺段、乱序、重复标签和固定标题。
- **摘要器**：成功、thinking 丢弃、取消、流提前结束、错误、意外工具调用和 usage 隔离。
- **管理器**：自动边界、手动强制、三次熔断、手动恢复、压后仍超限、轻量失败、并发锁和重置。

### 集成与回归测试

- Agent 第一轮返回大工具结果，第二轮 Provider 收到占位，项目文件包含原完整结果。
- 可控 Provider 返回合法摘要，正常请求在摘要后发送，历史保留用户原文和近期工具组。
- 摘要失败时正常请求次数不增加，Agent 以 `context_error` 停止。
- `/compact` 不增加用户轮次，后续请求使用压缩历史。
- OpenAI 与 Anthropic 忽略内部元数据、发送摘要输出上限并维持工具配对。
- `/clear` 和 ChatManager 关闭后当前会话文件消失，MCP 仍正常关闭。
- 完整运行现有工具、Plan Mode、权限、系统提示缓存、MCP 和 TUI 测试。

## Spec 覆盖映射

| Spec | 设计归属 |
|------|----------|
| F1 | ContextManager、Agent 每轮请求前接入 |
| F2 | 轻量压缩器、结果存储器、消息内部引用 |
| F3 | 工具批次识别、稳定排序、替换后重算 |
| F4 | 项目目录、PathGuard、批量写入、清理、`.gitignore` |
| F5 | TokenEstimator usage 锚点、增量与全量回退 |
| F6 | 自动触发线、容量错误和单次摘要 |
| F7 | HistoryPlanner 双条件边界与工具原子组 |
| F8 | 用户原文过滤保留和逐字校验 |
| F9 | 空工具摘要、nonce 草稿与正式摘要解析 |
| F10 | 七个固定标题和单累计摘要写回 |
| F11 | instructionKind、摘要消息和边界提醒 |
| F12 | ChatManager.compact、3K 检查和 TUI 命令 |
| F13 | 连续失败、自动熔断、手动重试、请求阻断 |
| F14 | ContextEvent 与 UI 格式化 |
| F15 | 事务锁、文件回滚和历史副本写回 |

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 请求前接入 | Agent Loop 每轮 Provider 调用前 | 覆盖新轮次和同一 Agent 内连续工具循环 |
| Provider 职责 | 只暴露窗口、usage、输出上限 | 避免协议层重复压缩逻辑 |
| 会话状态 | ChatManager 持有 ContextManager | 自动、手动、清理共享锚点和熔断 |
| 窗口来源 | 显式配置，缺省 128K 并提示 | 兼容自定义端点，不维护模型名单 |
| 阈值入口 | 生产常量加构造注入 | 测试可控，不扩大用户配置范围 |
| Token 估算 | usage 锚点加消息后缀近似 | 符合锚定真实值、只估变化内容 |
| 字符权重 | ASCII 约 4:1，非 ASCII 约 1:1，加 10% | 对中文和代码偏保守 |
| 落盘标记 | Message 内部元数据 | 幂等且不可被工具正文伪造 |
| 批量写入 | 临时文件完成后提交，失败清理 | 历史不引用半写文件 |
| 近期边界 | Token 与消息数同时满足，工具组原子化 | 实现约 10K 且至少 5 条 |
| 用户消息 | 全部原文保留 | 用户要求比中间回复更可信 |
| 摘要调用 | Provider 直连且 `tools: []` | 不进入 Agent Loop，不执行工具 |
| 草稿隔离 | nonce 标签解析后只返回摘要 | 两种 Provider 通用，草稿不泄漏 |
| 摘要上限 | 2048 Token | 容纳七段结构并适配 3K 余量 |
| 写回方式 | 副本规划、校验后整体替换 | 失败不留下半压缩历史 |
| 压后仍超限 | 保留有效压缩并阻止请求 | 不循环摘要或冒险发送 |
| 熔断范围 | 会话级，只阻止自动摘要 | 防死循环并允许人工恢复 |
| 崩溃旧目录 | 本章不自动删除 | 无可靠所有权时避免误删其他会话 |
| 新依赖 | 不新增 | 标准库与现有模块足够 |

## 风险与处理

- **估算偏差**：真实 usage 锚点、非 ASCII 保守权重、10% 系数和 13K 余量共同缓解；错误窗口配置由启动提示暴露。
- **摘要遗漏**：固定结构与草稿只能降低风险，因此保留用户原文和近期历史，并强制提示重新读取文件。
- **用户原文过大**：返回容量不足，不自动改写；用户消息摘要留给后续章节。
- **格式不遵守**：nonce 和七标题校验拒绝不可靠输出，三次失败后熔断。
- **文件竞态**：真实路径检查、私有 `0700` 目录、`O_NOFOLLOW`、同目录临时文件和提交前复查共同降低风险。
- **摘要成本**：自动压缩提前触发，摘要不带工具 Schema且输出限制为 2048 Token；手动压缩由用户明确发起。
