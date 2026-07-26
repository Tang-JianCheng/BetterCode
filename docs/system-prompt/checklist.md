# BetterCode 结构化系统提示与缓存策略 Checklist

> 每一项必须通过测试、捕获的协议请求、终端观察或人工评估记录验证。自动化测试不得访问真实 LLM API；真实缓存与模型行为单独执行并记录。

## 验收结果

- 结果：71/71 项通过。
- 自动化：`pnpm check` 通过，68 项测试、0 失败，TypeScript strict 类型检查通过。
- 真实 Provider：`deepseek-v4-pro` 完成五类改造前后场景；连续两次缓存验证请求均命中 1152 个输入 Token。
- UI：真实 TUI 启动与退出正常；内存 TTY 验证回复、五字段 Token、补充指令隐藏和 `/clear` 清除用量。
- 补丁：`git diff --check` 通过，评估临时文件与测试脚本均已删除。

## 固定系统提示

- [x] 固定系统提示按“身份、系统约束、任务模式、动作执行、工具使用、语气风格、文本输出”排列，且只包含这七个默认模块。（验证：运行 `pnpm exec tsx --test src/prompt/builder.test.ts`，检查顺序与模块数量断言；覆盖 AC1）
- [x] 相邻固定模块之间恰好一个空行，输出没有多余首尾空白。（验证：运行 Prompt builder 格式测试，比较完整输出分隔结构；覆盖 AC1）
- [x] 相同模块输入无论调用多少次都生成字节级相同文本，打乱输入顺序后仍按优先级输出且不修改原数组。（验证：运行 Prompt builder 稳定性测试；覆盖 AC1、AC10）
- [x] 重复模块 ID、空标题、空正文和非法优先级均返回明确错误，不生成部分提示。（验证：运行 Prompt builder 错误测试；覆盖 AC11）
- [x] 固定提示明确声明 BetterCode 身份、固定指令优先级和 `<system-reminder>` 只执行不直接回复的语义。（验证：检查默认 Prompt 测试中的关键文本断言；覆盖 AC4、AC13）
- [x] 固定提示不包含项目路径、当前目录、日期、时区、当前模式值、自定义指令、Skill 内容或长期记忆。（验证：使用两组不同动态上下文生成请求，断言 systemPrompt 严格相等；覆盖 AC3、AC10）

## 动态补充消息

- [x] 每次模型请求都包含一条由 `<system-reminder>` 完整包裹的临时补充消息。（验证：运行 AgentLoop 请求捕获测试，逐轮检查最后一条 instruction；覆盖 AC4）
- [x] 环境信息包含项目根目录、当前工作目录、操作系统与平台、Shell、当前日期与时区、当前任务模式。（验证：运行 `pnpm exec tsx --test src/prompt/reminder.test.ts`，检查固定环境源的六类字段；覆盖 AC2）
- [x] 自定义指令、已激活 Skill 和长期记忆按批准顺序出现在环境与模式信息之后。（验证：运行 reminder 可选模块顺序测试；覆盖 AC2）
- [x] 缺失、空白或无有效内容的可选模块被整体省略，不显示空标题或占位内容。（验证：运行 reminder 空内容测试；覆盖 AC2）
- [x] 外部可选内容无法通过伪造 reminder 开始或结束标签逃离补充消息边界。（验证：传入包含边界标签的内容，断言最终文本只有一对真实边界；覆盖 AC12）
- [x] 临时 instruction 出现在发送给 Provider 的消息中，但不进入 `AgentOutcome.history`、`ChatManager.getHistory()` 或 TUI 用户消息列表。（验证：运行 AgentLoop 与 ChatManager 历史隔离测试，并启动 TUI 观察；覆盖 AC4）
- [x] 动态补充内容尝试要求访问项目外路径、开放禁用工具或覆盖固定规则时，最终指令优先级仍保留原安全边界。（验证：构造恶意可选内容，检查固定 system 约束仍在且 Plan Mode 副作用工具仍不可用；覆盖 AC12）

## 模式注入

