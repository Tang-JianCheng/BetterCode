# MewCode Agent Loop Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|---|---|---|
| 新建 | `src/agent/types.ts` | Agent 模式、事件、进度、停止原因、请求与结果类型 |
| 新建 | `src/agent/event-stream.ts` | 将异步回调生产者适配为 `AsyncIterable` |
| 新建 | `src/agent/event-stream.test.ts` | 事件顺序、缓存、关闭和异常测试 |
| 新建 | `src/agent/stream-collector.ts` | 实时转发 Provider 事件并收集完整轮次 |
| 新建 | `src/agent/stream-collector.test.ts` | 双路收集、错误、提前结束和取消测试 |
| 新建 | `src/agent/tool-scheduler.ts` | 工具可用性判断、未知计数和安全调度 |
| 新建 | `src/agent/tool-scheduler.test.ts` | 只读并发、副作用串行、阈值和取消测试 |
| 新建 | `src/agent/prompts.ts` | Plan Mode 与 `/do` 执行提示构造 |
| 新建 | `src/agent/prompts.test.ts` | 计划和执行提示内容测试 |
| 新建 | `src/agent/loop.ts` | ReAct 循环、历史回灌、用量累计和停止条件 |
| 新建 | `src/agent/loop.test.ts` | 多轮循环、事件及全部停止原因测试 |
| 修改 | `src/provider/types.ts` | 增加统一 Token 用量事件 |
| 修改 | `src/provider/openai.ts` | OpenAI 用量解析、严格结束和取消语义 |
| 修改 | `src/provider/openai.test.ts` | OpenAI 用量、多个调用、流错误和取消测试 |
| 修改 | `src/provider/anthropic.ts` | Anthropic 用量解析、严格结束和取消语义 |
| 修改 | `src/provider/anthropic.test.ts` | Anthropic 用量、多个调用、流错误和取消测试 |
| 修改 | `src/tool/types.ts` | 增加 `ToolEffect`、工具 effect 和取消类错误码 |
| 修改 | `src/tool/registry.ts` | effect 查询、定义过滤和外部取消信号 |
| 修改 | `src/tool/registry.test.ts` | 安全分类、过滤、外部取消与超时区分测试 |
| 修改 | `src/tool/tools/read-file.ts` | 声明只读 effect |
| 修改 | `src/tool/tools/find-files.ts` | 声明只读 effect |
| 修改 | `src/tool/tools/search-code.ts` | 声明只读 effect |
| 修改 | `src/tool/tools/write-file.ts` | 声明副作用 effect |
| 修改 | `src/tool/tools/edit-file.ts` | 声明副作用 effect |
| 修改 | `src/tool/tools/run-command.ts` | 声明副作用 effect 并区分外部取消 |
| 修改 | `src/chat/manager.ts` | 会话门面、异步运行、最近计划和 `/do` |
| 修改 | `src/chat/manager.test.ts` | 会话历史、Plan Mode、`/do`、清空和互斥测试 |
| 修改 | `src/ui/app.tsx` | Agent 事件消费、命令、进度、用量和取消 |
| 修改 | `src/ui/input-box.tsx` | 忽略控制字符，配合 Ctrl+C 双重行为 |
| 检查 | `src/index.tsx` | 确认启动装配与新 ChatManager 接口一致 |

## T1：扩展 Provider 用量契约

**文件：** `src/provider/types.ts`

**依赖：** 无

**步骤：**

1. 定义 `TokenUsage`，包含输入、输出和总 Token 数。
2. 在 `StreamEvent` 中增加 `usage` 分支，使用完整请求快照语义。
3. 保持 `LLMProvider.chat()` 参数和回调形式不变。

**验证：** 运行 `pnpm typecheck`，期望现有 Provider 和测试在新增可选事件分支后仍编译通过。

## T2：定义 Agent 公共类型

**文件：** `src/agent/types.ts`

**依赖：** T1

**步骤：**

1. 定义 `AgentMode`、`AgentStopReason` 和 `AgentProgressStage`。
2. 按 plan.md 定义 `AgentEvent` 联合类型，覆盖文本、Thinking、工具、用量、进度、错误和停止。
3. 定义 `AgentLoopOptions`、`AgentLoopRequest`、`AgentOutcome`、`SavedPlan` 和 `AgentRunOptions`。
4. 所有 Provider、Message、ToolCall、ToolResult 类型从现有模块导入，不复制协议结构。

