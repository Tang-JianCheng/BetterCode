# BetterCode 结构化系统提示与缓存策略 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|---|---|---|
| 新建 | `src/prompt/types.ts` | 固定模块、环境、Skill 和会话补充内容类型 |
| 新建 | `src/prompt/sections.ts` | 七个固定系统提示模块及其优先级 |
| 新建 | `src/prompt/builder.ts` | 模块校验、排序和稳定系统提示拼装 |
| 新建 | `src/prompt/builder.test.ts` | 固定模块顺序、分隔、稳定性和错误测试 |
| 新建 | `src/prompt/reminder.ts` | 环境采集、模式周期和补充消息拼装 |
| 新建 | `src/prompt/reminder.test.ts` | 环境、周期、可选模块、标签与转义测试 |
| 修改 | `src/provider/types.ts` | `ProviderRequest`、instruction 消息和缓存 Token 字段 |
| 修改 | `src/provider/openai.ts` | system 首消息、instruction 映射和缓存命中解析 |
| 修改 | `src/provider/openai.test.ts` | OpenAI/DeepSeek 请求前缀与缓存字段测试 |
| 修改 | `src/provider/anthropic.ts` | 顶层 system、显式缓存断点和缓存用量解析 |
| 修改 | `src/provider/anthropic.test.ts` | Anthropic 缓存请求、消息映射和用量测试 |
| 修改 | `src/agent/stream-collector.ts` | 改为接收并透传统一 Provider 请求 |
| 修改 | `src/agent/stream-collector.test.ts` | Provider 请求透传与五字段用量测试 |
| 修改 | `src/agent/loop.ts` | 固定 system/tools、逐轮 reminder 和缓存用量累计 |
| 修改 | `src/agent/loop.test.ts` | 稳定请求、注入周期、历史隔离和用量累计测试 |
| 修改 | `src/agent/prompts.ts` | 移除用户消息中的重复 Plan Mode 系统规则 |
| 修改 | `src/agent/prompts.test.ts` | 计划任务和执行计划请求测试 |
| 修改 | `src/chat/manager.ts` | 移除伪用户 system prompt，传递会话补充内容 |
| 修改 | `src/chat/manager.test.ts` | Provider 接口迁移、历史纯净与模式集成测试 |
| 修改 | `src/tool/tools/read-file.ts` | 强化专用读取与编辑前先读规则 |
| 修改 | `src/tool/tools/write-file.ts` | 强化覆盖前先读和目录约束 |
| 修改 | `src/tool/tools/edit-file.ts` | 强化编辑前先读、唯一原文和专用工具规则 |
| 修改 | `src/tool/tools/run-command.ts` | 强化专用工具优先规则 |
| 修改 | `src/tool/tools/find-files.ts` | 强化专用文件查找规则 |
| 修改 | `src/tool/tools/search-code.ts` | 强化专用代码搜索规则 |
| 修改 | `src/tool/registry.test.ts` | 工具定义顺序、描述和稳定性测试 |
| 修改 | `src/ui/app.tsx` | 展示并保留缓存创建和命中 Token |
| 新建 | `docs/system-prompt/manual-evaluation.md` | 改造前后行为与真实缓存验证记录 |

## T1：记录改造前人工基线

**文件：** `docs/system-prompt/manual-evaluation.md`

**依赖：** 无，必须在任何实现代码修改前完成

**步骤：**

1. 创建人工评估文档，记录测试日期、Provider、模型、项目根目录和执行方式。
2. 使用当前未改造版本运行五类场景：专用工具选择、编辑前读取、Plan Mode 只读、环境信息识别、补充指令回复行为。
3. 每个场景记录完整用户任务、模型实际工具调用顺序、最终回复摘要和是否符合预期。
4. 当前版本没有结构化 system/reminder 时如实记录“无该能力”，不得推测模型行为。
5. 不修改真实业务文件；需要编辑场景时，在项目根目录内创建专用临时评估文件，并在记录完成后删除。
6. 如果真实 Provider 不可用，记录错误和阻塞原因，不用 Fake Provider 结果替代真实基线。

