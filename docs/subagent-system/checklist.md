# BetterCode 子 Agent 系统 Checklist

> 本清单在编码前定义。开发完成后必须逐项运行验证，只有取得实际证据的项目才能改为 `[x]`。

## 验收记录（2026-07-31）

- `pnpm check` 通过：TypeScript strict 类型检查成功，316/316 项测试通过。
- 子 Agent 定向测试通过：角色 parser/loader/manager、固定工具、过滤、读取缓存、Runner、Coordinator、TaskManager、ResultInbox、Prompt 和 Chat 回流均有自动化证据。
- 集成测试验证后台完成不会唤醒主模型，下一次自然请求恰好注入一次结果，并持久化 `subagent_result` 与 cache usage。
- Hook、Skill、Session、Command、UI、Provider、Permission、Context、MCP 和既有 Agent Loop 全量回归通过。
- 静态验收通过：四份文档存在，README 与变更日志已更新，用户可见名称统一为 BetterCode，新增注释使用中文，`git diff --check` 无输出。
- 范围验收通过：实现不创建 Worktree，不持久化后台运行状态，不开放子 Agent 递归委派或团队编排；根目录 `.bettercode/` 运行数据未纳入改动。

## 文档与范围

- [x] Spec、Plan、Tasks、Checklist 四份文档均存在且使用 BetterCode 名称。（验证：运行 `test -f docs/subagent-system/spec.md && test -f docs/subagent-system/plan.md && test -f docs/subagent-system/task.md && test -f docs/subagent-system/checklist.md`，再运行旧名称扫描）
- [x] 四份文档没有未完成占位符。（验证：运行 `rg -n "T[B]D|T[O]DO|待(定|补)" docs/subagent-system`，期望无输出）
- [x] README 说明定义式、Fork 式、前后台和结果回流，不把子 Agent 描述成独立进程或 Worktree。（验证：运行 README 关键词扫描并人工核对边界说明）
- [x] README 明确后台任务不跨进程恢复、子 Agent不能递归委派、并发文件写入不自动合并。（验证：人工阅读 README 子 Agent安全边界章节）
- [x] 新增源码注释均使用中文，用户可见文案不出现旧系统名。（验证：扫描本章新增 diff 中的注释与文案）

## 配置与模型档位

- [x] 不配置 `agent_models` 和 `subagents` 时，现有配置仍可加载。（验证：运行 `pnpm exec tsx --test src/config/loader.test.ts` 的缺省兼容场景）
- [x] `haiku`、`sonnet`、`opus` 可分别映射到已有 Provider 名称。（验证：运行配置模型档位测试，观察三个映射结果）
- [x] 模型档位映射值为空或指向不存在 Provider 时产生明确诊断。（验证：运行配置与角色定义管理测试）
- [x] 未配置某档位不会阻止 BetterCode 启动，只禁用引用该档位的角色。（验证：加载同时包含 inherit 角色和缺失档位角色，观察仅后者禁用）
- [x] 前台自动转后台默认阈值为 120000 毫秒。（验证：运行配置默认值测试）
- [x] 前台阈值可在合法范围内调整。（验证：加载自定义阈值并观察解析结果）
- [x] Fork 最大迭代数和终态任务保留数可配置并有默认值。（验证：运行配置默认与自定义测试）
- [x] 错误类型、越界整数、未知全局字段或非法 denied_tools 会阻止启动并指出字段。（验证：运行配置非法输入表格测试）
- [x] 全局 denied_tools 会与不可移除的 `agent`、`load_skill` 禁用项合并。（验证：运行配置归一化与工具过滤测试）
- [x] 重复 denied_tools 被去重，不改变稳定顺序或扩大能力。（验证：运行配置去重测试）

## 角色定义与覆盖