**验证：** 运行 `pnpm typecheck`，期望新增类型文件无循环依赖或类型错误。

## T3：为六个工具声明安全级别

**文件：** `src/tool/types.ts`、`src/tool/tools/read-file.ts`、`src/tool/tools/find-files.ts`、`src/tool/tools/search-code.ts`、`src/tool/tools/write-file.ts`、`src/tool/tools/edit-file.ts`、`src/tool/tools/run-command.ts`、`src/tool/registry.test.ts`

**依赖：** 无

**步骤：**

1. 在工具契约中增加 `ToolEffect = 'read_only' | 'side_effect'` 和必填 `effect` 元数据。
2. 为读取、查找和搜索工具声明 `read_only`。
3. 为写入、编辑和命令工具声明 `side_effect`。
4. 为 `ToolErrorCode` 增加 `TOOL_UNAVAILABLE` 和 `CANCELLED`。
5. 更新 Registry 测试中的 Fake Tool 工厂，使其显式声明 effect。

**验证：** 运行 `pnpm typecheck`，期望全部 Tool 实现满足扩展后的统一接口。

## T4：增加 Registry 安全查询与定义过滤

**文件：** `src/tool/registry.ts`、`src/tool/registry.test.ts`

**依赖：** T3

**步骤：**

1. 实现 `effectOf(name)`，未知名称返回 `undefined`。
2. 扩展 `definitions(effect?)`，无参数返回全部定义，传入 effect 时只返回匹配工具。
3. 确认返回给 Provider 的 `ToolDefinition` 不包含本地 effect 字段。
4. 添加六工具分类、过滤结果和稳定注册顺序测试。

**验证：** 运行 `pnpm exec tsx --test src/tool/registry.test.ts`，期望分类与原有注册、校验测试全部通过。

## T5：让 Registry 支持外部取消

**文件：** `src/tool/registry.ts`、`src/tool/registry.test.ts`、`src/tool/tools/run-command.ts`

**依赖：** T3、T4

**步骤：**

1. 为 `execute(call, signal?)` 增加可选外部 `AbortSignal`。
2. 将外部 signal 与 Registry 内部超时 signal 合并后传入 `ToolContext`。
3. 外部 signal 先触发时返回 `CANCELLED`，内部计时器先触发时仍返回 `TIMEOUT`。
4. 确保监听器和计时器在成功、失败、超时和取消后都被清理。
5. 调整命令工具的终止元数据，使外部取消不再被标记为命令超时。
6. 添加外部取消、内部超时和取消后迟到结果不覆盖的测试。

**验证：** 运行 `pnpm exec tsx --test src/tool/registry.test.ts src/tool/tools.test.ts`，期望取消与现有工具行为全部通过。

## T6：实现异步事件队列

**文件：** `src/agent/event-stream.ts`、`src/agent/event-stream.test.ts`

**依赖：** 无

**步骤：**

1. 实现 `createEventStream<T>()`，允许生产者同步或异步调用 `emit`。
2. 支持消费者尚未等待时缓存事件，以及消费者等待时直接唤醒。
3. 生产者完成后关闭迭代器，保证事件不丢失且顺序不变。
4. 生产者异常时关闭流并把异常交给调用方约定的外层处理，避免未处理 Promise。
5. 测试先生产后消费、边生产边消费、空流、正常关闭和异常关闭。

**验证：** 运行 `pnpm exec tsx --test src/agent/event-stream.test.ts`，期望全部队列场景通过且测试进程正常退出。

## T7：实现 StreamCollector 的双路收集

**文件：** `src/agent/stream-collector.ts`、`src/agent/stream-collector.test.ts`

**依赖：** T1、T2

**步骤：**

1. 实现 `StreamCollector.collect()` 并初始化完整正文、Thinking、调用列表和用量快照。
2. 收到文本、Thinking 和工具调用时立即发出对应 `AgentEvent`，同时写入完整结果。
3. 收到 usage 时保存最后一份请求用量快照。
4. 只有收到正常 done 时返回 `completed`。
5. 使用 Fake Provider 验证碎片实时顺序和最终完整内容完全一致。

**验证：** 运行 `pnpm exec tsx --test src/agent/stream-collector.test.ts`，期望双路文本、Thinking、多个调用和用量测试通过。

## T8：补齐 StreamCollector 错误与取消语义

**文件：** `src/agent/stream-collector.ts`、`src/agent/stream-collector.test.ts`

**依赖：** T7