**验证：** 检查 `manual-evaluation.md` 的“改造前基线”中五个场景均有实际结果或明确阻塞证据，不包含待补占位符。

## T2：定义 Prompt 公共类型

**文件：** `src/prompt/types.ts`

**依赖：** T1

**步骤：**

1. 定义 `SystemSectionId` 和 `PromptSection`，包含模块标识、优先级、标题与正文。
2. 定义 `EnvironmentContext`，包含项目根目录、当前目录、平台、Shell、日期、时区和模式。
3. 定义 `ActivatedSkill`，包含 Skill 名称与已提供内容。
4. 定义 `SupplementalPromptContent`，包含可选自定义指令、Skill 列表和长期记忆。
5. 定义 `EnvironmentSource` 与 `ReminderInput`，支持测试注入固定环境和轮次。
6. 所有新增注释使用中文，不引入项目指令加载或记忆维护接口。

**验证：** 运行 `pnpm exec tsc --noEmit --pretty false`，期望项目类型检查通过。

## T3：实现七个固定提示模块

**文件：** `src/prompt/sections.ts`

**依赖：** T2

**步骤：**

1. 按 `700、600、500、400、300、200、100` 定义身份、系统约束、任务模式、动作执行、工具使用、语气风格和文本输出模块。
2. 身份模块统一使用产品名称 BetterCode，并要求以代码和工具结果为事实依据。
3. 系统约束模块定义固定指令优先级、项目边界和 `<system-reminder>` 的元指令语义。
4. 任务模式模块只描述稳定的 Plan/Act 通用规则，不写入当前模式或轮次。
5. 工具使用模块完整写入专用工具优先、编辑前先读、目录约束、失败后调整四类规则。
6. 其余模块按 plan.md 写入动作、语气和最终输出约定，避免环境、日期或会话内容。
7. 冻结并导出稳定的 `SYSTEM_PROMPT_SECTIONS`，保持固定声明顺序。

**验证：** 运行 `rg -n "BetterCode|system-reminder|编辑前|专用工具|项目根目录|工具失败" src/prompt/sections.ts`，期望关键规则均存在且不含动态环境值。

## T4：实现稳定系统提示构建器

**文件：** `src/prompt/builder.ts`

**依赖：** T2、T3

**步骤：**

1. 实现 `buildSystemPrompt(sections?)`，默认使用固定模块数组。
2. 复制输入数组后按 priority 降序排序，不修改调用方数据。
3. 校验重复 ID、空标题、空正文和非有限优先级，并返回明确中文错误。
4. 将每个模块格式化为稳定标题与正文，统一去除外围空白。
5. 使用单个空行连接模块，不在开头或结尾添加动态空白。
6. 不读取进程环境、不接收当前模式、不拼接工具定义或可选内容。

**验证：** 使用 `pnpm exec tsx -e` 调用 `buildSystemPrompt()` 两次，期望输出严格相等且七个标题按批准顺序出现。

## T5：覆盖系统提示构建测试

**文件：** `src/prompt/builder.test.ts`

**依赖：** T4

**步骤：**

1. 断言默认输出恰好包含七个模块且顺序符合优先级。
2. 断言模块之间使用一个空行，相同输入多次生成相同文本。
3. 打乱自定义模块输入顺序，断言结果仍按优先级排列且原数组未变。
4. 分别覆盖重复 ID、空标题、空正文和非法优先级错误。
5. 断言固定提示包含四类关键工具规则、元指令语义和 BetterCode 名称。
6. 断言固定提示不包含项目路径、当前日期、当前模式值或可选模块内容。

**验证：** 运行 `pnpm exec tsx --test src/prompt/builder.test.ts`，期望全部构建与错误场景通过。

## T6：实现环境采集与 reminder 构建

**文件：** `src/prompt/reminder.ts`

**依赖：** T2