- [x] 合法 YAML frontmatter 和非空 Markdown 正文可解析为角色。（验证：运行 `pnpm exec tsx --test src/subagent/parser.test.ts`）
- [x] 角色支持 name、description、tools、disallowed_tools、background_tools、model、max_iterations、permission_mode。（验证：解析完整样例并对比所有字段）
- [x] tools 缺省表示从完整工具集合开始，显式空数组表示不开放普通工具。（验证：运行 parser 与 tool-filter 联合测试）
- [x] disallowed_tools 与 tools 冲突时拒绝项优先。（验证：运行工具过滤冲突测试）
- [x] background_tools 为必填数组，允许显式空数组。（验证：分别解析缺失和空数组定义，观察失败/成功）
- [x] 空正文、未知字段、错误枚举、错误数组和非法最大轮次均产生明确解析错误。（验证：运行 parser 非法输入测试）
- [x] 内置 `general` 角色真实文件可被解析并使用 inherit/default/10 轮配置。（验证：读取内置文件运行 parser 真实文件测试）
- [x] `general` 的后台工具只包含读文件、找文件和搜代码。（验证：运行内置角色元数据断言）
- [x] 插件、内置、用户、项目四级目录均可发现 `*.md` 和 `*/AGENT.md`。（验证：运行 `pnpm exec tsx --test src/subagent/loader.test.ts`）
- [x] 同名角色按项目高于用户、高于内置、高于插件覆盖。（验证：构造四级同名定义并观察最终 scope）
- [x] 同一来源出现重复角色时禁用该角色并输出重复诊断。（验证：运行同层重复测试）
- [x] 最高优先级定义损坏时不回退低优先级同名角色。（验证：运行损坏项目定义覆盖合法内置定义的测试）
- [x] 单角色损坏不会阻止其他合法角色或 BetterCode 启动。（验证：加载一好一坏两个角色并观察快照）
- [x] 角色引用未知工具、全局禁用工具或缺失模型档位时只禁用该角色。（验证：运行 definition manager 三类诊断测试）
- [x] 角色诊断包含来源、文件、角色名、代码和中文原因。（验证：检查诊断结构与 UI 格式化结果）
- [x] 角色热更新可以新增、覆盖、禁用和修复角色。（验证：运行 definition manager watcher 测试）
- [x] 已运行任务保留启动时角色快照，不被热更新改变。（验证：任务运行期间改写角色并比较当前任务配置）

## 统一 Agent 工具

- [x] Provider 工具列表中只有一个稳定的 `agent` 工具，不为角色动态注册工具。（验证：初始化多个角色后检查 ToolRegistry 定义）
- [x] 角色新增、删除、覆盖和热更新前后 `agent` 名称与 Schema 完全一致。（验证：对更新前后 Schema 做深比较）
- [x] defined 调用要求 type、task、role，background 可选。（验证：运行 `pnpm exec tsx --test src/subagent/agent-tool.test.ts`）
- [x] fork 调用要求 type、task，拒绝 role 和 background。（验证：运行 fork 参数组合测试）
- [x] 空 task、空 role、未知 type 和额外参数返回 `INVALID_ARGUMENTS`。（验证：运行 Agent 工具非法参数测试）
- [x] AgentTool 自身不调用 Provider、不创建任务，只返回调度标记。（验证：注入调用计数器执行工具，期望 Provider/TaskManager 次数为零）
- [x] `agent` 作为系统编排工具不经过普通文件/命令权限确认。（验证：strict 主权限模式调用 agent，观察子任务仍可创建）
- [x] 子 Agent普通工具调用仍逐次经过 Hook、过滤、沙箱、黑名单和权限策略。（验证：运行定义式权限端到端测试）
- [x] 所有子 Agent的 Provider 工具列表都不含 `agent`。（验证：捕获 defined 与 fork 每次 ProviderRequest.tools）
- [x] 子 Agent不能通过 `load_skill` 间接启动独立 AgentLoop。（验证：伪造 load_skill 调用，期望 TOOL_UNAVAILABLE 且 SkillRunner 未执行）
- [x] Plan Mode 中主 Agent可看到 agent，但子 Agent只能看到和执行只读工具。（验证：运行 Plan Mode 子 Agent集成测试）

## 工具过滤

- [x] 定义式前台工具按完整集合、全局禁止、角色白名单、角色黑名单顺序收窄。（验证：运行 `pnpm exec tsx --test src/subagent/tool-filter.test.ts`）
- [x] 定义式后台工具等于前台可见工具与 background_tools 的交集。（验证：运行前后台集合对比测试）
- [x] 任一高安全层拒绝的工具不能被后续白名单重新放开。（验证：构造全局 deny 与角色 allow 冲突）
- [x] Fork 继承父 Agent实际可见工具集合，而不是完整 Registry。（验证：父 Skill 收窄工具后创建 Fork，捕获 Fork tools）
- [x] Fork 保持父工具相对顺序并移除 agent、load_skill 和全局禁用项。（验证：运行 Fork 工具顺序测试）
- [x] 发送给 Provider 的工具集合与执行前 allowed names 一致。（验证：捕获请求定义并伪造集合外调用）
- [x] 模型伪造不可见工具调用只收到 TOOL_UNAVAILABLE，工具实现调用次数为零。（验证：运行执行防绕过测试）
- [x] 前台转后台后，尚未开始的前台专属工具被后台白名单拒绝。（验证：模型流期间切后台再返回写工具调用）
- [x] 已授权且已开始的工具不会因转后台而重复执行或被重启。（验证：长工具运行期间切后台，观察调用次数恰为一次）
- [x] Plan Mode 副作用检查独立于角色权限模式，即使 allow 也不能执行写工具。（验证：allow 角色在 Plan Mode 伪造 edit_file）