**步骤：**

1. Provider error 事件返回 `stream_error` 并保留首个错误说明。
2. Provider 抛异常或 Promise 在无 done 时结束，归一化为明确流错误。
3. signal 取消优先返回 `cancelled`，不误报“缺少 done”。
4. 确认流错误或取消时已聚合的工具调用不会被标记为可执行完整轮次。
5. 添加显式 error、抛异常、提前结束和取消测试。

**验证：** 运行 `pnpm exec tsx --test src/agent/stream-collector.test.ts`，期望所有异常路径返回确定状态且不抛到测试进程。

## T9：实现工具可用性与未知计数

**文件：** `src/agent/tool-scheduler.ts`、`src/agent/tool-scheduler.test.ts`

**依赖：** T2、T4、T5

**步骤：**

1. 定义 `ScheduledToolResult`、`ToolBatchResult` 和 `ToolScheduleOptions`。
2. 按模型顺序区分允许工具、未知工具和 Plan Mode 不可用工具。
3. 未知工具返回 `TOOL_NOT_FOUND`，模式限制返回 `TOOL_UNAVAILABLE`。
4. 允许工具重置连续未知计数；不可用调用增加计数。
5. 第三个连续不可用调用触发阈值，后续调用生成 `CANCELLED` 且不执行。
6. 测试跨批次计数、允许工具重置、Plan Mode 限制和阈值后跳过。

**验证：** 运行 `pnpm exec tsx --test src/agent/tool-scheduler.test.ts`，期望未知计数和每调用一结果规则通过。

## T10：实现只读并发与副作用串行

**文件：** `src/agent/tool-scheduler.ts`、`src/agent/tool-scheduler.test.ts`

**依赖：** T9

**步骤：**

1. 将阈值前允许的调用按 Registry effect 分为两个集合。
2. 使用 `Promise.all` 同时执行只读集合，并记录每个调用的开始与完成。
3. 只读集合全部完成后，按原始相对顺序逐个执行副作用集合。
4. 缓存实际完成结果，最终按原始调用索引排序并发出 tool result。
5. 添加可控屏障 Fake Tool，证明只读重叠执行、副作用不重叠、混合批次先读后写。

**验证：** 运行 `pnpm exec tsx --test src/agent/tool-scheduler.test.ts`，期望并发、串行、混合顺序和结果顺序断言全部通过。

## T11：实现调度期间取消

**文件：** `src/agent/tool-scheduler.ts`、`src/agent/tool-scheduler.test.ts`

**依赖：** T10

**步骤：**

1. 每个工具开始前检查外部 signal，并把 signal 传给 Registry。
2. 取消后不再启动新的副作用工具。
3. 为未开始或未完成调用生成 `CANCELLED`，保留取消前已完成结果。
4. 忽略取消后到达的迟到结果，不让它覆盖取消状态或启动下一项。
5. 添加只读并发期间取消和副作用序列中途取消测试。

**验证：** 运行 `pnpm exec tsx --test src/agent/tool-scheduler.test.ts`，期望取消后执行计数不再增长且结果顺序完整。

## T12：增加 OpenAI 用量与正常结束解析

**文件：** `src/provider/openai.ts`、`src/provider/openai.test.ts`

**依赖：** T1

**步骤：**

1. 在请求体中启用流式用量回传。
2. 扩展 chunk 类型并解析 `prompt_tokens`、`completion_tokens` 和 `total_tokens`。
3. 缓存用量，在 `[DONE]` 前发出一次 usage，再发出唯一 done。
4. 保持多个工具调用按 index 聚合和原始顺序发出。
5. 更新现有测试流，使所有正常案例包含 `[DONE]`。
6. 添加文本、两个工具调用和 usage 同时存在的测试。

**验证：** 运行 `pnpm exec tsx --test src/provider/openai.test.ts`，期望请求映射、多个调用、用量和唯一 done 测试通过。

## T13：严格处理 OpenAI 流错误与取消

**文件：** `src/provider/openai.ts`、`src/provider/openai.test.ts`

**依赖：** T12

**步骤：**

1. 非法 `data:` JSON、非法工具参数、读取异常和缺少 `[DONE]` 时发出 error，不发 done。
2. 网络和 HTTP 错误保持明确错误内容并终止当前流。
3. AbortError 不发 error 或 done，由上层 signal 判定取消。
4. 确保 error 后不再发出未确认完整的工具调用。
5. 添加每种错误、提前结束和 AbortController 测试。