**步骤：**

1. 实现默认 `EnvironmentSource`，从 Node.js 进程和系统 API 获取当前目录、平台、Shell、日期与时区。
2. 实现 `collectEnvironment(projectRoot, mode, source?)`，保留规范化项目根目录和六类环境字段。
3. 实现 `isFullModeReminder(iteration)`，仅第 `1、6、11...` 轮返回 true，非法轮次抛中文错误。
4. 分别定义 Plan/Act 的完整模式说明和精简提醒；Plan 明确只读，Act 明确使用当前完整工具集合。
5. 实现 `buildSystemReminder()`，按环境、模式、自定义指令、Skill、长期记忆顺序拼装。
6. 整体使用 `<system-reminder>` 标签，空白可选模块完整省略。
7. 转义外部内容中的 reminder 开始或结束边界，防止标签提前闭合。

**验证：** 使用固定 `EnvironmentSource` 运行 `pnpm exec tsx -e` 输出第 1 和第 2 轮 reminder，期望环境一致、模式说明长短不同且标签完整。

## T7：覆盖 reminder 单元测试

**文件：** `src/prompt/reminder.test.ts`

**依赖：** T6

**步骤：**

1. 使用固定环境源断言项目根目录、当前目录、平台、Shell、日期、时区和模式全部出现。
2. 断言第 `1、6、11` 轮完整注入，第 `2-5、7-10` 轮精简注入。
3. 分别断言 Plan Mode 只读约束和 Act Mode 完整工具语义。
4. 断言三个可选模块按批准顺序出现，空白项和空 Skill 被省略。
5. 断言外部内容中的 `<system-reminder>` 和结束标签被转义，只保留一对真正边界。
6. 覆盖 `0`、负数、小数和非有限轮次错误。

**验证：** 运行 `pnpm exec tsx --test src/prompt/reminder.test.ts`，期望环境、周期、顺序、省略和安全边界测试全部通过。

## T8：扩展 Provider 公共契约

**文件：** `src/provider/types.ts`

**依赖：** T2

**步骤：**

1. 在 `Message` 中增加 `{ role: 'instruction'; content: string }` 分支。
2. 新增 `ProviderRequest`，包含 `systemPrompt`、`messages` 和 `tools`。
3. 将 `LLMProvider.chat()` 改为接收 `ProviderRequest`、事件回调和可选取消信号。
4. 在 `TokenUsage` 增加 `cacheCreationInputTokens` 与 `cacheReadInputTokens` 两个必填数字字段。
5. 保持现有 `StreamEvent` 分支和工具类型导出不变。
6. 更新接口注释，明确 instruction 只属于单次请求、usage 是完整快照。

**验证：** 运行 `rg -n "ProviderRequest|instruction|cacheCreationInputTokens|cacheReadInputTokens" src/provider/types.ts`，期望四项契约完整；接口迁移完成前不以全量 typecheck 作为通过条件。

## T9：迁移 StreamCollector 请求接口

**文件：** `src/agent/stream-collector.ts`、`src/agent/stream-collector.test.ts`

**依赖：** T8

**步骤：**

1. 将 `collect()` 的 messages/tools 参数替换为单个 `ProviderRequest`。
2. 调用 `provider.chat(request, onEvent, signal)`，保持双路流式收集行为不变。
3. 更新 Fake Provider 记录并接收完整请求对象。
4. 将测试 usage 快照扩展为五字段，断言 Collector 不改写缓存字段。
5. 增加请求透传断言，确认 systemPrompt、instruction 和 tools 到达 Fake Provider 时内容不变。
6. 保留显式错误、抛异常、提前结束和取消测试。

**验证：** 运行 `pnpm exec tsx --test src/agent/stream-collector.test.ts`，期望请求透传、双路收集和异常测试全部通过。

## T10：改造 OpenAI/DeepSeek 请求映射与用量解析

**文件：** `src/provider/openai.ts`

**依赖：** T8

**步骤：**