## 文件读取缓存隔离

- [x] 每个子 Agent创建独立文件读取缓存。（验证：运行 `pnpm exec tsx --test src/tool/execution-state.test.ts src/subagent/runner.test.ts`）
- [x] 同一 Agent重复读取未变化文件命中缓存并保持相同输出截断行为。（验证：连续 read_file，观察 metadata.cached 从 false 变 true）
- [x] 文件 size 或 mtime 变化后缓存失效并读取新内容。（验证：外部改写文件后再次读取）
- [x] write_file/edit_file 成功后使当前 Agent对应路径缓存失效。（验证：读取、编辑、再读取，观察新内容与 cache miss）
- [x] run_command、MCP 或其他成功副作用工具后全量失效当前 Agent缓存。（验证：填充两个缓存项后执行副作用，观察二者 miss）
- [x] 失败、拒绝或取消的副作用工具不清空当前缓存。（验证：运行失败副作用后再次读取）
- [x] 一个 Agent清理缓存不影响父 Agent或另一个子 Agent。（验证：两个 execution state 并行读同一文件并分别失效）
- [x] 任务结束后清空读取缓存并释放引用。（验证：Runner finally 测试观察 state.clear 被调用）

## 定义式子 Agent

- [x] 定义式子 Agent首个请求从空消息历史开始。（验证：运行 `pnpm exec tsx --test src/subagent/runner.test.ts src/subagent/integration.test.ts` 并捕获请求）
- [x] 父 Agent用户、助手、工具消息不会进入定义式历史。（验证：父历史放入唯一标记并断言子请求不包含）
- [x] 角色正文以固定高优先级模块伴随整个子 Agent生命周期。（验证：捕获多轮请求的 systemPrompt）
- [x] 定义式子 Agent包含 BetterCode 固定安全约束、环境信息和任务模式。（验证：检查首轮 System Prompt 与 runtime reminder）
- [x] 定义式不继承父 Agent临时 Skill 激活状态或 Skill 指令。（验证：父激活 Skill 后创建 defined，捕获子请求）
- [x] 定义式不继承父 Agent会话级临时权限规则。（验证：父 session allow 后，子 default 对同一工具仍拒绝）
- [x] inherit 使用当前父 Provider。（验证：创建 inherit 角色并比较 Provider 实例名称）
- [x] haiku/sonnet/opus 使用配置映射 Provider，并复用已有 Provider 实例。（验证：运行模型解析与 Provider cache 测试）
- [x] 角色 max_iterations 独立限制子 Agent，不改变父 Agent上限。（验证：用持续工具调用 Provider 命中角色上限）
- [x] 前台自然完成时最终文本作为当前 agent ToolResult 回灌父历史。（验证：检查父 assistant/tool 配对和下一轮请求）
- [x] 前台异常、无最终文本、上下文错误或迭代上限返回稳定子 Agent失败结果。（验证：运行各停止原因表格测试）
- [x] 子 Agent中间 text/thinking 不混入主 MessageList 或主 assistant 消息。（验证：运行 UI/Chat 集成测试并检查展示历史）

## Fork 子 Agent 与缓存

- [x] Fork 从父 Agent最近一次实际发送的 ProviderRequest 创建。（验证：捕获父请求与 Fork spec）
- [x] Fork System Prompt 与父请求完全一致。（验证：对两个 systemPrompt 做严格相等断言）
- [x] 父 messages 是 Fork 首次请求 messages 的原样前缀。（验证：逐项深比较前缀）
- [x] Fork 不包含产生当前 agent 调用的未配对助手消息。（验证：用唯一 toolCallId 搜索 Fork history，期望不存在）
- [x] Fork 不构造伪造工具结果或孤立 tool message。（验证：运行消息配对验证器）
- [x] Fork task 追加在父消息前缀之后，不改写父用户原文。（验证：检查 Fork 请求尾部）
- [x] Fork 不注入定义式角色正文，不切换 Provider。（验证：捕获 System 与 Provider）
- [x] Fork 始终后台执行，调用方不能要求前台。（验证：运行合法/非法 fork 参数测试与任务状态断言）
- [x] Fork 使用全局最大迭代数。（验证：持续工具调用直到配置上限）
- [x] Fork 继承父 Agent mode，Plan Mode 下仍为只读。（验证：父 plan 创建 Fork 并伪造写调用）
- [x] Fork 继承父权限模式但不继承父 session 临时规则。（验证：分别检查 mode 和同一工具授权）
- [x] Anthropic cache creation/read 字段进入 Fork 任务用量。（验证：运行 `pnpm exec tsx --test src/provider/anthropic.test.ts src/subagent/integration.test.ts`）
- [x] OpenAI cached token 字段进入 Fork 任务 cacheReadInputTokens。（验证：运行 `pnpm exec tsx --test src/provider/openai.test.ts src/subagent/integration.test.ts`）
- [x] Provider 不返回缓存字段时任务仍完成，缓存用量为零。（验证：运行无 cache usage 场景）