- [x] 第 `1、6、11` 个 Agent 轮次使用完整模式说明，第 `2-5、7-10` 轮使用精简提醒。（验证：运行 reminder 周期参数化测试；覆盖 AC5）
- [x] 非正整数轮次被拒绝，不会静默生成错误周期的 reminder。（验证：运行 reminder 非法轮次测试；覆盖 AC5、AC11）
- [x] 新 Agent 运行首轮重新使用完整说明，Plan/Act 模式切换后的首轮也重新使用完整说明。（验证：连续执行普通任务、`/plan` 和 `/do`，检查各自首个捕获请求；覆盖 AC5）
- [x] Plan Mode 完整与精简提醒都坚持只读约束，Act Mode 提醒明确允许使用当前完整工具集合。（验证：运行 reminder 模式文本测试；覆盖 AC5）
- [x] Plan Mode 每轮只向模型提供读取、查找和搜索工具；Act Mode 每轮提供全部六个工具。（验证：运行 AgentLoop 与 ChatManager 模式集成测试；覆盖 AC5、AC9）
- [x] 即使动态内容要求写入，Plan Mode 猜测副作用工具仍返回结构化不可用结果且项目无变化。（验证：运行现有 Plan Mode 安全回归测试并比较临时目录前后状态；覆盖 AC12）

## 缓存边界

- [x] 同一模式的一次多轮运行中，所有 Provider 请求的 systemPrompt 和 tools 内容与顺序严格相等。（验证：运行 AgentLoop 稳定请求测试，对每轮捕获值做深度比较；覆盖 AC3、AC10）
- [x] 仅改变环境、日期、工作目录或对话历史时，只改变 messages 中的动态内容，不改变 systemPrompt 或 tools。（验证：构造两次不同运行期上下文并比较统一请求对象；覆盖 AC3、AC10）
- [x] Plan 与 Act 因安全工具集合不同可以形成两个稳定前缀，但同一模式内部不随轮次改变定义。（验证：分别捕获 Plan 和 Act 的连续请求，检查各自内部稳定及两种工具集合差异；覆盖 AC3、AC10）
- [x] Anthropic 顶层 system 使用显式 ephemeral 缓存控制。（验证：运行 `pnpm exec tsx --test src/provider/anthropic.test.ts`，检查捕获请求；覆盖 AC3）
- [x] Anthropic 有工具时仅最后一个工具携带缓存断点，名称、顺序和 Schema 不变；无工具时省略 tools 但保留可缓存 system。（验证：运行 Anthropic 有工具与无工具请求测试；覆盖 AC3）
- [x] OpenAI/DeepSeek 的第一条线路消息始终是稳定 system，动态 instruction 位于其后的 messages 通道，且不发送 Anthropic 私有缓存字段。（验证：运行 `pnpm exec tsx --test src/provider/openai.test.ts`，检查捕获请求；覆盖 AC3、AC4）
- [x] 两种 Provider 都把 instruction 映射为协议支持的 user 消息并保留完整标签，Anthropic 工具结果仍先于随后 reminder。（验证：运行两个 Provider 的消息映射与工具结果顺序测试；覆盖 AC4、AC9）

## 工具规则

- [x] 固定“工具使用”模块同时包含专用工具优先、编辑前先读、目录约束和失败后调整四类规则。（验证：运行 Prompt builder 关键规则测试；覆盖 AC6）
- [x] 六个工具的描述在相关位置重复强化对应规则，`run_command` 明确不能替代文件和搜索专用工具。（验证：运行 Tool Registry 描述测试；覆盖 AC6）
- [x] `edit_file` 明确要求先读取当前内容并使用唯一原文，`write_file` 明确要求覆盖现有文件前先读。（验证：检查 Registry 返回的两个工具描述断言；覆盖 AC6）
- [x] 连续调用 Registry 获取工具定义时，名称、描述、Schema 与顺序保持完全一致。（验证：运行 `pnpm exec tsx --test src/tool/registry.test.ts`；覆盖 AC6、AC10）
- [x] 工具名称、参数 Schema、安全级别和执行行为没有因描述强化发生变化。（验证：运行 `pnpm exec tsx --test src/tool/tools.test.ts src/tool/registry.test.ts`；覆盖 AC9）

## 缓存用量

- [x] Anthropic 能解析普通输入、缓存创建输入、缓存读取输入和输出，并归一化为五字段完整用量。（验证：运行 Anthropic usage 测试，检查 input 与 total 的求和；覆盖 AC7）
- [x] OpenAI 能解析 `prompt_tokens_details` 中的缓存命中量，且命中量不重复加入 input 或 total。（验证：运行 OpenAI 标准缓存字段测试；覆盖 AC7）
- [x] DeepSeek 缓存命中字段别名能映射到统一缓存读取字段。（验证：运行 OpenAI 兼容 Provider 的 DeepSeek usage 测试；覆盖 AC7）
- [x] 供应商不返回缓存字段时两个缓存值为零，正文、工具调用、usage 和 done 仍正常完成。（验证：分别运行两种 Provider 的字段缺失测试；覆盖 AC7）
- [x] AgentLoop 对输入、输出、总量、缓存创建和缓存读取逐轮正确累计，current 与 cumulative 语义不混淆。（验证：运行至少两轮固定 usage 的 AgentLoop 测试；覆盖 AC7）
- [x] TUI 状态区显示五类累计 Token，用量在运行结束后保留到下一任务或 `/clear`。（验证：启动 TUI 完成一次真实请求，观察空闲状态用量；再输入 `/clear` 确认消失；覆盖 AC7、AC8）

