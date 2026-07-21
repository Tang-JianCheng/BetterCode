# MewCode Agent Loop Plan

## 架构概览

本章在现有 Chat、Provider、Tool 和 UI 之间新增独立 Agent 编排层。`ChatManager` 继续拥有当前会话历史和最近成功计划，但不再直接处理 Provider 回调或执行单工具闭环；它把一次运行交给 `AgentLoop`，并向 UI 返回统一的异步事件流。

```text
Ink UI
  |  /plan、/do、普通任务、AbortSignal
  v
ChatManager（会话历史、最近计划、运行互斥）
  |
  v
AgentLoop（ReAct 循环、停止条件、累计用量）
  |--------------------------|
  v                          v
StreamCollector          ToolScheduler
  |                          |
  v                          v
LLMProvider             ToolRegistry
                          |
                          v
             read-only 并发 / side-effect 串行
```

- **ChatManager**：把普通任务、Plan Mode 和执行最近计划转换为 Agent 请求；保存每轮完成后的历史；仅在计划正常完成且文本非空时更新最近计划；`clear()` 同时清除历史和计划。
- **AgentLoop**：最多运行 10 轮，每轮收集一次完整模型响应，决定正常结束、调度工具、继续下一轮或按原因停止。
- **StreamCollector**：消费现有 Provider 回调，一路把正文、Thinking 和完整工具调用实时推入 Agent 事件队列，一路累积完整响应；只有收到正常 `done` 才把工具调用交给循环。
- **ToolScheduler**：识别工具安全级别和当前模式可用范围；只读工具并发执行，有副作用工具串行执行；最终按模型调用顺序返回全部结果。
- **Provider**：继续负责协议请求与 SSE 解析，新增统一 Token 用量事件，并严格区分正常结束、取消和流错误。
- **ToolRegistry**：为工具提供安全级别查询，并将外部取消信号与现有单工具超时组合后传给具体工具。
- **UI**：只解析命令、创建取消控制器并消费 `AgentEvent`，不读取循环内部状态。

一次运行只有一个生产者。内部事件队列将回调式生产过程转换为 `AsyncIterable<AgentEvent>`；UI 使用 `for await...of` 消费，因此 Agent 可以持续推送实时事件，同时在后台等待完整轮次结果。

### Spec 覆盖

| Spec | 架构归属 |
|---|---|
| F1-F2、F10-F14 | AgentLoop + ChatManager |
| F3 | StreamCollector |
| F4-F6 | AgentEvent + StreamCollector + Provider |
| F7-F9 | ToolScheduler + ToolRegistry |
| F15-F18 | ChatManager + Plan prompts + ToolScheduler |
| F19 | Ink UI |
| N1 | Provider 统一事件 |
| N2-N5 | Agent 层、事件队列、取消传播 |
| N6-N9 | 回归测试、既有 Tool 约束、平台检查 |

## 核心数据结构

### Provider 流事件

`src/provider/types.ts` 保留回调式 `LLMProvider.chat()`，扩展用量事件：

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

type StreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'error'; content: string }
  | { type: 'done'; content: '' };
```

`usage` 表示当前 Provider 请求的完整快照，不是增量。Provider 只有在协议实际返回用量时才发出它；一次流内出现多个用量片段时，Provider 合并后在正常结束前发出一次。

### Agent 模式与停止原因

```typescript
type AgentMode = 'act' | 'plan';

type AgentStopReason =
  | 'completed'
  | 'max_iterations'
  | 'cancelled'
  | 'unknown_tool_limit'
  | 'stream_error';

type AgentProgressStage =
  | 'requesting_model'
  | 'model_complete'
  | 'executing_tools'
  | 'tools_complete';
```

### Agent 事件

```typescript
type AgentEvent =
  | { type: 'text_delta'; iteration: number; content: string }
  | { type: 'thinking_delta'; iteration: number; content: string }
  | { type: 'tool_call'; iteration: number; call: ToolCall }
  | {
      type: 'tool_result';
      iteration: number;
      call: ToolCall;
      result: ToolResult;
    }
  | {
      type: 'usage';
      iteration: number;
      current: TokenUsage;
      cumulative: TokenUsage;
    }
  | {
      type: 'progress';
      iteration: number;
      maxIterations: number;
      stage: AgentProgressStage;
      toolName?: string;
      toolCallId?: string;
    }
  | { type: 'error'; iteration: number; message: string }
  | {
      type: 'stopped';
      reason: AgentStopReason;
      iterations: number;
      finalText: string;
    };