## 权限与运行时隔离

- [x] 每个子 Agent拥有独立 Message history、ContextManager 和 Token 累计。（验证：并发两个任务并比较状态对象）
- [x] 每个子 Agent拥有独立 PermissionManager 和 session rule map。（验证：一个子任务增加临时规则，另一个仍未命中）
- [x] 每个子 Agent拥有独立 AbortController、迭代数和停止原因。（验证：取消一个任务，另一个继续完成）
- [x] Provider 客户端、Hook 规则、MCP 连接和文件系统可以共享使用。（验证：两个任务复用同一 fake Provider/MCP/Hook 实例完成）
- [x] strict 模式未明确允许的工具立即拒绝且不弹权限 UI。（验证：运行 strict 子 Agent并断言 decider 调用为零）
- [x] default 模式未命中规则立即作为 PERMISSION_DENIED 回灌，不等待用户。（验证：运行 default 子 Agent并检查工具结果与耗时）
- [x] 子 Agent收到权限拒绝后可继续下一轮并改用其他工具完成。（验证：脚本 Provider 先调用拒绝工具再调用允许工具）
- [x] allow 模式仍受危险命令黑名单约束。（验证：尝试已知高危命令，期望 DANGEROUS_COMMAND）
- [x] allow 模式仍受项目路径沙箱约束。（验证：尝试绝对路径、`..` 和符号链接逃逸）
- [x] allow 模式仍受明确 deny 权限规则和 Hook deny 约束。（验证：分别配置 deny 并观察实现调用为零）
- [x] 子 Agent不发出 permission_request UI 事件。（验证：订阅任务事件和主 Agent事件，计数为零）
- [x] 子 Agent不能暂停等待用户输入，信息不足时只能输出受限结果并结束。（验证：脚本 Provider 输出询问文本且不调用工具，任务自然终止）

## Agent Loop 停止条件

- [x] 模型不再请求工具时任务自然完成。（验证：运行单轮文本 Provider）
- [x] 达到定义式角色最大迭代数时任务失败并记录 max_iterations。（验证：持续工具调用场景）
- [x] 达到 Fork 全局最大迭代数时任务失败并记录 max_iterations。（验证：Fork 持续工具调用场景）
- [x] 父任务取消且子任务仍前台时，子任务停止为 cancelled。（验证：前台等待时 abort 父 signal）
- [x] 连续未知工具达到上限时任务停止为 unknown_tool_limit。（验证：脚本 Provider 连续调用未知工具）
- [x] ContextManager blocked 时任务停止为 context_error。（验证：注入 blocked ContextManager）
- [x] Provider 流错误时任务停止为 stream_error。（验证：注入 error stream）
- [x] 任一停止原因都写入任务记录并产生唯一终态事件。（验证：遍历停止原因表格并统计 finished 事件）
- [x] TaskManager 捕获 operation reject，不产生未处理 Promise rejection。（验证：监听 unhandledRejection 并运行抛错 operation）

## 前后台切换

- [x] defined 显式 background 调用立即返回任务 ID，不等待 Provider 完成。（验证：使用挂起 Provider 测量工具返回先后顺序）
- [x] Fork 从创建时即为 background，backgroundReason 为 fork。（验证：查看 Fork task snapshot）
- [x] 前台等待达到配置阈值后自动转后台，reason 为 timeout。（验证：使用短测试阈值运行挂起任务）
- [x] 前台运行时调用手动切换后立即返回任务 ID，reason 为 manual。（验证：调用 ChatManager 控制接口）
- [x] `Ctrl+B` 使用手动切换接口，不重启任务。（验证：运行 UI 控制测试并检查 Provider/工具调用次数）
- [x] 三种转后台方式都保持同一 task ID、历史、Token 和已执行工具次数。（验证：分别运行并比较切换前后快照）
- [x] 转后台不会 abort 子 Agent自身 signal。（验证：切换后让挂起 Provider继续并完成）
- [x] 转后台后解除父 signal，随后取消父任务不会取消后台子 Agent。（验证：manual/timeout 后 abort 父 signal）
- [x] 未转后台的前台子 Agent随父 signal 取消。（验证：前台运行时直接 abort）
- [x] 一个 session 同时最多一个可切换前台任务。（验证：尝试并发创建两个 foreground，观察第二个不占 pointer）
- [x] 没有前台任务时 `Ctrl+B` 和控制接口无副作用。（验证：调用后任务列表和 UI 状态不变）
- [x] 重复转后台只第一次成功，不重复发布 backgrounded 事件。（验证：连续两次调用并统计事件）
- [x] 已开始副作用工具在切换后只执行一次。（验证：长工具中途切换并统计实现调用）

