# BetterCode 结构化系统提示与缓存策略 Plan

## 架构概览

本阶段在现有 Chat、Agent、Provider 和 Tool 之间新增独立 Prompt 层。Prompt 层分别生成稳定系统提示和单轮补充消息；Provider 接收统一请求对象，并按 Anthropic 或 OpenAI 兼容协议映射到各自的缓存机制。

```text
Ink UI
  |
  v
ChatManager（真实会话历史、可选会话指令）
  |
  v
AgentLoop（固定 system/tools、逐轮临时 reminder）
  |                    |
  |                    v
  |              Prompt 层
  |              |- 七个固定模块
  |              |- 环境采集
  |              `- 模式与可选模块注入
  v
StreamCollector
  |
  v
LLMProvider（统一 ProviderRequest）
  |                              |
  v                              v
Anthropic                     OpenAI / DeepSeek
显式 cache_control            稳定前缀自动缓存
  |                              |
  `------------ usage -----------'
                 |
                 v
        AgentEvent -> Ink UI
```

- **Prompt 层**：维护七个固定模块、模块优先级、稳定拼装、运行期环境采集、模式提醒节奏和可选模块格式化。
- **ChatManager**：只保存真实用户、助手和工具消息；接收调用方提供的自定义指令、已激活 Skill 和长期记忆，但不负责加载这些内容。
- **AgentLoop**：一次运行开始时固定 system prompt 和当前模式的工具定义；每轮模型请求前生成当前环境和模式 reminder，并追加到仅供发送的消息副本中。
- **StreamCollector**：接收完整 Provider 请求并沿用现有双路收集逻辑，不参与提示内容拼装。
- **Provider**：统一接收 system、messages 和 tools；Anthropic 使用顶层 system 和显式缓存断点，OpenAI/DeepSeek 使用首条 system 消息和自动缓存。
- **Tool 层**：保持工具名称、Schema 和注册顺序不变，只强化工具描述中的关键操作规则。
- **UI**：沿用现有 Agent 用量事件，增加缓存创建和缓存命中 Token 展示，并保留最近一次运行的最终统计以便人工验证。

### Spec 覆盖

| Spec | 架构归属 |
|---|---|
| F1 | Prompt sections + system builder |
| F2 | Environment collector + reminder builder + ChatManager 会话配置 |
| F3 | ProviderRequest + AgentLoop 稳定请求数据 + Provider 协议映射 |
| F4 | `instruction` 消息 + reminder builder + Provider 消息映射 |
| F5 | reminder builder + AgentLoop iteration |
| F6 | 固定“工具使用”模块 + 六个工具描述 |
| F7 | Provider usage parser + StreamEvent + AgentEvent + UI |
| F8 | Provider 请求测试 + Agent 集成测试 + 人工评估文档 |
| N1-N3 | Provider 兼容层 + 既有 Agent 数据流回归测试 |
| N4 | Prompt、Provider、Agent 单元与集成测试 |
| N5 | 固定系统约束 + reminder 边界转义 + 既有 ToolRegistry 权限边界 |
| N6 | 固定提示、文档和测试命名检查 |

## 核心数据结构

### 系统提示模块

```typescript
type SystemSectionId =
  | 'identity'
  | 'system_constraints'
  | 'task_mode'
  | 'action_execution'
  | 'tool_usage'
  | 'tone_style'
  | 'text_output';

interface PromptSection {
  id: SystemSectionId | string;
  priority: number;
  title: string;
  content: string;
}

const SYSTEM_PROMPT_SECTIONS: readonly PromptSection[];

function buildSystemPrompt(
  sections?: readonly PromptSection[],
): string;
```

七个固定模块分别使用 `700、600、500、400、300、200、100` 的优先级。`buildSystemPrompt()` 复制并按优先级降序排序，不修改调用方数组；每个模块格式化为标题和正文，模块间使用一个空行连接。相同输入必须生成字节级相同文本。

构建器拒绝重复 `id`、空标题、空内容和非有限优先级，避免未来插入模块时静默产生不稳定结果。默认调用只使用冻结的 `SYSTEM_PROMPT_SECTIONS`，不接收环境或会话内容。

### 环境与可选内容