1. 将 `chat()` 改为接收 `ProviderRequest`，从请求中读取 system、messages 和 tools。
2. 始终把稳定 systemPrompt 映射为请求消息数组的第一条 `system` 消息。
3. 将内部 instruction 映射为保留标签文本的 `user` 消息。
4. 保持 assistant tool calls、tool results、工具顺序和 Schema 映射不变。
5. 扩展 usage 类型，读取 `prompt_tokens_details.cached_tokens`。
6. 兼容 DeepSeek 的 `prompt_cache_hit_tokens` 字段别名；标准字段存在时优先使用标准字段。
7. 将未提供的缓存创建和缓存命中量置零，保证缓存命中不重复计入 input 或 total。
8. 保持流错误、取消、工具 JSON 碎片和唯一 done 语义不变。

**验证：** 运行 `rg -n "request\.systemPrompt|case 'instruction'|cached_tokens|prompt_cache_hit_tokens" src/provider/openai.ts`，期望 system、instruction、OpenAI 缓存字段和 DeepSeek 字段别名四类映射均存在。

## T11：覆盖 OpenAI/DeepSeek 缓存测试

**文件：** `src/provider/openai.test.ts`

**依赖：** T10

**步骤：**

1. 将全部 Provider 调用迁移为 `ProviderRequest`。
2. 断言第一条线路消息是稳定 system，instruction 紧随真实历史并映射为 user。
3. 用两次不同环境 instruction 请求断言 system 文本和 tools 深度相等。
4. 覆盖 OpenAI `prompt_tokens_details.cached_tokens`，断言五字段用量正确。
5. 覆盖 DeepSeek `prompt_cache_hit_tokens`，断言字段别名正确映射。
6. 覆盖无缓存字段情况，断言两个缓存字段均为零且流正常完成。
7. 保留工具参数碎片、多个调用、消息映射、错误流和取消测试。

**验证：** 运行 `pnpm exec tsx --test src/provider/openai.test.ts`，期望请求前缀、两种缓存字段和全部既有协议测试通过。

## T12：改造 Anthropic 缓存请求与用量解析

**文件：** `src/provider/anthropic.ts`

**依赖：** T8

**步骤：**

1. 将 `chat()` 改为接收 `ProviderRequest`，从请求中读取 system、messages 和 tools。
2. 把 systemPrompt 映射为顶层文本内容块，并附加 `cache_control: { type: 'ephemeral' }`。
3. 保持工具注册顺序，只给最后一个工具定义增加相同缓存断点。
4. 无工具时省略 tools，但保留带缓存控制的顶层 system。
5. 将 instruction 映射为 user 消息；保持 assistant tool_use 和相邻 tool_result 合并顺序。
6. 解析 `cache_creation_input_tokens` 和 `cache_read_input_tokens`。
7. 将 Anthropic 的 inputTokens 归一化为普通输入、缓存创建和缓存读取之和，再加输出得到 total。
8. 保持 Thinking、工具 JSON 碎片、流错误、取消和唯一 done 语义不变。

**验证：** 运行 `rg -n "request\.systemPrompt|case 'instruction'|cache_control|cache_creation_input_tokens|cache_read_input_tokens" src/provider/anthropic.ts`，期望 system、instruction、缓存断点和两类缓存用量映射均存在。

## T13：覆盖 Anthropic 缓存测试

**文件：** `src/provider/anthropic.test.ts`

**依赖：** T12

**步骤：**

1. 将全部 Provider 调用迁移为 `ProviderRequest`。
2. 断言顶层 system 是带显式缓存控制的内容块。
3. 断言只有最后一个工具带缓存断点，工具名称、顺序和 Schema 不变。
4. 断言无工具请求仍保留可缓存 system 并省略 tools。
5. 断言 instruction 映射为 user，工具结果仍先于随后 reminder。
6. 构造同时含普通输入、缓存创建、缓存读取和输出的 usage，验证五字段归一化结果。
7. 覆盖缓存字段缺失情况，断言缓存值为零且流正常完成。
8. 保留 Thinking、多工具调用、错误流和取消测试。