## 后台任务管理

- [x] 每个任务获得唯一 `sa-` 前缀 ID。（验证：批量创建任务并检查格式和唯一性）
- [x] 任务状态按 waiting、running、completed/failed/cancelled 单向转换。（验证：运行 `pnpm exec tsx --test src/subagent/task-manager.test.ts`）
- [x] 终态不可被重复完成、迟到 usage 或迟到 error 覆盖。（验证：终态后手动发送迟到事件）
- [x] 任务记录包含类型、角色/Fork、来源、session、时间、后台原因、停止原因、迭代和用量。（验证：查看完整 task snapshot）
- [x] 多个后台任务可并行运行。（验证：用 barrier 同时启动至少两个任务）
- [x] 一个后台任务失败不取消其他任务或主 Agent。（验证：一任务 reject、一任务完成，主请求继续）
- [x] listener 抛错不影响其他订阅者或任务状态。（验证：注册抛错 listener 与正常 listener）
- [x] 事件包含 created、started、progress、tool call/result、usage、backgrounded 和 finished。（验证：运行完整任务并检查事件序列）
- [x] 任务事件发布只读快照，listener 修改不会改变内部记录。（验证：尝试修改事件对象并重新查询）
- [x] 终态任务超过保留上限时淘汰最旧终态，运行任务不被淘汰。（验证：配置小上限并创建多任务）
- [x] cancelSession 只取消指定 session 的未完成任务。（验证：两个 session 并发任务后取消一个）
- [x] close 取消全部任务并等待 settle，不留下运行 Promise。（验证：关闭后检查所有任务终态）

## 后台结果回流

- [x] 只有进入后台的终态任务进入结果收件箱。（验证：前台与后台各完成一个，检查 inbox）
- [x] completed、failed 和正常后台 cancelled 都可形成对应状态摘要。（验证：运行三种终态格式测试）
- [x] 会话替换或应用关闭导致的取消不回流新会话。（验证：clear/resume/close 迟到场景）
- [x] 回流消息包含任务 ID、状态、停止原因、摘要和 Token 用量。（验证：解析 subagent_result 内容）
- [x] 子 Agent输出中的同名标签被转义，不能闭合外层结果标签。（验证：输出恶意标签并检查消息结构）
- [x] 单条回流消息限制 4 KiB，完整任务结果限制 64 KiB。（验证：输入超长 UTF-8 文本并检查字节上限）
- [x] 多个结果按完成顺序排队。（验证：逆创建顺序完成任务并检查 inbox）
- [x] prepare 不删除结果，commit 只消费 throughId 及之前条目。（验证：运行 `pnpm exec tsx --test src/subagent/result-inbox.test.ts`）
- [x] ContextManager blocked 或 cancelled 时结果不 commit。（验证：运行 AgentLoop 两阶段失败测试）
- [x] Provider 请求 ready 后结果恰好 commit 一次。（验证：多轮 AgentLoop 检查注入次数）
- [x] 后台完成本身不新增 Provider 调用、不唤醒主 Agent。（验证：记录完成前后 Provider 调用计数）
- [x] 当前主 Agent若自然发生后续迭代，会在下一请求读取结果。（验证：后台完成与其他工具调用并行场景）
- [x] 当前主 Agent已结束时，结果保留到下一次用户任务请求。（验证：完成后启动新 turn，检查首请求）
- [x] 已消费结果进入主 history，并在后续轮次保持可见。（验证：检查 AgentOutcome.history 与下一请求）
- [x] 主 Agent不会把结果消息当作用户原始输入或增加 turnCount。（验证：检查 role/instructionKind 与 turnCount）

## 会话、上下文与回滚