```typescript
interface EnvironmentContext {
  projectRoot: string;
  currentDirectory: string;
  platform: string;
  shell: string;
  currentDate: string;
  timezone: string;
  mode: AgentMode;
}

interface ActivatedSkill {
  name: string;
  content: string;
}

interface SupplementalPromptContent {
  customInstructions?: string;
  activeSkills?: readonly ActivatedSkill[];
  longTermMemory?: string;
}

interface EnvironmentSource {
  cwd(): string;
  platform(): string;
  shell(): string;
  now(): Date;
  timezone(): string;
}

function collectEnvironment(
  projectRoot: string,
  mode: AgentMode,
  source?: EnvironmentSource,
): EnvironmentContext;
```

生产环境默认从 Node.js 进程与系统 API 读取当前目录、平台、Shell、时间和时区。`projectRoot` 使用 `ToolRegistry.rootDir` 的规范化绝对路径。`EnvironmentSource` 允许单元测试提供固定值，不作为用户配置接口。

`SupplementalPromptContent` 由调用方直接提供。空白字符串、空 Skill 名称和空 Skill 内容在构建时省略，不生成空模块；本阶段不读取文件、不发现 Skill、不维护记忆。

### 运行期补充消息

```typescript
interface ReminderInput {
  environment: EnvironmentContext;
  iteration: number;
  supplemental?: SupplementalPromptContent;
}

function isFullModeReminder(iteration: number): boolean;

function buildSystemReminder(input: ReminderInput): string;
```

`isFullModeReminder()` 对第 `1、6、11...` 轮返回 `true`，即 `(iteration - 1) % 5 === 0`。小于 1 或非整数的轮次直接报错。

完整 reminder 的内容顺序固定如下：

1. 环境信息
2. 当前任务模式完整说明或精简提醒
3. 自定义指令（可选）
4. 已激活的 Skill（可选）
5. 长期记忆（可选）

整体使用 `<system-reminder>` 和 `</system-reminder>` 包裹。外部可选内容中出现 reminder 边界标签时进行转义，防止内容提前闭合补充消息边界。模式完整说明在 Plan Mode 声明只读工具与计划输出要求，在 Act Mode 声明可以使用当前请求提供的完整工具集合；精简提醒只重申当前模式及最关键限制。

### Provider 请求与消息

```typescript
type Message =
  | { role: 'user'; content: string }
  | { role: 'instruction'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | {
      role: 'tool';
      toolCallId: string;
      toolName: string;
      content: string;
      isError: boolean;
    };

interface ProviderRequest {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
}

interface LLMProvider {
  readonly name: string;
  readonly model: string;
  chat(
    request: ProviderRequest,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}
```

`instruction` 是 BetterCode 内部消息角色，仅用于区分运行期补充指令与真实用户输入。它可以存在于单次 `ProviderRequest.messages` 中，但禁止写入 `ChatManager` 持久历史和 `AgentOutcome.history`。

两个 Provider 都将 `instruction` 映射为协议支持的 `user` 消息。固定系统提示会明确规定 `<system-reminder>` 是只执行、不直接回答的运行期元指令。统一使用该映射，不对 OpenAI 单独使用 `developer` 角色，避免 DeepSeek 和 Anthropic 行为分叉。