**验证：** 运行 `pnpm exec tsx --test src/provider/openai.test.ts`，期望正常与错误流可以被明确区分。

## T14：增加 Anthropic 用量与正常结束解析

**文件：** `src/provider/anthropic.ts`、`src/provider/anthropic.test.ts`

**依赖：** T1

**步骤：**

1. 扩展事件类型，读取 `message_start.message.usage` 的输入 Token。
2. 读取 `message_delta.usage` 的最终输出 Token，并计算总量。
3. 在 `message_stop` 前发出一次合并 usage，再发出唯一 done。
4. 保持多个 content block 工具调用按索引聚合和原始顺序发出。
5. 添加正文、Thinking、两个工具调用和 usage 的组合测试。

**验证：** 运行 `pnpm exec tsx --test src/provider/anthropic.test.ts`，期望消息映射、Thinking、多个调用、用量和 done 测试通过。

## T15：严格处理 Anthropic 流错误与取消

**文件：** `src/provider/anthropic.ts`、`src/provider/anthropic.test.ts`

**依赖：** T14

**步骤：**

1. 非法 `data:` JSON、非法 partial JSON、协议 error、读取异常和缺少 `message_stop` 时发出 error。
2. 错误发生后不再发 done，也不补发未完成工具调用。
3. AbortError 不发 error 或 done，由上层判定取消。
4. 添加每种错误、流提前结束和 AbortController 测试。

**验证：** 运行 `pnpm exec tsx --test src/provider/anthropic.test.ts`，期望全部异常路径与 OpenAI 使用一致的上层语义。

## T16：实现 Plan 与执行提示

**文件：** `src/agent/prompts.ts`、`src/agent/prompts.test.ts`

**依赖：** T2

**步骤：**

1. 实现 `buildPlanRequest(task)`，明确只分析项目、不得修改并输出可执行计划。
2. 实现 `buildExecutePlanRequest(plan)`，包含最近计划的原任务和完整计划文本。
3. 不把工具名称硬编码为安全边界，安全仍由 definitions 与 Scheduler 保证。
4. 测试任务与计划原文完整保留，两个提示的模式意图清晰且互不混淆。

**验证：** 运行 `pnpm exec tsx --test src/agent/prompts.test.ts`，期望不同输入均生成稳定且完整的提示。

## T17：实现 AgentLoop 基础 ReAct 循环

**文件：** `src/agent/loop.ts`、`src/agent/loop.test.ts`

**依赖：** T2、T8、T10

**步骤：**

1. 构造 AgentLoop 默认配置：10 轮、连续未知工具 3 次。
2. 在历史副本中追加本次 user message，每轮发出 requesting_model 进度。
3. 调用 StreamCollector；无工具时追加 assistant 并正常完成。
4. 有工具时调用 ToolScheduler，追加一条带全部 calls 的 assistant 和逐个 tool message。
5. 工具结果回灌后自动进入下一模型轮，不再使用原单工具二次请求限制。
6. 汇总本次运行各完整模型轮的文本作为 finalText。
7. 添加纯文本一轮结束和“工具、结果、下一轮文本”基础测试。

**验证：** 运行 `pnpm exec tsx --test src/agent/loop.test.ts`，期望用户只输入一次即可完成 Fake Provider 多轮脚本。

## T18：补齐 Agent 事件与 Token 累计

**文件：** `src/agent/loop.ts`、`src/agent/loop.test.ts`

**依赖：** T17

**步骤：**

1. 在模型完成、工具开始和工具完成阶段发出完整 progress。
2. 将 Collector 的每轮 usage 累加，发出 current 与 cumulative usage。
3. 按原始顺序发出 tool result，保留调用 ID 和轮次。
4. 确保每次运行只发一个 stopped，且 completed 包含最终文本和实际轮数。
5. 添加两轮用量、多个工具事件顺序和无 usage Provider 测试。

**验证：** 运行 `pnpm exec tsx --test src/agent/loop.test.ts`，期望事件序列、轮次、调用关联和累计 Token 全部准确。

## T19：实现上限、未知工具与流错误停止

**文件：** `src/agent/loop.ts`、`src/agent/loop.test.ts`

**依赖：** T18

**步骤：**