- [x] subagent_result 以 system 类型持久化，不伪装成 user/assistant。（验证：读取 session JSONL）
- [x] 会话恢复把合法结果恢复为 instructionKind=subagent_result。（验证：运行 `pnpm exec tsx --test src/session/session.test.ts`）
- [x] 损坏或未知 system type 不进入恢复 history。（验证：写入非法 JSONL 记录并恢复）
- [x] compact boundary 之前的结果不重复恢复，由摘要代表。（验证：构造 boundary 前结果并恢复）
- [x] compact boundary 之后的结果原样恢复。（验证：构造 boundary 后结果并恢复）
- [x] 恢复 UI 将结果显示为后台任务系统通知，不冒充模型回答。（验证：运行 UI/session 集成测试）
- [x] clear 先取消旧任务、丢弃旧 inbox，再创建新 session。（验证：运行 ChatManager clear 时序测试）
- [x] resume 先取消当前 session 任务，旧任务迟到结果不写入恢复会话。（验证：运行 ChatManager resume 迟到测试）
- [x] close 取消子任务后再关闭 Hook、Skill、MCP 依赖。（验证：运行入口/Chat 关闭顺序测试）
- [x] 子 Agent write_file/edit_file 被 FileHistory 跟踪。（验证：后台子 Agent改文件后查看 snapshot）
- [x] rewind 可以恢复子 Agent修改的文件。（验证：运行写入、完成、rewind，比较文件原文）
- [x] 结果进入上下文后可参与既有轻量卸载和重量摘要，不破坏消息配对。（验证：运行 context 与 subagent result 组合测试）

## Hook 子 Agent

- [x] 旧 `{type: agent, prompt}` 配置继续通过编译。（验证：运行 `pnpm exec tsx --test src/hook/compiler.test.ts`）
- [x] Hook agent 可选 role 字段合法时生效，缺省使用 general。（验证：运行 action executor 与集成测试）
- [x] 空 role、未知 action 字段、agent timeout_ms 和 pre_tool_use agent 在启动校验失败。（验证：运行 Hook compiler 非法配置测试）
- [x] 同步 Hook agent 等候角色任务完成并返回 output。（验证：运行同步 Hook action 场景）
- [x] background Hook agent 立即返回 task ID，并进入统一 TaskManager。（验证：运行后台 Hook action 场景并用 `/tasks` 查询）
- [x] 同步 Hook agent 超过全局阈值后自动转后台。（验证：用短阈值和挂起 Provider 运行）
- [x] Hook agent 使用同一角色、模型、权限、工具过滤和取消语义。（验证：指定受限角色运行 Hook 子任务）
- [x] Hook agent失败只记录 Hook 日志，不改变主 Agent、session 或 system 生命周期结果。（验证：运行无效角色、流错误和取消场景）
- [x] `pre_tool_use` 仍不能通过 agent action 参与 allow/deny 决策。（验证：编译拒绝且工具权限测试保持）
- [x] 子 Agent使用捕获的 session/turn/agent Hook 上下文。（验证：后台任务在父 turn 结束后触发 post_tool_use 并检查模板字段）
- [x] 两个并发子 Agent的 Hook Prompt 队列互不串线。（验证：每个 scope 注入唯一 prompt 并捕获请求）
- [x] 子 Agent scoped Hook 不重复发布 system/session/turn/user_message。（验证：统计完整父子生命周期事件）
- [x] Hook once 状态在主 Agent和 scoped runtime 间共享。（验证：同一 once 规则在两个 scope 仅成功一次）
- [x] 子 Agent Hook 再触发 agent action 时记录 NESTED_AGENT_FORBIDDEN，Provider 不新增调用。（验证：运行递归 Hook 场景）
- [x] 无 agent action 的 command、prompt、HTTP、deny 和日志行为保持不变。（验证：运行全部 Hook 既有测试）

## `/tasks` 与 TUI