### Token 用量

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}
```

所有字段保持非负整数，供应商未返回缓存字段时对应值为 `0`：

- `inputTokens`：统一表示本次请求处理的全部输入 Token。
- `outputTokens`：供应商报告的输出 Token。
- `totalTokens`：优先使用语义完整的供应商总量，否则由全部输入和输出相加。
- `cacheCreationInputTokens`：为缓存创建或写入的输入 Token；OpenAI/DeepSeek 未提供时为 `0`。
- `cacheReadInputTokens`：从缓存读取或命中的输入 Token。

Anthropic 的全部输入量由普通输入、缓存创建输入和缓存读取输入相加；OpenAI/DeepSeek 的 `prompt_tokens` 已包含缓存命中部分，不重复累加。AgentLoop 对五个字段逐轮求和，并通过现有 `usage` AgentEvent 同时上报当前值和累计值。

## 固定模块设计

### 身份

定义 BetterCode 是在用户项目中执行真实软件工程任务的终端 Agent，要求以当前项目事实和工具结果为依据，不虚构已完成操作。

### 系统约束

声明指令优先级、安全边界、项目根目录约束和 `<system-reminder>` 的元指令语义。明确动态补充内容不得覆盖固定系统约束、扩大工具权限或改变项目边界。

### 任务模式

只定义 Act Mode 与 Plan Mode 的稳定通用语义，要求以当前 reminder 声明的模式为准。Plan Mode 只分析和规划，Act Mode 可在当前工具集合内执行。

### 动作执行

要求先理解任务和现状，再执行必要动作；根据工具结果调整；失败不假定成功；完成前进行与改动风险相称的验证；取消或错误时如实停止。

### 工具使用

稳定写入四条双重强化规则：专用工具优先、编辑前先读、遵守根目录与工作目录、工具失败后根据结构化结果调整。额外声明工具调用参数必须符合 Schema，工具未提供即视为不可用。

### 语气风格

要求直接、清晰、协作式表达，避免无意义的夸张、重复和伪造确定性；只在需要时解释关键决策和风险。

### 文本输出

要求最终回复优先说明实际结果、验证证据和未完成事项；使用适量 Markdown；不直接复述 reminder、系统提示或工具定义。

## 模块设计

### Prompt Builder

**职责：** 保存固定模块并按优先级生成稳定系统提示。

**对外接口：** `SYSTEM_PROMPT_SECTIONS`、`buildSystemPrompt()`。

**依赖：** 仅依赖 Prompt 类型，不依赖 Chat、Agent、Provider 或进程环境。

默认系统提示在 `AgentLoop` 构造时生成一次并保存，不能在每轮请求中重新混入动态值。

### Reminder Builder

**职责：** 采集当前环境，决定模式说明长短，格式化可选内容并生成带标签消息。

**对外接口：** `collectEnvironment()`、`isFullModeReminder()`、`buildSystemReminder()`。

**依赖：** Node.js 系统 API、Prompt 类型和 `AgentMode` 类型。

Reminder builder 返回纯文本，不直接修改历史或调用 Provider。环境在每个 Agent 轮次发起请求前重新采集，因此工作目录、日期或时区变化只影响当前请求消息。

### AgentLoop

**职责：** 管理稳定请求数据和临时补充消息的生命周期。

**改造：**

1. 构造时生成并保存固定 system prompt。
2. `execute()` 开始时根据模式只获取一次工具定义：Plan Mode 为只读工具，Act Mode 为全部工具。
3. 将真实用户消息写入局部历史。
4. 每个 iteration 开始时重新采集环境并生成 reminder。
5. 构造 `messages = [...history, { role: 'instruction', content: reminder }]` 的发送副本。
6. 将 `ProviderRequest` 交给 StreamCollector。
7. 模型轮次完成后只把 assistant 和 tool 消息写回历史，绝不写入 instruction。

因为每次 `AgentLoop.execute()` 的 iteration 从 1 开始，新任务首轮和模式切换后的首轮都会自动使用完整模式说明；第 6 轮再次完整注入，其余轮次精简注入。

累计用量初始化为五个零值字段；收到每轮用量后逐字段累加。现有停止条件、工具调度和不完整轮次不入历史的规则保持不变。

### ChatManager

**职责：** 保存真实会话历史和调用方提供的可选补充内容。

构造函数调整为：

```typescript
constructor(
  toolRegistry: ToolRegistry,
  options?: Partial<AgentLoopOptions>,
  supplemental?: SupplementalPromptContent,
);
```

删除把 `systemPrompt` 作为首条 `user` 消息加入历史的旧行为。第三个参数改为可选补充内容并传给 AgentLoop。`getHistory()`、`turnCount` 和 `clear()` 只观察或清理真实会话消息，不包含固定 system 和临时 instruction。

Plan Mode 的详细限制从 `buildPlanRequest()` 移入 reminder；普通计划请求只保留用户任务文本。`buildExecutePlanRequest()` 继续负责把最近计划转换为真实执行请求。

### StreamCollector

`collect()` 的前三个独立参数收敛为一个 `ProviderRequest`：

```typescript
collect(
  provider: LLMProvider,
  request: ProviderRequest,
  iteration: number,
  signal: AbortSignal,
  emit: (event: AgentEvent) => void,
): Promise<CollectedTurn>;
```

Collector 只透传请求并收集事件。文本、Thinking、工具调用、取消、流错误和 `done` 语义不变。

### Anthropic Provider

**请求映射：**

- `systemPrompt` 映射为顶层 `system` 文本内容块，并附加 `cache_control: { type: "ephemeral" }`。
- 工具按现有顺序映射；仅在最后一个工具定义上增加缓存断点，使完整工具前缀可缓存且不超过缓存断点数量限制。
- `instruction` 映射为 `user` 消息；现有 assistant/tool 映射保持不变。
- 没有工具时不发送 `tools`，但 system 缓存配置仍然保留。

**用量解析：**

从流事件 usage 中合并普通输入、缓存创建输入、缓存读取输入和输出。正常结束时只发出一个完整 `usage` 事件。缓存字段缺失按零处理；流错误和取消语义保持不变。

### OpenAI / DeepSeek Provider

**请求映射：**

- `systemPrompt` 映射为 `messages` 第一条稳定的 `system` 消息。
- `instruction` 映射为 `user` 消息并保留 `<system-reminder>` 标签。
- 工具定义、assistant tool calls 和 tool results 沿用现有映射。
- 不发送 Anthropic 专用缓存字段，依赖服务端对相同 system 和 tools 的自动缓存。

**用量解析：**

优先读取 OpenAI 兼容的缓存明细字段，并兼容 DeepSeek 的缓存命中字段别名。缓存命中量是 `prompt_tokens` 的子集，不重复计入 `inputTokens` 或 `totalTokens`。字段不存在或格式不完整时置零，不影响正常流结束。

### 工具描述

六个工具的 `name`、`inputSchema`、`effect` 和注册顺序保持不变，只扩充稳定 description：

| 工具 | 强化内容 |
|---|---|
| `read_file` | 读取文件必须优先于通用命令；编辑或覆盖现有文件前先读取当前内容 |
| `write_file` | 仅用于新建或完整覆盖；覆盖现有文件前先读取；不得用命令绕过目录约束 |
| `edit_file` | 调用前必须读取当前内容；只使用读取到的唯一原文；不得用命令替代修改 |
| `run_command` | 仅在没有专用工具时使用；文件读写、编辑、查找和搜索优先使用对应工具 |
| `find_files` | 查找文件优先使用本工具，不使用通用命令替代 |
| `search_code` | 搜索代码优先使用本工具，不使用通用命令替代 |

描述文本使用常量字符串，不能拼入根目录、模式或轮次等动态信息。

### UI 用量展示

Token 状态行增加“缓存创建”和“缓存命中”字段。每次新运行开始时清零，收到 `usage` AgentEvent 后显示累计值；运行结束后保留最后一次累计统计，直到下一次运行或 `/clear`，便于用户观察连续请求是否命中缓存。

`/clear` 同时清除 UI 中的最近用量展示，但不改变固定提示或工具定义。

### 人工评估文档

新增 `docs/system-prompt/manual-evaluation.md`，记录：

- 测试 Provider、模型、日期和前置条件。
- 连续相同稳定前缀请求的缓存创建/命中实际数据。
- 五类典型场景在改造前后的模型行为。
- 每个场景的提示、预期、实际表现和结论。
- 供应商未返回缓存字段或未达到缓存阈值时的实际说明。

该文档只承载人工执行步骤与真实结果，不提供自动评分代码。自动测试只验证请求结构和字段解析，不声称真实服务一定命中缓存。

## 模块交互

### 启动与稳定数据

```text
src/index.tsx
  -> createCoreToolRegistry(process.cwd())
  -> new ChatManager(registry)
       -> new AgentLoop(registry, options, supplemental)
            -> buildSystemPrompt()，仅构造一次