```

每次运行必须恰好产生一个 `stopped` 终止事件。工具自身失败通过 `tool_result` 表达，不产生 Agent `error`；`error` 只用于会终止当前模型轮的流错误或 Agent 内部异常。

### 完整轮次结果

```typescript
interface CollectedTurn {
  text: string;
  thinking: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  status: 'completed' | 'cancelled' | 'stream_error';
  error?: string;
}

class StreamCollector {
  collect(
    provider: LLMProvider,
    messages: Message[],
    tools: ToolDefinition[],
    iteration: number,
    signal: AbortSignal,
    emit: (event: AgentEvent) => void,
  ): Promise<CollectedTurn>;
}
```

`StreamCollector` 在回调到达时立即发送正文、Thinking 和工具调用事件，同时累积相同内容。流错误时保留已推送给 UI 的片段，但返回 `stream_error`，调用方不把未完成轮次写入协议历史，也不执行已收集但未确认完整的工具调用。

### 工具安全级别

```typescript
type ToolEffect = 'read_only' | 'side_effect';

interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly effect: ToolEffect;
  execute(input: JsonObject, context: ToolContext): Promise<ToolResult>;
}
```

安全级别固定如下：

| 工具 | effect |
|---|---|
| `read_file` | `read_only` |
| `find_files` | `read_only` |
| `search_code` | `read_only` |
| `write_file` | `side_effect` |
| `edit_file` | `side_effect` |
| `run_command` | `side_effect` |

`effect` 仅用于本地调度，不加入发送给模型的 `ToolDefinition`。

`ToolErrorCode` 增加：

```typescript
type AddedToolErrorCode = 'TOOL_UNAVAILABLE' | 'CANCELLED';
```

- `TOOL_NOT_FOUND`：注册中心不存在该名称。
- `TOOL_UNAVAILABLE`：工具存在，但当前 Plan Mode 不允许。
- `CANCELLED`：外部取消或未知工具阈值触发后，该调用未执行或未完成。

### 工具批次结果

```typescript
interface ScheduledToolResult {
  call: ToolCall;
  result: ToolResult;
}

interface ToolBatchResult {
  results: ScheduledToolResult[];
  unknownToolStreak: number;
  unknownToolLimitReached: boolean;
  cancelled: boolean;
}

interface ToolScheduleOptions {
  mode: AgentMode;
  initialUnknownToolStreak: number;
  unknownToolLimit: number;
  signal: AbortSignal;
  onProgress: (event: AgentEvent) => void;
}

class ToolScheduler {
  constructor(registry: ToolRegistry);
  executeBatch(
    calls: ToolCall[],
    iteration: number,
    options: ToolScheduleOptions,
  ): Promise<ToolBatchResult>;
}
```

`results` 始终按模型原始调用顺序排列。达到连续未知工具阈值后，本响应中排在阈值之后的调用不再执行，并获得 `CANCELLED` 结构化结果；这样历史中的每个 assistant tool call 仍有对应 tool result，同时不会在停止条件之后产生副作用。

### Agent Loop 请求与结果

```typescript
interface AgentLoopOptions {
  maxIterations: number;       // 默认 10
  unknownToolLimit: number;    // 默认 3
}

interface AgentLoopRequest {
  history: Message[];
  userMessage: string;
  mode: AgentMode;
  provider: LLMProvider;
  signal: AbortSignal;
}

interface AgentOutcome {
  reason: AgentStopReason;
  iterations: number;
  finalText: string;
  history: Message[];
  usage: TokenUsage;
}

class AgentLoop {
  constructor(
    registry: ToolRegistry,
    options?: Partial<AgentLoopOptions>,
  );

  execute(
    request: AgentLoopRequest,
    emit: (event: AgentEvent) => void,
  ): Promise<AgentOutcome>;
}
```

循环在传入历史的副本上工作，完成或停止时返回新历史。ChatManager 只在运行收尾时替换会话历史，避免在途流错误留下不完整的 assistant/tool 协议组合。

### 会话与计划状态

```typescript
interface SavedPlan {
  task: string;
  content: string;
}

interface AgentRunOptions {
  mode?: AgentMode;
  signal?: AbortSignal;
}

class ChatManager {
  constructor(
    toolRegistry: ToolRegistry,
    options?: Partial<AgentLoopOptions>,
    systemPrompt?: string,
  );

  run(
    userInput: string,
    provider: LLMProvider,
    options?: AgentRunOptions,
  ): AsyncIterable<AgentEvent>;