## Agent 与会话集成

- [x] `LLMProvider.chat()` 的所有实现、Fake Provider 和调用方统一使用 system/messages/tools 请求对象。（验证：运行 `pnpm typecheck`，并用 `rg -n "async chat\(" src` 检查无旧位置参数实现；覆盖 AC9、AC11）
- [x] StreamCollector 原样透传 system、messages 和 tools，同时继续实时转发文本、Thinking 与工具调用并收集完整响应。（验证：运行 `pnpm exec tsx --test src/agent/stream-collector.test.ts`；覆盖 AC9、AC11）
- [x] ChatManager 历史首条消息是真实用户任务，不再存在伪装成 user 的 system prompt。（验证：运行 ChatManager 历史测试；覆盖 AC4、AC9）
- [x] 会话级自定义指令、Skill 和长期记忆能进入每轮 reminder，但 `clear()` 后真实历史和最近计划仍按既有语义清理。（验证：运行 ChatManager 可选内容与 clear 测试；覆盖 AC2、AC4）
- [x] Plan 请求不再把详细模式规则混入真实用户任务，`/do` 仍完整包含最近计划与原任务。（验证：运行 `pnpm exec tsx --test src/agent/prompts.test.ts src/chat/manager.test.ts`；覆盖 AC4、AC9）
- [x] 文本流、Thinking、多个工具调用、工具结果回灌、取消、未知工具、最大轮次和流错误行为均未回归。（验证：运行全部 Agent、Provider 与 Chat 测试；覆盖 AC9）
- [x] 流错误或取消所在轮次的临时 instruction 和未完成 assistant 内容不写入历史，已完成轮次仍保留。（验证：运行 AgentLoop 流错误与取消历史测试；覆盖 AC4、AC9）

## 自动化检查

- [x] Prompt builder 与 reminder 测试全部通过且不访问真实 API。（验证：运行 `pnpm exec tsx --test src/prompt/*.test.ts`；覆盖 AC1、AC2、AC4、AC5、AC6、AC10-AC12）
- [x] OpenAI/DeepSeek 与 Anthropic Provider 测试全部通过且不访问真实 API。（验证：运行 `pnpm exec tsx --test src/provider/*.test.ts`；覆盖 AC3、AC4、AC7、AC9、AC11）
- [x] Agent 与 Chat 测试全部通过且不访问真实 API。（验证：运行 `pnpm exec tsx --test src/agent/*.test.ts src/chat/*.test.ts`；覆盖 AC2-AC5、AC7、AC9-AC12）
- [x] Tool 测试全部通过，项目根目录、命令工作目录、Schema、超时、错误和输出限制行为未回归。（验证：运行 `pnpm exec tsx --test src/tool/*.test.ts`；覆盖 AC6、AC9、AC12）
- [x] TypeScript strict 类型检查无错误，Provider 接口和五字段用量没有遗漏调用方。（验证：运行 `pnpm typecheck`；覆盖 AC9、AC11）
- [x] 完整自动化检查零失败并正常退出，没有未处理 Promise、定时器或子进程残留。（验证：运行 `pnpm check`；覆盖 AC9、AC11）
- [x] 补丁没有尾随空格或格式错误。（验证：运行 `git diff --check`）

## 人工对比

- [x] 人工评估记录测试日期、Provider、模型、项目根目录和可重复执行步骤。（验证：检查 `docs/system-prompt/manual-evaluation.md` 元信息；覆盖 AC8）
- [x] 专用工具场景同时记录改造前后实际工具调用，能判断是否避免通用命令替代。（验证：检查对应场景的任务、调用顺序、实际结果和结论；覆盖 AC8）
- [x] 编辑前读取场景同时记录改造前后实际调用顺序，能判断是否先读后改。（验证：检查对应场景记录；覆盖 AC8）
- [x] Plan Mode 场景同时记录改造前后工具集合和最终计划，确认只使用只读工具。（验证：检查对应场景记录与项目前后状态；覆盖 AC8、AC12）
- [x] 动态环境场景确认模型使用最新环境，且自动化证据证明固定 system/tools 未变化。（验证：检查对应人工结果与稳定请求测试结果；覆盖 AC8、AC10）
- [x] reminder 场景确认模型执行补充指令但不直接复述或回答标签本身。（验证：检查真实模型回复和捕获请求；覆盖 AC4、AC8）
- [x] 五类场景均有改造前表现、改造后表现、差异和明确结论；真实 Provider 不可用时只标记阻塞，不伪造结果。（验证：逐节检查人工评估文档；覆盖 AC8）