- [x] `/help` 展示 `/tasks [任务 ID]` 及中文说明。（验证：运行 `pnpm exec tsx --test src/command/builtins.test.ts`）
- [x] `/tasks` 无任务时显示明确空状态。（验证：调用命令并观察消息）
- [x] `/tasks` 按创建时间倒序列出当前 session 任务摘要。（验证：创建多任务后调用命令）
- [x] `/tasks <id>` 显示状态、类型/角色、后台原因、停止原因、迭代和 Token/cache。（验证：查看完成任务详情）
- [x] `/tasks <未知ID>` 给出明确错误并引导使用 `/tasks`。（验证：运行未知 ID 命令测试）
- [x] `/tasks` 不通过 LLM，不增加 Provider 调用或 Token。（验证：记录命令前后 Provider 调用计数）
- [x] TUI 在任务转后台时立即显示任务 ID。（验证：运行 `pnpm exec tsx --test src/ui/app.test.ts`）
- [x] TUI 在后台任务完成、失败或取消时显示一次终态通知。（验证：发布三类 task_finished 事件）
- [x] 前台任务完成不重复显示后台通知。（验证：完成 foreground 并检查 MessageList）
- [x] TUI 不显示子 Agent中间 text/thinking 为主对话消息。（验证：发布中间流事件并检查展示状态）
- [x] 有前台子 Agent时显示 Ctrl+B 提示。（验证：切换 hasForeground 状态并检查渲染文本）
- [x] Ctrl+B 将当前前台子 Agent转后台并显示成功消息。（验证：运行 UI 键盘控制测试）
- [x] 无前台任务时 Ctrl+B 无错误、无虚假成功消息。（验证：运行空状态键盘测试）
- [x] Ctrl+C 取消当前主任务的既有行为不变。（验证：运行 UI Ctrl+C 回归测试）
- [x] 角色启动诊断可见，单个无效角色不会阻止 TUI 启动。（验证：注入角色诊断渲染 App）
- [x] `/status` 显示当前 session 的运行/已结束子任务数量。（验证：调用 status 并检查格式）

## 启动、关闭与动态工具

- [x] AgentTool 在 SkillManager 捕获 base tools 之前注册。（验证：启动集成测试中 shared Skill 可见 agent）
- [x] 主上下文和 shared Skill 可以看到 agent 系统工具。（验证：检查无 Skill 与 shared Skill Provider tools）
- [x] isolated Skill 看不到 agent，伪造调用也不能执行。（验证：运行 `pnpm exec tsx --test src/skill/runner.test.ts src/skill/agent-integration.test.ts`）
- [x] 子 Agent运行期间 Skill 专属工具不会被热更新卸载。（验证：运行任务时触发 Skill reload，观察延后）
- [x] Skill reload 完成后角色工具引用被重新校验。（验证：新增/删除专属工具并观察角色快照）
- [x] HookManager 在任何 Hook agent action 触发前已连接 Coordinator。（验证：system_start agent Hook 启动测试）
- [x] 子 Agent关闭后才关闭 Hook/Skill/MCP 共享基础设施。（验证：记录各 close 调用顺序）
- [x] 单个 MCP Server 失败时，不引用其工具的角色和子 Agent仍可运行。（验证：模拟部分 MCP 初始化失败）
- [x] 角色引用未注册的失败 MCP 工具时只禁用该角色。（验证：检查 definition diagnostics）
- [x] 应用关闭后没有运行的子 Agent任务、watcher 或计时器阻止进程退出。（验证：运行 close 测试并检查 active handles）

## 编译与回归

- [x] TypeScript strict 类型检查通过。（验证：运行 `pnpm typecheck`）
- [x] 全部自动化测试通过。（验证：运行 `pnpm test`）
- [x] 完整检查命令通过。（验证：运行 `pnpm check`）
- [x] Git diff 没有行尾空格或冲突标记。（验证：运行 `git diff --check`）
- [x] AgentLoop 在没有 system/tool override、instruction runtime 和 execution state 时请求结构保持不变。（验证：运行 AgentLoop 既有回归测试）
- [x] 主 Agent交互式权限确认、session allow 和 permanent allow 行为保持不变。（验证：运行全部 permission 测试）
- [x] ToolRegistry 超时、取消、输出限制和普通工具行为保持不变。（验证：运行全部 tool 测试）
- [x] Plan Mode、未知工具上限和多工具安全调度保持不变。（验证：运行全部 agent 测试）
- [x] Skill shared/isolated、热更新和 load_skill 行为保持不变。（验证：运行全部 skill 测试）
- [x] Hook command/prompt/HTTP、once、background 和 deny 行为保持不变。（验证：运行全部 hook 测试）
- [x] Context 轻量卸载、重量摘要、熔断和手动压缩保持不变。（验证：运行全部 context 测试）
- [x] Session clear/resume、compact boundary 和过期清理保持不变。（验证：运行全部 session/chat 测试）
- [x] Memory 提取、持久化和指令加载保持不变。（验证：运行全部 memory 测试）
- [x] MCP stdio/HTTP、工具适配和单 Server 故障隔离保持不变。（验证：运行全部 mcp 测试）
- [x] Anthropic 与 OpenAI 兼容 Provider 的流式文本、工具 JSON 和 usage 解析保持通过。（验证：运行全部 provider 测试）

## 端到端场景