  executeLatestPlan(
    provider: LLMProvider,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent>;

  getHistory(): ReadonlyArray<Message>;
  getLatestPlan(): Readonly<SavedPlan> | undefined;
  clear(): void;
}
```

`run(..., { mode: 'plan' })` 使用计划提示构造模型可读的 user message，并只开放只读工具。只有停止原因为 `completed` 且最终文本非空时才保存 `SavedPlan`。`executeLatestPlan()` 同步检查计划；没有计划时抛出可识别的 `NoPlanError`，因此不会创建事件生产者、调用 Provider 或执行工具。存在计划时，它把任务和计划内容组成执行指令，使用 `act` 模式继续当前历史。

ChatManager 同一时间只允许一个活动运行，防止两个异步循环交错修改历史；UI 正常状态下也只会启动一个运行。

ToolRegistry 对调度层补充以下接口：

```typescript
class ToolRegistry {
  definitions(effect?: ToolEffect): ToolDefinition[];
  effectOf(name: string): ToolEffect | undefined;
  execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult>;
}
```

不传 `effect` 时保持返回全部定义的既有行为。

## 模块设计

### 异步事件队列

**文件：** `src/agent/event-stream.ts`

**职责：** 将 `producer(emit)` 形式的异步生产过程适配为单消费者 `AsyncIterable<AgentEvent>`。队列缓存消费者尚未读取的事件，生产结束后关闭；生产异常被 Agent 外层转换为 `error` 和唯一 `stopped`，不作为未处理 Promise 泄漏。

**对外接口：**

```typescript
function createEventStream<T>(
  producer: (emit: (event: T) => void) => Promise<void>,
): AsyncIterable<T>;
```

### StreamCollector

**文件：** `src/agent/stream-collector.ts`

**职责：** 调用一次 `provider.chat()`；实时转发正文、Thinking 和完整工具调用；保存完整文本、Thinking、工具调用和最后一份用量快照；验证流是否正常 `done`。

**规则：**

1. Provider 发出 `error` 后记录首个错误，后续事件不再改变轮次结论。
2. 外部 signal 已取消时返回 `cancelled`，优先级高于“缺少 done”。
3. 未取消、无显式错误但 Provider 返回前没有 `done`，归一化为“流提前结束”。
4. 只有 `completed` 的 `toolCalls` 可交给 ToolScheduler。
5. `usage` 不伪造；正常完成后由 AgentLoop 计算累计值并发出 Agent usage 事件。

### AgentLoop

**文件：** `src/agent/loop.ts`

**职责：** 实现 ReAct 循环和全部停止条件，不处理 UI 命令。

**每轮流程：**

1. 检查取消状态，发出 `requesting_model` 进度。
2. 按模式取得工具定义：`act` 为六个工具，`plan` 仅三个只读工具。
3. StreamCollector 调用 Provider，实时事件进入外部队列。
4. `cancelled` 或 `stream_error` 立即结束；未完成轮次不加入历史。
5. 正常完成后发出 `model_complete` 和可用的 Token usage。
6. 无工具调用：追加 assistant 文本，以 `completed` 停止。
7. 有工具调用：发出 `executing_tools`，交给 ToolScheduler。
8. 将 assistant 文本及全部 calls、按原顺序的 tool results 追加到历史，再发出 tool result 与 `tools_complete`。
9. 若取消或未知工具达到 3 次，按对应原因停止。
10. 若当前是第 10 轮，以 `max_iterations` 停止；否则进入下一轮。

`finalText` 是本次运行所有已正常完成模型轮次文本的顺序拼接，供 UI 固化一次连续回复；协议历史仍按每轮保存独立 assistant 消息。

### ToolScheduler

**文件：** `src/agent/tool-scheduler.ts`

**职责：** 生成一一对应的调用结果、维护连续未知工具计数，并执行安全调度。

**调度算法：**

1. 按原始顺序检查每个调用。
2. 未注册工具生成 `TOOL_NOT_FOUND`；Plan Mode 中副作用工具生成 `TOOL_UNAVAILABLE`；两者增加连续计数。
3. 当前模式允许的已注册工具将连续计数归零，并按 `effect` 放入只读或副作用执行集合。
4. 连续计数首次达到 3 后，剩余调用统一生成 `CANCELLED`，不进入执行集合。
5. 对达到阈值前的全部只读调用执行 `Promise.all`。
6. 只读集合完成后，按原始相对顺序逐个执行副作用调用；每次执行前再次检查 signal。
7. 外部取消后，尚未开始或未完成的调用生成 `CANCELLED`；迟到结果不覆盖取消结果。
8. 最终按原始索引组装结果并按该顺序发出 `tool_result`。

参数错误、路径错误、超时等普通工具失败不影响未知计数，也不终止批次。

### ToolRegistry 与六个工具

**文件：** `src/tool/types.ts`、`src/tool/registry.ts`、`src/tool/tools/*.ts`

**职责变化：**

- 六个工具声明固定 `effect`。
- Registry 增加 `effectOf(name)` 和按 effect 过滤定义的能力。
- `execute(call, signal?)` 接收外部取消信号，与内部 30 秒超时 signal 合并后放入 `ToolContext`。
- 外部取消与内部超时分别返回 `CANCELLED` 和 `TIMEOUT`，避免用户取消被误报为工具超时。
- 现有参数校验、路径保护、输出限制和异常归一化保持不变。

### OpenAI Provider

**文件：** `src/provider/openai.ts`

**变化：**

- 请求流式接口时声明用量回传选项；响应包含 `usage.prompt_tokens`、`completion_tokens`、`total_tokens` 时归一化为 `TokenUsage`。
- 继续按 `tool_calls[].index` 聚合多个调用及 JSON 参数碎片。
- `[DONE]` 是正常结束标记；正常结束前发出合并后的 `usage`，再发出一次 `done`。
- 非法 SSE JSON、工具参数 JSON 非法、网络/HTTP 错误、读取异常或未出现正常结束标记均发出 `error`，不再静默忽略或伪装为 `done`。
- AbortError 不发出流错误；Agent 通过 signal 将其识别为 `cancelled`。

### Anthropic Provider

**文件：** `src/provider/anthropic.ts`

**变化：**

- 从 `message_start.message.usage` 收集输入 Token，从 `message_delta.usage` 收集最终输出 Token，在 `message_stop` 前归一化并发出一次 `usage`。
- 继续按 content block 索引聚合多个 `tool_use` 和 `input_json_delta`。
- `message_stop` 是正常结束标记；流在此之前结束属于流错误。
- 非法 SSE JSON、非法工具参数、协议 error 事件和读取异常发出 `error` 并终止本轮。
- AbortError 与 OpenAI Provider 使用相同取消语义。

### Plan Mode 提示

**文件：** `src/agent/prompts.ts`

提供两个固定构造函数：

```typescript
function buildPlanRequest(task: string): string;
function buildExecutePlanRequest(plan: SavedPlan): string;
```

计划请求明确要求先检查项目、禁止修改并输出可执行计划；真正的只读边界仍由 ToolScheduler 保证，提示文本不作为安全机制。执行请求包含最近计划的原任务和完整计划文本，确保 `/do` 不依赖模型自行猜测“最近”指哪一段历史。

### ChatManager

**文件：** `src/chat/manager.ts`

移除现有“两次请求、只执行一个工具”的 `send()` 实现，改为会话门面：

- 调用 AgentLoop 并通过事件队列返回异步事件。
- 在生产者 `finally` 中释放运行互斥状态。
- 每种停止原因收尾后都采用 AgentOutcome.history；其中只包含本次运行开始消息、完整模型轮次及其完整工具结果，流错误所在的不完整轮次不在内。
- Plan Mode 成功时更新 `latestPlan`；其他停止原因保留此前成功计划。
- `/do` 使用最近计划启动 act 模式。
- `clear()` 清空历史和 latestPlan；活动运行期间由 UI 先取消，不直接并发清空。

### Ink UI

**文件：** `src/ui/app.tsx`、`src/ui/input-box.tsx`

**行为：**

- 普通输入调用 `chatManager.run(..., { mode: 'act' })`。
- `/plan <任务>` 显示原始用户命令，调用 plan 模式；空任务只显示格式错误。
- `/do` 调用 `executeLatestPlan()`；捕获 `NoPlanError` 后直接显示提示。
- 每次运行创建一个 `AbortController`，使用 `for await...of` 消费 Agent 事件。
- 正文和 Thinking 使用 ref 与 state 双写，跨多个 Agent 轮次持续累积；`stopped` 时只固化一次 assistant 展示消息。
- progress 更新固定状态行；tool call/result 用于显示当前工具名称；usage 显示累计 Token。
- 运行中按 `Ctrl+C` 仅调用 `abort()`，等待 `cancelled` 停止事件后恢复输入；空闲时 `Ctrl+C` 保持退出应用。
- InputBox 忽略控制字符，避免空闲时 Ctrl+C 被写入输入内容。
- `/help` 增加 `/plan`、`/do` 及 Ctrl+C 双重行为。

不新增复杂工具时间线；工具详情仍通过 Agent 事件提供给未来界面使用，本章 TUI 只显示紧凑进度。

## 模块交互

### 普通多轮任务

```text
UI -> ChatManager.run(task, act)
   -> event stream
   -> AgentLoop iteration 1
      -> StreamCollector -> Provider
      <- text/tool_call events -> UI
      -> ToolScheduler
         -> read-only tools in parallel
         -> side-effect tools in sequence
      <- ordered tool_result events -> UI
      -> history append assistant + tool results
   -> AgentLoop iteration 2 ...
   -> Provider returns text without tools
   -> history append final assistant
   <- stopped(completed) -> UI
```

### Plan 与执行

```text
/plan task
  -> ChatManager builds plan request
  -> AgentLoop(mode=plan, definitions=read_only)
  -> completed + non-empty finalText
  -> save latestPlan(task, finalText)

/do
  -> ChatManager reads latestPlan
  -> builds execution request containing task + plan
  -> AgentLoop(mode=act, definitions=all)
  -> continues same conversation history
```

### 用户取消

```text
Ctrl+C while running
  -> UI AbortController.abort()
  -> Provider fetch / ToolRegistry context receives signal
  -> StreamCollector or ToolScheduler returns cancelled
  -> AgentLoop starts no more work
  -> stopped(cancelled)
  -> ChatManager preserves completed history
  -> UI restores input
```

### 连续未知工具

```text
tool calls in model order
  -> unknown/unavailable: structured result, streak + 1
  -> allowed tool: streak = 0
  -> streak reaches 3: remaining calls marked CANCELLED
  -> append one result for every call
  -> stopped(unknown_tool_limit), no next model request
```

### 流错误

```text
Provider emits error or ends without normal marker
  -> StreamCollector status=stream_error
  -> discard incomplete current assistant turn
  -> execute no collected tool calls
  -> error event
  -> stopped(stream_error)
```

## 文件组织

```text
project/
├── src/
│   ├── agent/
│   │   ├── types.ts                  — Agent 模式、事件、停止原因、请求与结果
│   │   ├── event-stream.ts           — 回调生产者到 AsyncIterable 的事件队列
│   │   ├── stream-collector.ts       — 实时转发与完整轮次收集
│   │   ├── tool-scheduler.ts         — 工具可用性、未知计数、并发/串行调度
│   │   ├── prompts.ts                — Plan 与执行计划提示构造
│   │   ├── loop.ts                   — ReAct 循环及停止条件
│   │   ├── stream-collector.test.ts
│   │   ├── tool-scheduler.test.ts
│   │   └── loop.test.ts
│   ├── chat/
│   │   ├── manager.ts                — 会话、最近计划、异步运行门面
│   │   └── manager.test.ts           — Plan、/do、clear、运行互斥
│   ├── provider/
│   │   ├── types.ts                  — TokenUsage 与 usage 流事件
│   │   ├── openai.ts                 — OpenAI 用量与严格流结束
│   │   ├── openai.test.ts
│   │   ├── anthropic.ts              — Anthropic 用量与严格流结束
│   │   └── anthropic.test.ts
│   ├── tool/
│   │   ├── types.ts                  — ToolEffect、新错误码、Tool.effect
│   │   ├── registry.ts               — effect 查询与外部取消信号
│   │   ├── registry.test.ts
│   │   └── tools/*.ts                — 六个工具声明 effect
│   ├── ui/
│   │   ├── app.tsx                   — 命令、事件消费、进度与取消
│   │   └── input-box.tsx             — 控制字符处理
│   └── index.tsx                     — 继续创建 Registry 与 ChatManager
└── docs/agent-loop/
    ├── spec.md
    ├── plan.md
    ├── task.md
    └── checklist.md
```

不新增运行时或开发依赖，继续使用 Node.js、TypeScript、Ink、`node:test` 和现有 `pnpm check`。

## 测试设计

### StreamCollector

- 文本、Thinking、多个工具调用碎片实时转发且完整结果一致。
- usage 正确保存；无 usage 时保持 `undefined`。
- 显式 error、缺少 done、Provider 抛异常分别归一化为 stream error。
- signal 取消优先归类为 cancelled，未完成工具不交给调度器。

### ToolScheduler

- 三个延迟只读 Fake Tool 同时启动，结果保持调用顺序。
- 写入、编辑、命令 Fake Tool 严格串行。
- 混合批次先完成只读集合，再按顺序执行副作用集合。
- 工具普通失败继续返回，不触发停止。
- 未知与 Plan Mode 不可用工具累计到 3，允许工具重置计数，阈值之后调用不执行。
- 取消使未完成调用返回 CANCELLED，迟到结果不驱动后续工具。

### AgentLoop

- 首轮纯文本正常结束。
- 多轮工具结果回灌后自主继续，最终文本和历史正确。
- 第 10 轮工具执行并回灌后停止，不发起第 11 次请求。
- 模型流、工具执行期间取消均停止后续轮次。
- 连续未知工具、流错误各自产生唯一正确停止事件。
- Token 用量按轮和累计值正确。
- 每次运行事件顺序和调用标识正确。

### ChatManager 与 Plan Mode

- Plan Mode 只传三个只读定义并保存成功非空计划。
- 取消、流错误、未知上限或最大轮次不覆盖此前成功计划。
- 多个成功计划只保留最近一个供 `/do` 使用。
- `/do` 请求包含最近任务和计划，开放六个工具并延续历史。
- 无计划 `/do` 不调用 Provider；`clear()` 清空历史和计划。

### Provider 与回归

- OpenAI 与 Anthropic 各自解析多个工具调用、用量和正常结束标记。
- 非法 SSE、非法工具参数、流提前结束和 AbortError 使用预期语义。
- 现有消息映射、Thinking、HTTP 错误和工具回灌测试继续通过。
- Tool Registry 的参数校验、超时、外部取消和 effect 查询通过。
- 六个工具、PathGuard 和输出限制现有测试继续通过。

## 技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| Agent 对外输出 | `AsyncIterable<AgentEvent>` | 满足异步事件流，UI、测试和未来其他界面使用同一接口 |
| 回调到异步流适配 | 内部单消费者事件队列 | 保留现有 Provider 接口，避免同时重写两套 SSE 网络层 |
| 双路收集 | StreamCollector 实时 emit + 完整累积 | UI 不等待整轮，Agent 又能获得可靠完整响应 |
| 会话所有权 | ChatManager 保存历史与最近计划 | 延续现有职责，`/clear` 和 `/do` 状态边界明确 |
| 循环实现 | 独立 AgentLoop | 停止条件和 Provider/Tool 编排可脱离 Ink 测试 |
| 工具安全分类 | Tool 固定 `effect` 元数据 | 分类由工具自身声明，注册中心与调度器不维护易漂移的名称列表 |
| 只读执行 | 同轮 `Promise.all` | 满足并发要求，且只读工具不会相互修改项目 |
| 副作用执行 | 只读批次后按原顺序串行 | 保证写入、编辑和命令的确定副作用顺序 |
| 结果顺序 | 缓存实际完成结果，按原始索引发出和回灌 | 兼顾并发性能与协议确定性 |
| 未知阈值后调用 | 不执行并返回 CANCELLED | 命中停止条件后不再产生副作用，同时保持每个调用都有结果 |
| 迭代定义 | 一次模型请求及其工具批次为一轮 | 第 10 轮行为明确，工具结果不会因上限被无故丢弃 |
| Provider 错误 | `done` 只代表协议正常结束 | 让 Agent 能可靠区分完成、取消和流错误 |
| Token 用量 | Provider 归一化每轮快照，Agent 累计 | 协议差异留在 Provider，Agent 事件保持统一 |
| 取消 | UI AbortController 贯穿 Provider 与 Registry | 一个信号覆盖模型请求、工具执行和后续轮次门禁 |
| Plan 安全 | 只发送只读 definitions + Scheduler 二次拦截 | API 暴露和执行入口同时限制，模型猜测工具名也不能产生副作用 |
| 最近计划 | 仅内存保存最近成功非空计划 | 符合本章范围，不引入持久化或计划选择界面 |
| 依赖 | 不新增依赖 | 现有 Node 原语足以实现队列、取消、并发和测试 |

## 自检结果

- Spec 的 F1-F19 均有明确模块归属和测试路径。
- Agent、Collector、Scheduler、Registry、Provider 与 UI 的依赖方向单向，不依赖 Ink 的模块均可独立测试。
- 每种停止原因都有唯一入口和终止事件；普通工具失败与 Agent 失败明确分离。
- Plan Mode 的工具暴露和执行拦截形成双重只读边界。
- 本设计不包含权限审批、上下文压缩、交互式确认、持久化或新增工具。