## 真实缓存验证

- [x] 使用同一 Provider、模型、模式和工具集合连续发送至少两次请求，并记录每次完整五字段 Token 用量。（验证：检查人工评估中的连续请求表格；覆盖 AC8）
- [x] 连续请求期间固定 system/tools 经自动化测试确认一致，只有历史和 reminder 动态变化。（验证：把请求稳定性测试证据链接或抄录到人工评估；覆盖 AC3、AC8、AC10）
- [x] 服务返回缓存创建或命中时，UI 数据与 Provider 原始字段一致；未命中时记录真实零值、请求条件和可能阈值，不将零值写成成功命中。（验证：对照原始响应字段、UI 与人工评估结论；覆盖 AC7、AC8）
- [x] 缓存验证步骤可由同一配置重复执行，且不会修改项目业务文件。（验证：按文档步骤复跑一次或检查命令与场景均为只读；覆盖 AC8）

## 端到端场景

- [x] **E2E 1：普通任务**：用户一次要求读取评估文件、唯一替换并复查，Agent 使用专用工具完成，最终文件和回复正确，reminder 不进入历史。（验证：自动化 AgentLoop 工作流测试；覆盖 AC4、AC6、AC9）
- [x] **E2E 2：计划后执行**：用户 `/plan` 只读生成计划，再用 `/do` 开放全工具执行；两次运行首轮均为完整模式说明。（验证：ChatManager + Agent 集成测试和临时目录结果；覆盖 AC5、AC9、AC12）
- [x] **E2E 3：动态补充内容**：会话提供自定义指令、Skill 和长期记忆，模型收到最新环境并遵守补充要求，TUI 只显示真实用户任务与模型回复。（验证：捕获 Provider 请求并进行一次真实 TUI 冒烟；覆盖 AC2、AC4、AC8）
- [x] **E2E 4：双协议请求**：相同统一请求分别映射为 Anthropic 显式缓存请求与 OpenAI/DeepSeek 自动缓存前缀，统一 usage 事件字段一致。（验证：Provider 请求捕获与 usage 集成测试；覆盖 AC3、AC7、AC11）
- [x] **E2E 5：失败与恢复**：工具返回结构化失败后模型可调整下一步；流错误和取消仍按既有原因停止且不污染历史。（验证：运行 AgentLoop 失败恢复、流错误和取消测试；覆盖 AC6、AC9）

## 范围与命名

- [x] 本阶段没有新增项目级指令文件加载、自动记忆、Skill 发现、真实 MCP、自动评分、权限系统或交互式确认。（验证：检查最终 diff 与依赖清单，对照 spec“不做的事”）
- [x] 动态补充内容不能扩大 ToolRegistry 的项目根目录、工作目录或模式权限。（验证：运行路径边界、Plan Mode 不可用工具和恶意 reminder 测试；覆盖 AC12）
- [x] 所有新增用户可见提示、文档、测试场景和 UI 文本统一使用产品名称 BetterCode。（验证：扫描本阶段新增和修改文件并人工检查产品名；覆盖 AC13）
- [x] 新增代码注释均使用中文，用户已有 `AGENTS.md` 内容未被覆盖或删除。（验证：检查最终 diff 与 `git status --short`）

## Spec 覆盖索引

| Spec 验收标准 | Checklist 覆盖位置 |
|---|---|
| AC1 | 固定系统提示、自动化检查 |
| AC2 | 动态补充消息、Agent 与会话集成 |
| AC3 | 缓存边界、真实缓存验证、E2E 4 |
| AC4 | 固定系统提示、动态补充消息、Agent 与会话集成 |
| AC5 | 模式注入、E2E 2 |
| AC6 | 工具规则、E2E 1、E2E 5 |
| AC7 | 缓存用量、真实缓存验证、E2E 4 |
| AC8 | 人工对比、真实缓存验证、E2E 3 |
| AC9 | Agent 与会话集成、自动化检查、E2E 1-2、E2E 5 |
| AC10 | 固定系统提示、缓存边界、人工对比 |
| AC11 | 固定系统提示、缓存用量、自动化检查、E2E 4 |
| AC12 | 动态补充消息、模式注入、范围与命名、E2E 2、E2E 5 |
| AC13 | 固定系统提示、范围与命名 |