- [x] **场景 1：定义式前台研究。** 主 Agent调用 general 子 Agent，子 Agent从空历史读取代码并自然完成，父 Agent收到单个有界 ToolResult。（验证：运行定义式前台集成场景；覆盖 AC1、AC2、AC5、AC10）
- [x] **场景 2：非交互权限调整。** default 子 Agent先调用未授权工具收到拒绝，再改用允许的只读工具完成，全程不出现权限弹窗。（验证：运行权限恢复场景；覆盖 AC8）
- [x] **场景 3：Plan Mode 委派。** 主 Agent在 Plan Mode 调用定义式子 Agent，模型伪造写工具仍被拒绝，最终只返回计划或分析。（验证：运行 Plan Mode 集成场景；覆盖 AC9、AC17）
- [x] **场景 4：Ctrl+B 转后台。** 前台子 Agent执行期间手动转后台，父 Agent立即拿到任务 ID，子任务继续且后续工具收窄，完成时界面通知但不唤醒模型。（验证：运行手动后台集成场景；覆盖 AC11、AC12、AC14）
- [x] **场景 5：超时自动转后台。** 使用短测试阈值验证自动转换不重启任务，最终结果在下一自然请求恰好回流一次。（验证：运行 timeout + inbox 场景；覆盖 AC11、AC13）
- [x] **场景 6：并发后台隔离。** 同时运行两个子 Agent，一个失败、一个成功；消息、权限、缓存、Token、取消和 Hook Prompt 不串线。（验证：运行并发集成场景；覆盖 AC7、AC12、AC16）
- [x] **场景 7：Fork 缓存。** Fork 继承父请求合法前缀和工具顺序，不含当前 agent 调用；模拟 Provider 返回 cache hit 并在 `/tasks <id>` 可见。（验证：运行 Fork cache 场景；覆盖 AC6）
- [x] **场景 8：会话替换。** 后台任务运行时 clear 或 resume，旧任务取消，迟到结果不进入新会话；已消费结果可从原 session 恢复。（验证：运行会话生命周期场景；覆盖 AC12、AC13）
- [x] **场景 9：Hook agent。** 旧格式 Hook 使用 general 真实运行，指定 role 与 background 也生效；失败只写日志，子 Agent内递归 Hook 被拒绝。（验证：运行 Hook agent 集成场景；覆盖 AC15）
- [x] **场景 10：子 Agent文件回滚。** 后台角色获明确写权限后修改项目文件，任务完成可查询，FileHistory rewind 恢复原文。（验证：运行文件修改与 rewind 场景；覆盖 AC7、AC18 范围边界）
- [x] **场景 11：无子 Agent 回归。** 运行普通聊天、工具、Skill、Hook、上下文压缩、记忆和会话恢复，Provider 请求和用户行为与本章前一致。（验证：运行 `pnpm check`；覆盖 AC17）
- [x] **场景 12：范围边界。** 重启 BetterCode 后旧后台任务不恢复，项目中不创建 Worktree，子 Agent看不到 agent/load_skill，也不提供团队编排。（验证：启动关闭集成测试与文件系统检查；覆盖 AC18）

## Spec 验收覆盖

| Spec 验收标准 | Checklist 覆盖章节 |
|---------------|--------------------|
| AC1 统一工具稳定性 | 统一 Agent 工具、端到端场景 1 |
| AC2 角色解析 | 角色定义与覆盖、端到端场景 1 |
| AC3 来源覆盖与故障隔离 | 角色定义与覆盖 |
| AC4 模型解析 | 配置与模型档位、定义式子 Agent |
| AC5 定义式隔离 | 定义式子 Agent、端到端场景 1 |
| AC6 Fork 缓存与历史合法性 | Fork 子 Agent与缓存、端到端场景 7 |
| AC7 状态隔离 | 权限与运行时隔离、端到端场景 6 |
| AC8 非交互权限 | 权限与运行时隔离、端到端场景 2 |
| AC9 工具多层过滤 | 工具过滤、端到端场景 3 |
| AC10 自主停止 | Agent Loop 停止条件、端到端场景 1 |
| AC11 后台三路径 | 前后台切换、端到端场景 4-5 |
| AC12 任务状态与隔离失败 | 后台任务管理、端到端场景 6、8 |
| AC13 异步回流 | 后台结果回流、端到端场景 5、8 |
| AC14 任务查询与手动控制 | `/tasks` 与 TUI、端到端场景 4 |
| AC15 Hook Agent 落地 | Hook 子 Agent、端到端场景 9 |
| AC16 事件与安全边界 | 后台任务管理、后台结果回流、端到端场景 6 |
| AC17 兼容回归 | 编译与回归、端到端场景 11 |
| AC18 范围确认 | 文档与范围、端到端场景 10、12 |
