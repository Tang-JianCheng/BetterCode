# MewCode Agent Loop Checklist

> 每一项都通过运行代码、测试或观察终端行为验证。自动化测试不得访问真实 LLM API；涉及真实 TUI 的条目单独标记。

## 实现完整性

- [ ] Agent 对外提供统一异步事件流，事件覆盖正文、Thinking、工具调用、工具结果、Token 用量、进度、错误和停止。（验证：运行 `pnpm typecheck`，检查事件联合类型被 Agent 与 UI 的真实调用方使用）
- [ ] Agent 核心与 Ink/React 解耦。（验证：运行 `rg -n "from ['\"](?:ink|react)['\"]" src/agent`，期望无匹配）
- [ ] StreamCollector 同时支持实时事件转发和完整轮次收集。（验证：运行 `pnpm exec tsx --test src/agent/stream-collector.test.ts`）
- [ ] 六个核心工具均声明且只声明一个安全级别。（验证：运行 Tool Registry 测试，期望三个 `read_only` 和三个 `side_effect`）
- [ ] ChatManager 保存会话历史与最近成功计划，并通过 Agent Loop 执行任务。（验证：运行 `pnpm exec tsx --test src/chat/manager.test.ts`）
- [ ] OpenAI 与 Anthropic Provider 都能报告统一 Token 用量并区分正常结束、取消和流错误。（验证：分别运行两个 Provider 测试文件）
- [ ] 旧的单工具限制逻辑已移除，没有残留“只执行一次工具”的运行分支。（验证：运行 `rg -n "MULTI_TOOL_LIMIT|SECOND_TOOL_LIMIT|一次只支持一个工具|不会继续执行下一次工具" src`，期望无匹配）

## Agent Loop

- [ ] 普通任务可以在一次用户输入后自动完成“模型请求 -> 工具 -> 结果回灌 -> 下一轮”循环。（验证：Fake Provider 依次请求读取、修改、再次读取和最终回答，断言无需第二次用户输入；覆盖 AC1）
- [ ] 最终回答基于真实工具结果，模型历史包含每轮 assistant tool calls 和一一对应的 tool messages。（验证：检查多轮 Agent 测试中的文件结果和 Message 角色/调用 ID；覆盖 AC1、AC19）
- [ ] 首轮没有工具调用时只请求模型一次、不执行工具，并正常结束。（验证：运行纯文本 Agent 测试，断言 Provider 调用数为 1；覆盖 AC2）
- [ ] 每个完整模型轮次的文本按顺序进入本次 `finalText`，协议历史仍保留独立 assistant 消息。（验证：运行多轮文本拼接与历史断言；覆盖 AC1、AC3）
- [ ] 普通工具参数错误、路径错误、执行失败和超时会回灌给模型，Agent 可在下一轮修正后完成。（验证：Fake Tool 首次失败、第二次成功，断言停止原因为 `completed`；覆盖 AC9）
- [ ] 单次运行结束后可以立即开始下一次运行，不残留活动锁或取消状态。（验证：同一个 ChatManager 连续执行两个 Fake Provider 请求，均正常完成；覆盖 AC11、AC13）

## 双路事件流

- [ ] 正文片段在 Provider 流尚未结束时已到达事件消费者，完整正文等于全部片段拼接。（验证：使用可控 Provider 屏障运行 Collector 测试；覆盖 AC3）
- [ ] Thinking 片段实时到达，完整 Thinking 与片段拼接一致。（验证：运行 Collector Thinking 测试；覆盖 AC3）
- [ ] 多个工具参数经过碎片聚合后，每个调用只产生一次完整 tool call 事件。（验证：运行 Collector 与双 Provider 多调用测试；覆盖 AC3、AC19）
- [ ] 一次两轮工具任务的事件包含进度、正文或 Thinking、工具调用、工具结果、用量和唯一 stopped。（验证：记录 AgentEvent 数组并逐项断言；覆盖 AC4）
- [ ] 每个事件携带正确轮次；工具事件携带正确调用 ID。（验证：运行事件关联测试；覆盖 AC4）
- [ ] 每轮至少产生请求模型、模型完成、工具开始和工具完成的适用进度阶段。（验证：运行进度序列测试；覆盖 AC4）
- [ ] 并发工具实际完成顺序不影响 tool result 事件与历史的模型原始顺序。（验证：让后一个只读工具先完成，断言对外顺序不变；覆盖 AC6、AC8）

## Token 用量