```

### 单轮请求

```text
用户任务
  -> ChatManager.start()
  -> AgentLoop.execute()
       -> history 加入真实 user 消息
       -> definitions(mode)，本次运行只计算一次
       -> iteration N
            -> collectEnvironment(rootDir, mode)
            -> buildSystemReminder(environment, N, supplemental)
            -> request = {
                 systemPrompt: 固定文本,
                 messages: history + 临时 instruction,
                 tools: 固定定义,
               }
            -> StreamCollector.collect(provider, request)
            -> Provider 协议映射与流式响应
            -> instruction 丢弃，不写回 history
            -> assistant/tool 写回 history，必要时继续
```

### 用量数据

```text
供应商 SSE usage
  -> Provider 归一化 TokenUsage
  -> StreamEvent.usage
  -> StreamCollector.CollectedTurn.usage
  -> AgentLoop 累加
  -> AgentEvent.usage
  -> Ink UI 展示当前运行累计值并在结束后保留
```

## 文件组织

```text
src/
├── prompt/
│   ├── types.ts                 — 固定模块、环境、Skill 和可选内容类型
│   ├── sections.ts              — 七个固定模块的稳定文本与优先级
│   ├── builder.ts               — 固定系统提示排序、校验和拼装
│   ├── builder.test.ts          — 顺序、分隔、稳定性和非法模块测试
│   ├── reminder.ts              — 环境采集、模式周期、标签与可选模块拼装
│   └── reminder.test.ts         — 环境、轮次、模块省略、顺序和边界转义测试
├── provider/
│   ├── types.ts                 — ProviderRequest、instruction、缓存用量字段
│   ├── anthropic.ts             — system/tools 显式缓存与缓存用量解析
│   ├── anthropic.test.ts        — 请求缓存断点、消息映射和 usage 测试
│   ├── openai.ts                — system 首消息、instruction 和缓存命中解析
│   └── openai.test.ts           — 稳定请求、DeepSeek/OpenAI 字段兼容测试
├── agent/
│   ├── types.ts                 — 补充内容在 Agent 请求中的类型引用
│   ├── prompts.ts               — 去除 Plan Mode 重复动态指令
│   ├── prompts.test.ts          — 计划任务和执行计划请求测试
│   ├── stream-collector.ts      — 改接 ProviderRequest
│   ├── stream-collector.test.ts — 请求透传与五字段 usage 测试
│   ├── loop.ts                  — 稳定数据、逐轮 reminder、用量累加
│   └── loop.test.ts             — 临时消息、周期、历史隔离和稳定性集成测试
├── chat/
│   ├── manager.ts               — 移除伪 user system prompt，传递可选内容
│   └── manager.test.ts          — 历史纯净、clear 和 Plan/Act 集成测试
├── tool/
│   ├── tools/*.ts               — 强化六个稳定工具描述
│   └── registry.test.ts         — 定义顺序与描述稳定性测试
└── ui/
    └── app.tsx                  — 展示并保留缓存用量

docs/system-prompt/
├── spec.md
├── plan.md
└── manual-evaluation.md         — 缓存验证和典型场景人工对比记录
```

## 测试设计

### Prompt 单元测试

- 固定七模块按 `700 -> 100` 排列，标题和正文之间格式固定，模块间只有一个空行。
- 打乱输入模块顺序仍生成相同结果，输入数组不被修改。
- 重复 ID、空标题、空内容和非法优先级产生明确错误。
- 环境六字段完整且可以通过固定 `EnvironmentSource` 复现。
- 第 `1、6、11` 轮为完整提醒，第 `2-5、7-10` 轮为精简提醒。
- Plan/Act 模式文本分别包含正确限制；非法轮次报错。
- 可选模块按顺序出现，空内容整体省略，标签边界无法被外部内容闭合。

### Provider 单元测试

- Anthropic 顶层 system 为带缓存控制的文本块，最后一个工具定义带缓存断点，顺序和 Schema 不变。
- Anthropic 无工具时仍发送可缓存 system 且省略 tools。
- OpenAI/DeepSeek 的第一条消息始终是稳定 system，instruction 映射为带标签 user 消息。
- 相同 system/tools、不同环境 instruction 的两次请求中，稳定部分深度相等。
- Anthropic 正确累加普通输入、缓存创建、缓存读取和输出。
- OpenAI 正确解析 `prompt_tokens_details.cached_tokens`。
- DeepSeek 字段别名正确映射为缓存命中；不存在缓存字段时为零。
- 原有文本、Thinking、工具调用碎片、错误和取消测试全部保留。

### Agent 与 Chat 集成测试

- 一次多轮 Agent 运行中 system 和 tools 始终相同，instruction 随 iteration 按周期变化。
- 每次 Provider 请求末尾都有且仅有一条临时 instruction。
- `AgentOutcome.history` 和 `ChatManager.getHistory()` 不包含 instruction 或 system。
- Plan Mode 每轮只发送三个只读工具；Act Mode 每轮发送完整六工具。
- 五字段 Token 用量逐轮正确累计并通过 AgentEvent 上报。
- stream error、cancel、max iterations 和未知工具停止路径仍保持完整协议历史。
- `clear()` 清理真实历史和最近计划，不需要清理 Provider 或 Prompt 全局状态。

### 回归检查

- `pnpm typecheck` 验证统一 Provider 接口改造覆盖所有 Fake Provider 和调用方。
- `pnpm test` 验证原有 Config、Tool、Provider、Agent 和 Chat 行为。
- `pnpm check` 作为最终自动化门禁。
- 新增代码注释全部使用中文，遵守根目录 `AGENTS.md`。

## 技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| Prompt 分层 | 固定 system 与临时 instruction 分离 | 固定前缀可缓存，动态信息不污染持久历史 |
| 固定模块扩展 | 带优先级的不可变 section 数组 | 顺序显式、可测试，未来可以插入模块 |
| Provider 入参 | `ProviderRequest` 请求对象 | system/messages/tools 边界清晰，避免继续增加位置参数 |
| 补充消息内部角色 | `instruction` | 在 BetterCode 内与真实 user 明确区分，防止 UI 和历史误处理 |
| 线路角色 | 所有 Provider 映射为 `user` | Anthropic 无消息级 system，统一映射可减少协议行为差异 |
| 标签 | `<system-reminder>` | 与固定提示中的元指令规则配合，模型可识别且不改动顶层 system |
| 模式重复周期 | 第 1 轮完整，此后每 5 轮完整 | 遵循已确认节奏，在可靠性和 Token 成本间平衡 |
| Plan 工具缓存 | 每次运行固定只读子集 | 保持上一章“只放开读类工具”的安全语义；模式切换允许形成不同缓存前缀 |
| Anthropic 缓存断点 | system 块 + 最后一个工具定义 | 显式覆盖稳定内容，同时避免给每个工具增加断点 |
| OpenAI/DeepSeek 缓存 | 稳定 system 首消息和 tools，不发私有字段 | 使用兼容协议的自动缓存，避免依赖非通用请求参数 |
| 缓存统计默认值 | 缺失字段归零 | 累计和 UI 展示简单，且不会把普通输入误报为缓存命中 |
| Anthropic 输入归一化 | 普通 + 创建 + 读取 | 与 OpenAI `prompt_tokens` 的“全部输入”语义对齐 |
| 动态内容安全 | 固定约束声明优先级并转义 reminder 边界 | 防止可选内容伪造标签边界或扩大权限 |
| 人工评估 | 独立 Markdown 记录真实结果 | 满足定性比较，不引入本阶段明确排除的自动评分系统 |

## 风险与处理

| 风险 | 处理 |
|---|---|
| Anthropic 对相邻 user 消息进行合并 | 保留 reminder 标签；工具结果仍先于 reminder，Provider 测试验证内容顺序 |
| OpenAI 兼容服务缓存字段名称不同 | 同时解析标准明细和 DeepSeek 字段别名，缺失时归零 |
| 提示长度未达到供应商缓存阈值 | 人工评估如实记录未命中，不把“请求可缓存”等同于“必然命中” |
| 动态内容包含 reminder 结束标签 | 在 builder 中转义边界标签并覆盖测试 |
| Plan Mode 工具子集导致模式切换时缓存前缀变化 | 接受按模式形成两个稳定工具前缀，不牺牲只读安全边界 |
| 使用 user 线路角色后模型直接复述 reminder | 固定 system 明确只执行不回复，并用人工场景验证 |
| Provider 接口改造影响所有 Fake Provider | 一次性迁移类型、实现和测试，使用 `pnpm typecheck` 检查遗漏 |

## 实施边界

本计划不增加配置项，不扫描项目指令文件，不加载 Skill，不持久化记忆，不接入 MCP，不实现自动评分，也不更改现有工具权限、Agent 停止条件或调度策略。人工评估可以使用当前已配置的 DeepSeek Provider；没有可用真实服务时必须记录未执行原因，不能以模拟测试冒充真实缓存命中。