**验证：** 运行 `pnpm exec tsx --test src/provider/anthropic.test.ts`，期望显式缓存、消息顺序、用量和全部既有协议测试通过。

## T14：强化六个工具描述

**文件：** `src/tool/tools/read-file.ts`、`src/tool/tools/write-file.ts`、`src/tool/tools/edit-file.ts`、`src/tool/tools/run-command.ts`、`src/tool/tools/find-files.ts`、`src/tool/tools/search-code.ts`

**依赖：** T3

**步骤：**

1. 扩充 `read_file` 描述，声明读取优先于通用命令，编辑或覆盖现有文件前必须先读。
2. 扩充 `write_file` 描述，区分新建与完整覆盖，声明覆盖前先读和项目目录约束。
3. 扩充 `edit_file` 描述，声明编辑前先读、使用当前唯一原文、不用命令替代编辑。
4. 扩充 `run_command` 描述，声明仅在没有专用工具时使用，不能替代文件与搜索工具。
5. 扩充 `find_files` 和 `search_code` 描述，声明优先于通用 shell 查找或搜索命令。
6. 不改变工具 name、effect、inputSchema、执行逻辑或注册顺序。

**验证：** 运行 `pnpm exec tsx --test src/tool/tools.test.ts`，期望六个工具原有行为全部通过。

## T15：验证工具定义稳定性

**文件：** `src/tool/registry.test.ts`

**依赖：** T14

**步骤：**

1. 断言完整工具定义顺序仍是读、写、编辑、命令、查找、搜索的既有注册顺序。
2. 断言 Plan Mode 过滤结果仍只包含 `read_file`、`find_files` 和 `search_code`。
3. 连续调用 `definitions()`，断言名称、描述和 Schema 深度相等。
4. 断言相关工具描述覆盖专用工具优先、编辑前先读和目录约束语义。
5. 断言 Provider 定义中不出现 effect 或运行期环境字段。

**验证：** 运行 `pnpm exec tsx --test src/tool/registry.test.ts`，期望定义过滤、顺序、描述和稳定性测试全部通过。

## T16：接入 AgentLoop 稳定请求与临时 reminder

**文件：** `src/agent/loop.ts`

**依赖：** T5、T7、T9、T15

**步骤：**

1. 构造 AgentLoop 时生成一次固定 system prompt，并保存调用方提供的可选补充内容。
2. 在 `execute()` 开始时按模式计算一次工具定义，Plan 使用只读子集，Act 使用全部工具。
3. 每轮请求前调用 `collectEnvironment(registry.rootDir, mode)` 获取最新环境。
4. 使用当前 iteration 生成 reminder，并创建末尾包含 instruction 的发送消息副本。
5. 构造 `ProviderRequest` 交给 StreamCollector，不修改局部真实 history。
6. 确保 assistant 和 tool 结果照常写回 history，instruction 永不写入 outcome。
7. 将累计用量初始化为五个零值字段，并逐轮累加两个缓存字段。
8. 保持现有停止原因、工具调度、取消与不完整轮次历史语义不变。

**验证：** 运行 `rg -n "buildSystemPrompt|collectEnvironment|buildSystemReminder|role: 'instruction'|cacheCreationInputTokens|cacheReadInputTokens" src/agent/loop.ts`，期望稳定 system、动态环境、临时 instruction 和缓存累计入口均存在。

## T17：覆盖 AgentLoop 提示与用量集成测试

**文件：** `src/agent/loop.test.ts`

**依赖：** T16

**步骤：**