1. 第 10 轮仍有工具时执行并回灌该批次，然后以 max_iterations 停止。
2. ToolScheduler 报告连续未知阈值后采用当前完整历史，以 unknown_tool_limit 停止。
3. Collector 返回 stream_error 时不写入当前不完整 assistant 或执行工具，发出 error 后停止。
4. 确认三种路径都不再发起下一模型请求，并各自产生唯一 stopped。
5. 添加恰好 10 次 Provider 调用、连续未知重置/停止和三类流错误测试。

**验证：** 运行 `pnpm exec tsx --test src/agent/loop.test.ts`，期望所有停止原因和调用次数精确匹配。

## T20：实现 Agent Loop 取消停止

**文件：** `src/agent/loop.ts`、`src/agent/loop.test.ts`

**依赖：** T11、T19

**步骤：**

1. 每轮模型请求前和工具批次后检查 signal。
2. Collector 取消时不写入不完整模型轮，并以 cancelled 停止。
3. Scheduler 取消时保存已完成响应及一一对应的完成/取消工具结果，不启动下一轮。
4. 确保取消优先于缺少 done、最大轮次或迟到工具结果。
5. 添加模型流期间取消、只读工具期间取消和副作用序列期间取消测试。

**验证：** 运行 `pnpm exec tsx --test src/agent/loop.test.ts`，期望取消后 Provider 与工具执行计数停止增长，历史仍是合法消息序列。

## T21：将 ChatManager 改为异步会话门面

**文件：** `src/chat/manager.ts`、`src/chat/manager.test.ts`

**依赖：** T6、T17、T20

**步骤：**

1. 移除现有单工具 `send()` 和两次请求限制常量。
2. 创建 AgentLoop，并实现返回 `AsyncIterable<AgentEvent>` 的 `run()`。
3. 通过事件队列启动 producer，将 AgentOutcome.history 在每种停止原因后写回会话。
4. 增加活动运行互斥，并在 producer 的 finally 中可靠释放。
5. 保留 `getHistory()`、`clear()` 和 turnCount 的兼容行为。
6. 更新基础测试，验证纯聊天、多轮工具和取消后的会话历史。

**验证：** 运行 `pnpm exec tsx --test src/chat/manager.test.ts`，期望事件可异步消费且历史不会交错或丢失完整轮次。

## T22：实现 Plan Mode 与最近计划状态

**文件：** `src/chat/manager.ts`、`src/chat/manager.test.ts`

**依赖：** T16、T21

**步骤：**

1. `run(..., { mode: 'plan' })` 使用计划提示并让 AgentLoop 进入 plan 模式。
2. 仅在 completed 且 finalText 非空时保存 `SavedPlan`。
3. 取消、流错误、未知上限和最大轮次不覆盖此前成功计划。
4. 实现 `getLatestPlan()`，返回只读副本。
5. `clear()` 同时清除历史和最近计划。
6. 测试成功计划、空计划、失败计划保留旧值、多个计划取最近和 clear。

**验证：** 运行 `pnpm exec tsx --test src/chat/manager.test.ts`，期望计划状态只在批准的成功条件下变化。

## T23：实现 `/do` 的会话级执行入口

**文件：** `src/chat/manager.ts`、`src/chat/manager.test.ts`

**依赖：** T22

**步骤：**

1. 定义可识别的 `NoPlanError`。
2. 实现 `executeLatestPlan(provider, signal?)`，无计划时同步拒绝且不启动 producer。
3. 有计划时使用执行提示，把原任务和完整计划作为 act 模式的新 user message。
4. 验证 `/do` 延续当前历史并向 Provider 开放全部六个工具。
5. 测试无计划零 Provider/工具调用、最近计划选择、计划内容传递和完整执行。

**验证：** 运行 `pnpm exec tsx --test src/chat/manager.test.ts`，期望 `/do` 无需任务参数并只执行最近成功计划。

## T24：让 TUI 消费 Agent 异步事件

**文件：** `src/ui/app.tsx`

**依赖：** T21

**步骤：**

1. 用 `chatManager.run()` 和 `for await...of` 替换回调式 `send()` 调用。
2. 正文、Thinking 分别使用 ref 和 state 累积，支持跨多轮持续显示。
3. tool call/result 不新增永久时间线，只更新当前运行状态。
4. 收到唯一 stopped 后将本次 finalText 与 Thinking 固化为一条 assistant 展示消息并恢复输入。
5. Agent error 只显示一次，普通 ToolResult 失败不提前结束 UI 流。

**验证：** 运行 `pnpm typecheck`，期望 App 不再引用旧 `send()` 回调接口，所有 AgentEvent 分支穷尽处理。