- [ ] 两轮分别报告用量时，每轮 current 值准确，cumulative 为逐轮求和。（验证：Fake Provider 返回固定用量，断言 usage 事件；覆盖 AC5）
- [ ] Provider 不报告用量时，Agent 不生成虚假数字且任务正常完成。（验证：运行无 usage Fake Provider 测试；覆盖 AC5）
- [ ] OpenAI 流中的 prompt、completion 和 total Token 被归一化为统一字段。（验证：运行 `pnpm exec tsx --test src/provider/openai.test.ts`; 覆盖 AC19）
- [ ] Anthropic 分散在 message_start 和 message_delta 的输入/输出 Token 被合并为一份用量。（验证：运行 `pnpm exec tsx --test src/provider/anthropic.test.ts`; 覆盖 AC19）

## 工具调度

- [ ] 同一响应中的三个只读工具在前一个结束前均已启动。（验证：用屏障记录活动执行数，断言最大并发数大于 1；覆盖 AC6）
- [ ] 只读并发结果按模型调用顺序回灌，而非按完成顺序回灌。（验证：设置不同延迟并断言结果 ID 顺序；覆盖 AC6）
- [ ] 写入、编辑和命令工具严格逐个执行，后一项只在前一项结束后启动。（验证：记录开始/结束序列，期望无重叠；覆盖 AC7）
- [ ] 混合批次先完成全部只读工具，再按模型中的相对顺序执行副作用工具。（验证：记录完整调度时间线；覆盖 AC8）
- [ ] 同一响应的每个工具调用只执行一次，并各自得到一个对应结果。（验证：按调用 ID 统计执行与结果次数；覆盖 AC6-AC8）
- [ ] 普通工具失败不跳过同批其他工具，也不触发未知工具停止条件。（验证：一个允许工具失败、其余成功，断言批次完整且 unknown streak 为 0；覆盖 AC9）

## 停止条件

- [ ] 模型无工具调用时停止原因为 `completed`，并产生唯一 stopped 事件。（验证：运行首轮文本测试；覆盖 AC2）
- [ ] 模型持续请求工具时最多发起 10 次模型请求，绝不发起第 11 次。（验证：运行固定无限工具 Fake Provider，断言调用数为 10；覆盖 AC10）
- [ ] 第 10 轮请求的工具仍会执行并完整回灌，然后以 `max_iterations` 停止。（验证：断言第 10 个调用和结果存在于历史；覆盖 AC10）
- [ ] 模型流期间取消会停止当前请求、不执行未完成工具、不启动下一轮，并以 `cancelled` 结束。（验证：在流屏障处 abort；覆盖 AC11）
- [ ] 工具执行期间取消会阻止剩余工具与下一轮，保留完成结果并为未完成调用生成取消结果。（验证：在只读批次和副作用序列中分别 abort；覆盖 AC11）
- [ ] 取消后的迟到结果不会覆盖取消状态或推动新一轮。（验证：取消后释放延迟 Fake Tool，断言 Provider/工具计数不增长；覆盖 AC11）
- [ ] 连续三个未知或当前模式不可用工具各自得到结构化错误，第三次后停止。（验证：运行未知工具序列，断言停止原因为 `unknown_tool_limit`；覆盖 AC12）
- [ ] 连续未知计数中间出现允许工具时归零，不会提前停止。（验证：运行“未知、未知、允许、未知、未知”序列；覆盖 AC12）
- [ ] 同一响应达到未知阈值后，排在阈值后的工具不执行并得到取消结果。（验证：在三个未知调用后放置副作用 Fake Tool，断言执行次数为 0；覆盖 AC12）
- [ ] 连接失败、非法流片段、参数聚合失败、读取中断和流提前结束均以 `stream_error` 停止。（验证：运行 Collector、OpenAI、Anthropic 错误测试；覆盖 AC13）
- [ ] 流错误所在轮次的未完成 assistant/tool 内容不进入历史，已完成的此前轮次保留。（验证：第二轮制造流错误并检查历史；覆盖 AC13）
- [ ] 每次运行无论从哪条路径结束都恰好产生一个 stopped 事件。（验证：对五种停止原因参数化测试并统计；覆盖 AC2、AC10-AC13）

## Plan Mode