1. 将 Fake Provider 改为记录完整 `ProviderRequest`。
2. 断言一次多轮运行的 systemPrompt 严格相等，tools 在各轮严格相等。
3. 断言每次请求末尾恰好一条 instruction，包含环境和完整标签。
4. 构造至少 6 轮响应，断言第 1、6 轮完整模式说明，其余轮次精简。
5. 分别验证 Plan 只发送三工具、Act 发送六工具，且本地 Scheduler 权限不变。
6. 断言 `AgentOutcome.history` 只包含 user、assistant、tool，不含 instruction。
7. 使用两轮不同缓存用量断言五字段 current 与 cumulative 事件正确。
8. 更新取消用 Fake Provider 和所有旧 usage 字面量，保留全部停止条件测试。

**验证：** 运行 `pnpm exec tsx --test src/agent/loop.test.ts`，期望稳定请求、注入周期、历史隔离、用量累计和原有停止路径全部通过。

## T18：清理 Plan 请求并改造 ChatManager

**文件：** `src/agent/prompts.ts`、`src/chat/manager.ts`

**依赖：** T16

**步骤：**

1. 删除或收敛 `buildPlanRequest()` 中重复的 Plan Mode 系统约束，使计划请求只保留真实任务文本。
2. 保留 `buildExecutePlanRequest()` 对原任务和最近计划的完整封装。
3. 将 ChatManager 构造函数第三个参数从旧 `systemPrompt` 字符串改为 `SupplementalPromptContent`。
4. 删除把 systemPrompt 作为首条 user 历史写入的旧逻辑。
5. 把可选补充内容传给 AgentLoop，由 Prompt 层按轮次注入。
6. Plan 运行直接使用用户任务文本，模式限制只来自 system 和 reminder。
7. 保持最近计划保存、`/do`、互斥运行、`turnCount` 和 `clear()` 行为不变。

**验证：** 运行 `rg -n "history\.push.*systemPrompt|buildPlanRequest" src/chat/manager.ts src/agent/prompts.ts`，期望不存在把系统规则伪装成 user 历史的代码。

## T19：迁移 Chat 与 Prompt 集成测试

**文件：** `src/chat/manager.test.ts`、`src/agent/prompts.test.ts`

**依赖：** T18

**步骤：**

1. 将 Chat Fake Provider 和阻塞 Provider 迁移为 `ProviderRequest` 接口。
2. 更新 Plan prompt 测试，断言真实任务保留且不再混入重复系统规则。
3. 断言 Chat 历史首条消息始终是真实用户任务，不含 system 或 instruction。
4. 使用第三构造参数提供自定义指令、Skill 和长期记忆，断言线路 reminder 包含它们但 history 不包含。
5. 断言 `/plan` 每轮只读工具、`/do` 恢复全工具且模式切换首轮完整注入。
6. 断言 `clear()` 后真实历史和最近计划为空，新任务仍重新获得 system/reminder。
7. 保留计划成功条件、执行最近计划、取消、最大轮次和互斥测试。

**验证：** 运行 `pnpm exec tsx --test src/chat/manager.test.ts src/agent/prompts.test.ts`，期望历史纯净、可选模块、Plan/Act 与所有既有会话测试通过。

## T20：扩展 UI 缓存用量展示

**文件：** `src/ui/app.tsx`

**依赖：** T17、T19

**步骤：**

1. 扩展 Token 状态行，显示输入、输出、缓存创建、缓存命中和总计。
2. 新任务开始时清空上一任务用量，收到 usage 事件时显示累计快照。
3. 运行结束后保留最后累计用量，不在 finally 中立即清除。
4. 空闲状态也显示最近一次用量，便于连续请求后比较缓存命中。
5. `/clear` 同时清除 UI 最近用量，不改变 ChatManager 的固定提示状态。
6. 不新增缓存开关、不改变消息显示、取消快捷键或 Agent 进度事件。

**验证：** 运行 `pnpm typecheck`，期望 UI 对五字段 TokenUsage 的读取完整且无 JSX/联合类型错误。

## T21：完成全量接口迁移与自动化回归

**文件：** 所有本任务修改的 `src/**/*.ts`、`src/**/*.tsx` 和测试文件

**依赖：** T11、T13、T15、T17、T19、T20