## T25：接入 `/plan`、`/do` 与帮助文本

**文件：** `src/ui/app.tsx`

**依赖：** T23、T24

**步骤：**

1. 解析 `/plan <任务>`，保留原始命令作为展示消息，并以 plan 模式运行任务。
2. `/plan` 缺少任务时直接显示格式提示，不调用 ChatManager。
3. 解析精确 `/do` 并调用 `executeLatestPlan()`。
4. 捕获 `NoPlanError`，显示“没有可执行计划”，不进入 streaming 状态。
5. 更新 `/help`，包含 `/plan`、`/do` 和运行中 Ctrl+C 取消说明。
6. 保持 `/clear`、`/exit`、`/quit` 原行为；clear 后 UI 与 ChatManager 同时清空。

**验证：** 运行 `pnpm typecheck`，再启动 Fake/可用 Provider 环境检查 `/help` 文本与命令分支无运行时异常。

## T26：接入进度、用量与 Ctrl+C 取消

**文件：** `src/ui/app.tsx`、`src/ui/input-box.tsx`

**依赖：** T24、T25

**步骤：**

1. 每次 Agent 运行创建并保存 `AbortController`，结束后清理引用。
2. progress 事件更新“当前轮/最大轮、当前阶段、工具名”的固定状态行。
3. usage 事件更新累计输入、输出和总 Token 显示；无 usage 时不显示数字。
4. App 级键盘监听在运行中把 Ctrl+C 映射为 abort，空闲时仍退出应用。
5. InputBox 忽略 Ctrl 组合和其他控制字符，避免它们进入输入文本。
6. 取消后等待 stopped(cancelled) 再恢复输入，避免旧运行与新输入交错。

**验证：** 运行 `pnpm typecheck`，并在 TUI 中启动一个慢请求后按 Ctrl+C，期望只取消当前运行、输入框恢复，再次按 Ctrl+C 才退出。

## T27：完成全量回归与启动装配检查

**文件：** `src/index.tsx`、本任务涉及的全部源码与测试

**依赖：** T1-T26

**步骤：**

1. 检查 `src/index.tsx` 仍以 `process.cwd()` 创建 Registry，并按新构造签名创建 ChatManager；仅在需要时调整参数顺序。
2. 运行格式与差异检查，移除旧单工具限制文案和无调用方代码。
3. 运行完整类型检查和全部测试。
4. 对失败项定位修复并重跑，不能通过删除断言规避行为要求。
5. 在 macOS 启动 TUI，验证纯聊天、Plan Mode、`/do`、多轮工具、进度和取消的主路径。
6. 记录 Linux 未实际执行时的剩余平台风险，不宣称未运行的验证已经通过。

**验证：** 运行 `pnpm check`，期望类型检查通过且全部测试为零失败；运行 `pnpm start`，期望 TUI 正常启动并可完成手工主路径。

## 执行顺序

```text
T1 -> T2 -------------------------------> T7 -> T8 -----------┐
                                                              |
T3 -> T4 -> T5 -> T9 -> T10 -> T11 --------------------------+-> T17 -> T18 -> T19 -> T20
                                                              |                         |
T1 -> T12 -> T13                                              |                         v
T1 -> T14 -> T15 ---------------------------------------------┘                    T21 -> T22 -> T23
                                                                                         |       |
T2 -> T16 -------------------------------------------------------------------------------┘       |
                                                                                                 v
T6 -------------------------------------------------------------------------------------------> T24 -> T25 -> T26
                                                                                                            |
                                                                                                            v
                                                                                                           T27
```

可并行组：

- T1-T2、T3-T5、T6 可在各自依赖满足后独立推进。
- OpenAI 的 T12-T13 与 Anthropic 的 T14-T15 可并行。
- T16 可在 T2 后独立完成。
- Agent 核心、Provider 和提示模块汇合后再改 ChatManager 与 UI。

## 自检结果

- plan.md 中的 Agent、Collector、Scheduler、Provider、Registry、ChatManager、Plan prompts 和 UI 均有对应任务。
- 27 个任务都有具体文件、依赖、操作步骤和可运行验证。
- 依赖链无环；Provider 双协议工作可以并行，UI 在核心接口稳定后才开始。
- 类型名、方法签名、默认 10 轮和连续未知 3 次与 plan.md 一致。
- 未包含权限、上下文压缩、交互式确认、持久化或新增工具任务。