- [ ] `/plan <任务>` 立即启动 Agent Loop，并只向模型发送读取、查找和搜索三个工具定义。（验证：Fake Provider 记录 definitions 名称；覆盖 AC14）
- [ ] Plan Mode 可以多轮使用三个只读工具并把最终非空计划保存到当前会话。（验证：运行读取后输出计划的 Manager 测试；覆盖 AC14）
- [ ] Plan Mode 猜测调用写入、编辑或命令工具时，项目不发生变化并返回 `TOOL_UNAVAILABLE`。（验证：对临时目录调用三个副作用工具名，比较前后文件状态；覆盖 AC15）
- [ ] Plan Mode 的不可用副作用调用纳入连续未知工具计数。（验证：连续猜测三个副作用工具，断言 unknown_tool_limit；覆盖 AC15）
- [ ] 只有 `completed` 且非空的计划会替换最近成功计划。（验证：依次运行成功、取消、流错误、上限和空文本计划，断言旧计划不变；覆盖 AC16、AC17）
- [ ] 连续生成两个成功计划后，`/do` 只使用第二个计划。（验证：检查 `/do` 新增 user message 中的任务和计划文本；覆盖 AC16）
- [ ] `/do` 不要求任务参数，自动开放全部六个工具并继续同一历史。（验证：运行 Manager `/do` 测试，检查 definitions 与历史前缀；覆盖 AC16）
- [ ] 新会话、`/clear` 后或只有失败计划时执行 `/do`，显示无计划错误且 Provider 与 Tool 执行数均为 0。（验证：运行无计划 Manager 测试；覆盖 AC17）
- [ ] `/clear` 同时清除 user/assistant/tool 历史和最近计划。（验证：运行 clear 状态断言；覆盖 AC17）

## Provider 协议

- [ ] OpenAI 正常流只有遇到 `[DONE]` 才发出 done，usage 位于 done 前且 done 恰好一次。（验证：运行 OpenAI 正常结束测试；覆盖 AC19）
- [ ] Anthropic 正常流只有遇到 `message_stop` 才发出 done，usage 位于 done 前且 done 恰好一次。（验证：运行 Anthropic 正常结束测试；覆盖 AC19）
- [ ] 两种 Provider 均能在一条 assistant 消息中映射多个工具调用，并在下一请求中映射全部结果。（验证：检查捕获的请求 JSON；覆盖 AC19）
- [ ] 两种 Provider 的 AbortError 不被报告为流错误。（验证：分别传入 AbortController，期望无 error/done，由 Collector 判定 cancelled；覆盖 AC11、AC19）
- [ ] 两种 Provider 遇到非法 SSE JSON 或流提前结束时发出 error 且不发 done。（验证：运行对应错误测试；覆盖 AC13）
- [ ] OpenAI 兼容请求仍可使用 DeepSeek 配置字段，Anthropic Thinking 流仍可解析。（验证：运行现有 Provider 映射和 Thinking 回归测试；覆盖 AC18、AC19）

## TUI 与命令

- [ ] 普通聊天正文继续实时展示，Thinking 在正文到来前可见并在完成后保留。（验证：启动 TUI 发起无工具请求，观察增量展示；覆盖 AC18）
- [ ] 多轮 Agent 运行期间输入框保持关闭，状态行持续显示当前轮次和模型/工具阶段。（验证：启动一个至少两轮的任务并观察状态；覆盖 AC18）
- [ ] Provider 报告用量时状态区显示累计 Token；不报告时不显示虚假 `0` 用量。（验证：分别使用带/不带 usage 的测试 Provider 或协议响应观察；覆盖 AC5、AC18）
- [ ] 运行中按 Ctrl+C 只取消当前 Agent，停止后输入框恢复且应用不退出。（验证：慢请求运行中按一次 Ctrl+C，再提交普通消息；覆盖 AC11、AC18）
- [ ] 空闲时按 Ctrl+C 仍退出应用。（验证：重新启动 TUI，在无任务运行时按 Ctrl+C；覆盖 AC18）
- [ ] `/help` 显示 `/plan`、`/do`、运行中取消以及既有命令。（验证：输入 `/help` 检查文本；覆盖 AC18）
- [ ] `/plan` 缺少任务时显示格式提示，不调用模型。（验证：输入 `/plan`，观察立即提示且无生成状态；覆盖 AC17、AC18）
- [ ] `/do` 无计划时显示明确提示并保持输入可用。（验证：启动新会话输入 `/do`；覆盖 AC17、AC18）
- [ ] `/clear`、`/exit` 和 `/quit` 的既有行为未回归。（验证：逐个命令进行 TUI 冒烟；覆盖 AC18）
- [ ] 状态、Token 文本、帮助文本和输入内容在常见终端宽度下不互相覆盖。（验证：分别在约 80 列和窄终端观察运行与帮助界面）

## 编译与自动化测试