**步骤：**

1. 使用 `rg` 查找所有 `LLMProvider.chat()` 实现和调用，确认没有旧的 messages/tools 位置参数。
2. 查找所有 `TokenUsage` 字面量，补齐两个缓存字段。
3. 检查所有 Fake Provider、阻塞 Provider 和 StreamCollector 调用均使用 `ProviderRequest`。
4. 运行 Prompt、Provider、Tool、Agent、Chat 的定向测试，修复本阶段引入的问题。
5. 运行完整 typecheck 与测试，不处理与本阶段无关的既有问题。
6. 扫描新增代码注释，确认均为中文；扫描新增用户可见内容，确认产品名统一为 BetterCode。

**验证：** 运行 `pnpm check`，期望 TypeScript 严格类型检查和全部 `src/**/*.test.ts` 测试通过。

## T22：执行改造后缓存验证与行为对比

**文件：** `docs/system-prompt/manual-evaluation.md`

**依赖：** T21

**步骤：**

1. 使用与 T1 相同的 Provider、模型、根目录和五类任务重新运行改造后场景。
2. 记录每个场景的实际工具调用顺序、最终回复摘要和是否符合预期。
3. 对照 T1 基线逐项写出差异和结论，不只记录主观“更好”或“无变化”。
4. 在同一模式和工具集合下连续发送至少两次请求，记录 UI 或 usage 事件中的缓存创建与缓存命中 Token。
5. 验证动态环境或历史变化时 systemPrompt 和 tools 的测试证据仍保持相等。
6. 若真实服务返回零缓存命中，记录请求次数、稳定前缀条件、可能的最小长度限制和实际零值，不伪造命中。
7. 删除评估临时文件，确认未留下场景生成的无关项目改动。
8. 补充最终结论，标明五类行为是否改善以及缓存策略是否有真实命中证据。

**验证：** 检查 `manual-evaluation.md` 同时包含改造前、改造后、逐场景对比、连续请求缓存数据和最终结论，且所有结果来自实际运行或带有明确阻塞说明。

## T23：完成最终范围与文档检查

**文件：** `docs/system-prompt/spec.md`、`docs/system-prompt/plan.md`、`docs/system-prompt/task.md`、`docs/system-prompt/manual-evaluation.md` 及全部实现文件

**依赖：** T22

**步骤：**

1. 对照 spec.md 的 F1-F8 和 N1-N6，确认每项都有实现位置与验证证据。
2. 检查没有新增项目指令加载、自动记忆、Skill 发现、真实 MCP、权限确认或自动评分代码。
3. 检查 systemPrompt、tools、instruction 和真实 history 的边界与 plan.md 一致。
4. 检查 `AGENTS.md` 保持用户原有内容，且未被加入或覆盖为本任务实现文件。
5. 查看 `git diff --check`，确认没有尾随空格或补丁格式问题。
6. 再次运行完整检查并记录最终测试数量与结果，供 checklist 验收使用。

**验证：** 运行 `git diff --check && pnpm check`，期望补丁格式、类型检查和完整测试全部通过；`git status --short` 中只包含本阶段文件及用户原有的 `AGENTS.md`。

## 执行顺序

```text
T1（改造前基线）
 |
 v
T2 -> T3 -> T4 -> T5
 |          |
 `-> T6 -> T7
 |
 v
T8 -> T9 -> T10 -> T11
          `-> T12 -> T13

T3 -> T14 -> T15

T5 + T7 + T9 + T15
          |
          v
         T16 -> T17
                  |
                  v
         T18 -> T19 -> T20

T11 + T13 + T15 + T17 + T19 + T20
                  |
                  v
                 T21 -> T22 -> T23
```

Provider 的 OpenAI 和 Anthropic 分支在完成 T9 后可以分别实施，但当前执行者按上述顺序串行推进，避免并行编辑共享的 `src/provider/types.ts`。四份规划文档批准前不执行 T1，也不修改任何实现代码。