- [ ] TypeScript 严格类型检查无错误。（验证：运行 `pnpm typecheck`）
- [ ] Agent 事件队列、Collector、Scheduler、Loop 和 prompts 测试全部通过。（验证：运行 `pnpm exec tsx --test src/agent/*.test.ts`）
- [ ] ChatManager 与 Plan Mode 测试全部通过。（验证：运行 `pnpm exec tsx --test src/chat/manager.test.ts`）
- [ ] OpenAI 与 Anthropic Provider 测试全部通过。（验证：运行 `pnpm exec tsx --test src/provider/*.test.ts`）
- [ ] Tool Registry、六个工具、PathGuard、超时和输出限制测试继续通过。（验证：运行 `pnpm exec tsx --test src/tool/*.test.ts`）
- [ ] 完整检查零失败且不访问真实 LLM API。（验证：运行 `pnpm check`；覆盖 AC20、AC21）
- [ ] 测试没有遗留定时器、子进程或未处理 Promise 导致进程挂起。（验证：`pnpm check` 正常自行退出且终端无异步警告；覆盖 AC20）

## 端到端场景

- [ ] **E2E 1：自主改文件**：用户一次要求读取临时文件、修改唯一文本并复查，Fake Provider 自动完成多轮，最终文件和回答正确。（验证：自动化端到端测试；覆盖 AC1、AC9、AC20）
- [ ] **E2E 2：混合多工具**：模型同轮请求三个只读和两个副作用工具，只读并发、写操作串行、全部结果在下一轮可见。（验证：自动化调度与历史集成测试；覆盖 AC6-AC8、AC20）
- [ ] **E2E 3：计划后执行**：用户 `/plan` 生成只读计划，再输入 `/do` 自动修改临时项目并输出最终回复。（验证：自动化 Manager + Agent 集成测试；覆盖 AC14-AC17、AC20）
- [ ] **E2E 4：运行中取消**：工具执行期间取消，剩余副作用不启动；随后新任务可以正常完成。（验证：自动化取消集成测试；覆盖 AC11、AC20）
- [ ] **E2E 5：安全网停止**：无限工具请求在第 10 轮停止，连续未知工具在第 3 次停止，两个场景进程均保持可用。（验证：自动化停止条件测试；覆盖 AC10、AC12、AC20）
- [ ] **E2E 6：双协议闭环**：人工 SSE 分别模拟 OpenAI 和 Anthropic 的两轮、多工具、多结果和 usage，统一 Agent 事件与最终历史一致。（验证：自动化 Provider + Agent 集成测试；覆盖 AC19、AC20）
- [ ] **E2E 7：真实 TUI 主路径**：启动应用后依次验证普通聊天、`/plan`、`/do`、进度、用量和 Ctrl+C 取消，界面恢复可继续输入。（验证：macOS 本地 TUI 冒烟；覆盖 AC18、AC21）

## 平台与回归

- [ ] macOS 当前环境运行 `pnpm check` 通过。（验证：记录系统平台、命令退出码和测试数量；覆盖 AC21）
- [ ] macOS 当前环境运行 `pnpm start` 可正常进入 TUI 且退出无异常。（验证：本地启动冒烟；覆盖 AC21）
- [ ] 实现不依赖 Windows 专用路径、shell 或信号语义，现有项目根目录和 macOS/Linux 分支保持有效。（验证：检查新增平台分支并运行 PathGuard、命令取消测试；覆盖 AC21）
- [ ] Linux 环境运行 `pnpm check` 通过；若当前没有 Linux 环境，验收报告明确标为未执行并记录剩余风险，不得标记通过。（验证：Linux CI、容器或目标机实际命令输出；覆盖 N9）
- [ ] 项目根目录边界、命令固定工作目录、工具参数 Schema、输出截断和 UTF-8 行为未改变。（验证：运行全部现有 Tool 回归测试；覆盖 AC21）

## Spec 覆盖索引

| Spec 验收标准 | Checklist 覆盖位置 |
|---|---|
| AC1-AC2 | Agent Loop、E2E 1 |
| AC3-AC4 | 双路事件流 |
| AC5 | Token 用量、TUI |
| AC6-AC8 | 工具调度、E2E 2 |
| AC9 | Agent Loop、E2E 1 |
| AC10-AC13 | 停止条件、E2E 4-5 |
| AC14-AC17 | Plan Mode、E2E 3 |
| AC18 | TUI 与命令、E2E 7 |
| AC19 | Provider 协议、E2E 6 |
| AC20 | 编译与自动化测试、E2E 1-6 |
| AC21 | 编译与自动化测试、平台与回归、E2E 7 |
