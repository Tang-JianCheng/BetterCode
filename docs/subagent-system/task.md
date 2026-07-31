# BetterCode 子 Agent 系统 Tasks

## 执行规则

- 严格按依赖顺序执行；每项先完成实现与测试，再运行该项验证命令。
- 新增源码注释使用中文，用户可见名称统一为 BetterCode。
- 不修改、暂存或提交项目根目录现有 `.bettercode/` 运行数据。
- 单项验证失败时先修复当前项，不带着失败进入后续任务。
- 本大型 Plan 全部验收通过后执行一次中文 Git 阶段性提交，不推送远程。

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `agents/general.md` | 内置通用定义式角色 |
| 新建 | `src/subagent/types.ts` | 角色、任务、事件、运行契约 |
| 新建 | `src/subagent/parser.ts` | 角色 frontmatter 与正文解析 |
| 新建 | `src/subagent/parser.test.ts` | 角色解析测试 |
| 新建 | `src/subagent/loader.ts` | 四来源发现、覆盖和诊断 |
| 新建 | `src/subagent/loader.test.ts` | 来源覆盖测试 |
| 新建 | `src/subagent/definition-manager.ts` | 工具/模型校验、快照和热更新 |
| 新建 | `src/subagent/definition-manager.test.ts` | 定义管理测试 |
| 新建 | `src/subagent/agent-tool.ts` | 固定 `agent` 系统工具 |
| 新建 | `src/subagent/agent-tool.test.ts` | Agent 工具参数与稳定性测试 |
| 新建 | `src/subagent/tool-filter.ts` | 定义式与 Fork 工具收窄 |
| 新建 | `src/subagent/tool-filter.test.ts` | 工具过滤测试 |
| 新建 | `src/subagent/task-manager.ts` | 状态机、前后台切换、取消与事件 |
| 新建 | `src/subagent/task-manager.test.ts` | 任务生命周期测试 |
| 新建 | `src/subagent/result-inbox.ts` | 后台结果排队和两阶段消费 |
| 新建 | `src/subagent/result-inbox.test.ts` | 结果回流队列测试 |
| 新建 | `src/subagent/prompts.ts` | 定义式 System Prompt 和 Fork task |
| 新建 | `src/subagent/prompts.test.ts` | 子 Agent 提示测试 |
| 新建 | `src/subagent/runner.ts` | 隔离 AgentLoop 运行器 |
| 新建 | `src/subagent/runner.test.ts` | 定义式/Fork 运行测试 |
| 新建 | `src/subagent/coordinator.ts` | Tool 与 Hook 统一调度入口 |
| 新建 | `src/subagent/coordinator.test.ts` | 调度与 ToolResult 测试 |
| 新建 | `src/subagent/integration.test.ts` | 前后台、Fork、回流端到端测试 |
| 新建 | `src/subagent/format.ts` | `/tasks` 和通知格式化 |
| 新建 | `src/tool/execution-state.ts` | 每 Agent 文件读取缓存 |
| 新建 | `src/tool/execution-state.test.ts` | 读取缓存测试 |
| 修改 | `src/config/types.ts` | 模型档位与子 Agent 配置类型 |
| 修改 | `src/config/loader.ts` | 全局配置校验与默认值 |
| 修改 | `src/config/loader.test.ts` | 子 Agent 配置测试 |
| 修改 | `src/tool/types.ts` | 执行状态和子 Agent错误码 |
| 修改 | `src/tool/registry.ts` | 下传 ToolExecutionState |
| 修改 | `src/tool/registry.test.ts` | 执行状态透传测试 |
| 修改 | `src/tool/tools/read-file.ts` | stat 指纹读取缓存 |
| 修改 | `src/tool/tools.test.ts` | 读取缓存行为测试 |
| 修改 | `src/agent/types.ts` | 固定 System/Tools 请求覆盖 |
| 修改 | `src/agent/loop.ts` | 请求快照、结果指令提交、执行时工具重算 |
| 修改 | `src/agent/loop.test.ts` | AgentLoop 新扩展与兼容测试 |
| 修改 | `src/agent/tool-scheduler.ts` | 执行状态下传和副作用缓存失效 |
| 修改 | `src/agent/tool-scheduler.test.ts` | 工具执行可见性和缓存失效测试 |
| 修改 | `src/permission/factory.ts` | PermissionManagerFactory 类型 |
| 修改 | `src/provider/types.ts` | `subagent_result` 指令类型 |
| 修改 | `src/prompt/sections.ts` | 子 Agent 结果标签约束 |
| 修改 | `src/prompt/builder.test.ts` | 系统提示模块回归测试 |
| 修改 | `src/hook/types.ts` | Agent scope、action role 和失败码 |
| 修改 | `src/hook/field.ts` | Hook agent 字段读取与校验 |
| 修改 | `src/hook/compiler.ts` | agent action 可选 role |
| 修改 | `src/hook/action-executor.ts` | 真实 Hook 子 Agent执行 |
| 修改 | `src/hook/manager.ts` | scoped HookRuntime 与独立 Prompt 队列 |
| 修改 | `src/hook/*.test.ts` | Hook scope、action 和回归测试 |
| 修改 | `src/skill/manager.ts` | agent 可见性和动态工具租约 |
| 修改 | `src/skill/manager.test.ts` | Skill 与 Agent 工具边界测试 |
| 修改 | `src/skill/runner.ts` | 独立 Skill 禁止 Agent 嵌套 |
| 修改 | `src/skill/runner.test.ts` | 独立 Skill 回归测试 |
| 修改 | `src/chat/manager.ts` | Coordinator、Inbox、任务控制和会话清理 |
| 修改 | `src/chat/manager.test.ts` | Chat 集成与会话边界测试 |
| 修改 | `src/session/session.ts` | 子 Agent 结果持久化与恢复 |
| 修改 | `src/session/session.test.ts` | 结果消息与压缩边界测试 |
| 修改 | `src/command/types.ts` | 任务查询 UI 控制接口 |
| 修改 | `src/command/builtins.ts` | `/tasks` 命令 |
| 修改 | `src/command/builtins.test.ts` | `/tasks` 分发测试 |
| 修改 | `src/ui/app.tsx` | 通知、诊断、`Ctrl+B` 和状态展示 |
| 修改 | `src/ui/app.test.ts` | 格式化和控制逻辑测试 |
| 修改 | `src/index.tsx` | 完整启动与关闭编排 |
| 修改 | `README.md` | 用户配置、角色、工具、后台与安全边界 |
| 新建 | `changelogs/pending.md` | 本阶段中文变更摘要，提交前按仓库约定归档 |
| 新建 | `docs/subagent-system/checklist.md` | 编码前定义验收项目，开发后记录证据 |

## T1：增加子 Agent 配置类型

**文件：** `src/config/types.ts`、`src/subagent/types.ts`

**依赖：** 无

**步骤：**
1. 定义 `AgentModelTier`、`AgentModelAliases`、`SubAgentConfig` 和 `ResolvedSubAgentOptions`。
2. 扩展 AppConfig 的 `agent_models` 与 `subagents` 可选字段，保持现有 providers 字段兼容。
3. 在 subagent types 中定义不可配置禁用工具常量，包含 `agent` 和 `load_skill`。
4. 定义默认值：前台超时 120000 毫秒、Fork 10 轮、保留 100 个终态任务。

**验证：** 运行 `pnpm typecheck`，期望配置和子 Agent基础类型编译通过，现有调用方无需修改即可继续编译。

## T2：校验并解析子 Agent 全局配置

**文件：** `src/config/loader.ts`、`src/config/loader.test.ts`

**依赖：** T1

**步骤：**
1. 校验 `agent_models` 只能包含 haiku、sonnet、opus，值必须是非空 Provider 名称。
2. 校验 `subagents` 的超时、最大迭代、保留数量和 denied_tools 类型与范围。
3. 将 denied_tools 归一化、去重，并与不可配置禁用工具合并。
4. 保持缺省配置与当前行为兼容，不强制用户配置三个模型档位。
5. 增加合法、缺省、未知字段、错误范围、重复工具和错误类型测试。

**验证：** 运行 `pnpm exec tsx --test src/config/loader.test.ts`，期望新增与既有配置测试全部通过。

## T3：定义角色和任务领域契约

**文件：** `src/subagent/types.ts`

**依赖：** T1

**步骤：**
1. 定义角色 scope、metadata、definition、diagnostic、snapshot 和加载结果类型。
2. 定义 AgentToolInput 的 defined/fork 联合类型。
3. 定义任务 kind、state、execution mode、background reason、record 和 snapshot。
4. 定义 SubAgentEvent、Runner spec、HookAgentRunner 和结果收件箱契约。
5. 所有集合与快照使用 readonly，避免调用方修改共享状态。

**验证：** 运行 `pnpm typecheck`，期望领域类型无循环运行时依赖且编译通过。

## T4：实现角色文档解析器

**文件：** `src/subagent/parser.ts`、`src/subagent/parser.test.ts`

**依赖：** T3

**步骤：**
1. 复用 YAML 库拆分 frontmatter 与 Markdown 正文。
2. 严格限制 name、description、tools、disallowed_tools、background_tools、model、max_iterations、permission_mode 字段。
3. 区分 tools 缺省与显式空数组，其他工具数组归一化并去重。
4. 校验角色名、非空正文、模型档位、权限模式和最大轮次范围。
5. 提供名称预提取函数，让损坏定义仍可参与同名覆盖判定。
6. 覆盖完整定义、缺字段、未知字段、空正文、错误数组、错误枚举和重复工具测试。

**验证：** 运行 `pnpm exec tsx --test src/subagent/parser.test.ts`，期望全部角色解析测试通过。

## T5：实现四来源角色加载

**文件：** `src/subagent/loader.ts`、`src/subagent/loader.test.ts`

**依赖：** T4

**步骤：**
1. 扫描插件贡献目录、内置 agents、用户 `.bettercode/agents` 和项目 `.bettercode/agents`。
2. 支持 `*.md` 与 `*/AGENT.md` 两种入口格式，路径稳定排序。
3. 按 plugin、builtin、user、project rank 分组选择最高优先级候选。
4. 同层重复或最高层解析失败时禁用名称并记录诊断，不回退低层。
5. 实现目录指纹，包含相对路径、大小和 mtime。
6. 测试四级覆盖、多个插件目录、同层重复、损坏高层不回退和其他角色继续加载。

**验证：** 运行 `pnpm exec tsx --test src/subagent/loader.test.ts`，期望来源覆盖测试全部通过。

## T6：添加内置 general 角色

**文件：** `agents/general.md`、`src/subagent/parser.test.ts`

**依赖：** T4

**步骤：**
1. 编写 BetterCode 通用子 Agent身份、职责、非交互和结果摘要要求。
2. 前台 tools 缺省为完整可用集合，黑名单为空。
3. background_tools 只列 `read_file`、`find_files`、`search_code`。
4. 模型使用 inherit，最大轮次 10，权限模式 default。
5. 在 parser 测试中读取真实内置文件并验证可解析。

**验证：** 运行 `pnpm exec tsx --test src/subagent/parser.test.ts`，期望内置 general 定义通过真实文件解析。

## T7：实现角色定义管理与能力校验

**文件：** `src/subagent/definition-manager.ts`、`src/subagent/definition-manager.test.ts`

**依赖：** T2、T5、T6

**步骤：**
1. 在 loader 结果上验证白名单、黑名单和后台白名单中的工具存在。
2. 禁止角色引用 immutable/global denied 工具，并记录 FORBIDDEN_TOOL。
3. 校验 haiku/sonnet/opus 映射存在且目标 Provider 名称有效；inherit 不需要映射。
4. 只禁用失败角色，发布 revision、definitions、disabledNames 和 diagnostics 快照。
5. 实现 get、getSnapshot、resolveProviderName 和 subscribe。
6. 测试未知工具、禁用工具、缺模型映射、合法 inherit、同 Provider 解析和部分成功快照。

**验证：** 运行 `pnpm exec tsx --test src/subagent/definition-manager.test.ts`，期望定义校验测试全部通过。

## T8：实现角色热更新

**文件：** `src/subagent/definition-manager.ts`、`src/subagent/definition-manager.test.ts`

**依赖：** T7

**步骤：**
1. 根据 loader fingerprint 启动 unref 轮询。
2. 文件变化时重新加载并发布新快照，单角色错误仍发布部分成功结果。
3. 保证旧 definition 对象不被原地修改，运行方持有的快照保持稳定。
4. close 时停止 watcher 并清空 listener。
5. 测试新增、覆盖、损坏、修复和运行快照不随 reload 改变。

**验证：** 运行 `pnpm exec tsx --test src/subagent/definition-manager.test.ts`，期望热更新与快照隔离测试通过。

## T9：实现固定 Agent 系统工具

**文件：** `src/subagent/agent-tool.ts`、`src/subagent/agent-tool.test.ts`、`src/tool/types.ts`

**依赖：** T3

**步骤：**
1. 定义固定名称 `agent`、统一描述和稳定四字段 Schema。
2. 将工具标记为 read_only 和 system orchestration 用途的 arguments 权限描述。
3. 严格校验 defined 需要 role、fork 禁止 role/background、task 必须非空。
4. 合法调用只返回 dispatch metadata，不直接调用 Provider 或 Coordinator。
5. 增加 SUBAGENT_UNAVAILABLE、SUBAGENT_CONTEXT_ERROR、SUBAGENT_FAILED 错误码。
6. 测试 Schema 快照、合法两类型和所有非法组合。

**验证：** 运行 `pnpm exec tsx --test src/subagent/agent-tool.test.ts`，期望 Agent 工具稳定性测试通过。

## T10：实现多层工具过滤

**文件：** `src/subagent/tool-filter.ts`、`src/subagent/tool-filter.test.ts`

**依赖：** T3、T7、T9

**步骤：**
1. 计算定义式前台集合：Registry 顺序减全局禁用，再应用白名单和黑名单。
2. 计算定义式后台集合：前台集合与 background_tools 交集。
3. 计算 Fork ToolDefinition：保持父顺序并移除全局禁用、agent 和 load_skill。
4. 所有返回集合冻结或复制，调用方不能扩大权限。
5. 测试 tools 缺省、显式空、deny 优先、后台交集、Fork 顺序和永久移除。

**验证：** 运行 `pnpm exec tsx --test src/subagent/tool-filter.test.ts`，期望工具过滤测试全部通过。

## T11：实现每 Agent 文件读取缓存

**文件：** `src/tool/execution-state.ts`、`src/tool/execution-state.test.ts`

**依赖：** T3

**步骤：**
1. 实现以规范化相对路径为 key 的 CachedFileRead map。
2. get 时同时校验 size 和 mtimeMs，指纹不匹配返回 miss 并删除旧值。
3. 实现单路径失效、全量失效和 clear。
4. 返回缓存内容时不暴露内部可变 entry。
5. 测试 hit、size 变化、mtime 变化、单路径失效、全量失效和两个实例隔离。

**验证：** 运行 `pnpm exec tsx --test src/tool/execution-state.test.ts`，期望读取缓存状态测试通过。

## T12：把读取缓存接入 ToolRegistry 和 ReadFileTool

**文件：** `src/tool/types.ts`、`src/tool/registry.ts`、`src/tool/tools/read-file.ts`、`src/tool/registry.test.ts`、`src/tool/tools.test.ts`

**依赖：** T11

**步骤：**
1. ToolContext 增加可选 executionState。
2. ToolRegistry.execute 增加可选执行状态参数并下传 ToolContext。
3. ReadFileTool 在 stat 后按 relative path、size、mtime 查询缓存。
4. miss 时读取、UTF-8 校验并写缓存；hit 时仍执行输出大小截断。
5. metadata 增加 cached 布尔值，不改变原 path、bytes、truncated 字段。
6. 测试 Registry 透传、首次 miss、二次 hit、外部改动 miss 和无 executionState 兼容行为。

**验证：** 运行 `pnpm exec tsx --test src/tool/registry.test.ts src/tool/tools.test.ts`，期望工具层测试通过。

## T13：把执行状态和缓存失效接入 ToolScheduler

**文件：** `src/agent/tool-scheduler.ts`、`src/agent/tool-scheduler.test.ts`

**依赖：** T12

**步骤：**
1. ToolScheduler 构造函数接收可选 ToolExecutionState。
2. Registry.execute 时下传同一执行状态。
3. 成功 write_file/edit_file 后按 path 失效；其他成功 side_effect 全量失效。
4. 失败和取消调用不清理已有读取缓存。
5. 测试路径失效、命令全失效、失败保留和两个 Scheduler 缓存隔离。

**验证：** 运行 `pnpm exec tsx --test src/agent/tool-scheduler.test.ts`，期望调度与缓存失效测试通过。

## T14：构建定义式和 Fork 提示

**文件：** `src/subagent/prompts.ts`、`src/subagent/prompts.test.ts`、`src/prompt/sections.ts`

**依赖：** T3、T6

**步骤：**
1. 用现有 buildSystemPrompt 加入优先级 575 子 Agent约束和 550 角色正文。
2. 保留七个固定模块内容与排序，不改变主 Agent默认构建结果。
3. 构建定义式首条任务和 Fork 追加任务，明确非交互、禁止委派和只输出结果。
4. 在固定系统约束中识别 `<subagent-result>` 为 BetterCode 运行时结果，不当作用户输入。
5. 测试模块顺序、角色正文、BetterCode 名称、无旧名称和 Fork 不修改父 System Prompt。

**验证：** 运行 `pnpm exec tsx --test src/subagent/prompts.test.ts src/agent/prompts.test.ts`，期望提示相关测试通过。

## T15：实现任务状态机基础

**文件：** `src/subagent/task-manager.ts`、`src/subagent/task-manager.test.ts`

**依赖：** T3

**步骤：**
1. 创建 waiting 任务记录、UUID、AbortController 和内部 TaskControl。
2. 启动 operation 后转 running，并捕获 resolve/reject。
3. 将 AgentOutcome 映射为 completed、failed、cancelled 和停止原因。
4. 用终态锁阻止重复完成和迟到覆盖。
5. 实现 get/list 的结构化只读快照。
6. 测试正常完成、异常、取消、重复终态和不同 session 查询隔离。

**验证：** 运行 `pnpm exec tsx --test src/subagent/task-manager.test.ts`，期望基础状态机测试通过。

## T16：实现前台等待和三种转后台

**文件：** `src/subagent/task-manager.ts`、`src/subagent/task-manager.test.ts`

**依赖：** T15

**步骤：**
1. 实现每 session 唯一 foreground pointer 和 waitForeground。
2. 显式后台、Fork、Hook 后台在创建时写 executionMode/backgroundReason，不占 foreground pointer。
3. waitForeground 启动配置阈值 timer，超时调用同一后台转换函数。
4. moveForegroundToBackground 支持 manual/timeout，唤醒前台等待但不 abort operation。
5. 转后台后解除父 signal；未转后台时父 signal 取消子任务。
6. 测试 explicit、fork、timeout、manual、重复切换、无活动任务、转后台后父取消继续。

**验证：** 运行 `pnpm exec tsx --test src/subagent/task-manager.test.ts`，期望三种后台路径测试通过。

## T17：实现任务事件、保留和批量取消

**文件：** `src/subagent/task-manager.ts`、`src/subagent/task-manager.test.ts`

**依赖：** T16

**步骤：**
1. 发布 created、started、progress、tool、usage、backgrounded、finished 事件。
2. 隔离 listener 异常并冻结事件快照。
3. 累计 usage 时覆盖当前任务 Token/cache 字段，忽略终态后的迟到事件。
4. 仅淘汰最旧终态任务，运行中任务不计入 retainedTasks 上限。
5. 实现 cancelSession、cancelAll 和 close，等待 operation settle。
6. 测试事件顺序、listener 抛错、用量、淘汰、会话取消和关闭无裸 Promise。

**验证：** 运行 `pnpm exec tsx --test src/subagent/task-manager.test.ts`，期望事件与生命周期测试通过。

## T18：实现后台结果收件箱

**文件：** `src/subagent/result-inbox.ts`、`src/subagent/result-inbox.test.ts`、`src/provider/types.ts`

**依赖：** T3、T17

**步骤：**
1. InstructionKind 增加 subagent_result。
2. 只接收进入过 background 且拥有有效 session 的终态任务。
3. 构建包含任务 ID、状态、原因、结果摘要和 Token 的 4 KiB 指令。
4. 转义子 Agent输出中的 subagent-result 标签，完整 task result 限制 64 KiB。
5. 实现按 session 的 prepare/commit、完成顺序、discardSession 和 close。
6. 测试成功/失败结果、前台不入队、标签转义、大小限制、两阶段消费和旧 session 清理。

**验证：** 运行 `pnpm exec tsx --test src/subagent/result-inbox.test.ts`，期望结果队列测试通过。

## T19：扩展 AgentLoop 请求覆盖和 ProviderRequest 快照

**文件：** `src/agent/types.ts`、`src/agent/loop.ts`、`src/agent/loop.test.ts`

**依赖：** T3、T10

**步骤：**
1. AgentLoopRequest 增加 systemPrompt 和 toolDefinitions 可选字段。
2. 有 systemPrompt 时替代默认固定 Prompt；无值时保持当前实例行为。
3. 有 toolDefinitions 时保持调用方顺序并固定 names 作为执行白名单。
4. ToolResultTransformInput 增加实际 managed.request 的只读结构化快照。
5. 在每轮 Provider 请求发出前冻结快照，工具结果转换时传同一轮快照。
6. 测试主 Agent默认请求不变、覆盖生效、顺序不变和 transformer 收到准确快照。

**验证：** 运行 `pnpm exec tsx --test src/agent/loop.test.ts`，期望请求覆盖与快照测试通过。

## T20：接入外部指令两阶段提交

**文件：** `src/agent/loop.ts`、`src/agent/loop.test.ts`

**依赖：** T18、T19

**步骤：**
1. AgentLoopRuntime 增加 instructionRuntime 和 onInstructionsCommitted。
2. 每轮 prepare 后把结果 messages 放在 system reminder 之前传给 ContextManager。
3. ContextManager 非 ready 时不 commit、不追加 history。
4. ready 后 commit，通过 managed.history 追加消息，并调用持久化回调。
5. 后续迭代不再重复注入已 commit 消息，但 history 仍可见。
6. 测试 ready 单次消费、blocked/cancelled 保留、后续轮次可见和无 runtime 兼容。

**验证：** 运行 `pnpm exec tsx --test src/agent/loop.test.ts`，期望两阶段指令测试通过。

## T21：执行前重新计算动态工具集合

**文件：** `src/agent/loop.ts`、`src/agent/tool-scheduler.ts`、`src/agent/loop.test.ts`

**依赖：** T13、T19

**步骤：**
1. 区分请求时 visible tool names 与模型响应后的执行时 names。
2. 动态 runtime 在 ToolScheduler 前重新读取 visibleToolNames。
3. fixed toolDefinitions 路径始终使用固定 names，不回读 Registry 定义集合。
4. Plan Mode 继续在请求和执行两层过滤副作用工具。
5. 测试模型流期间可见集合收窄后，未开始工具收到 TOOL_UNAVAILABLE 且实现调用为零。

**验证：** 运行 `pnpm exec tsx --test src/agent/loop.test.ts src/agent/tool-scheduler.test.ts`，期望动态工具安全测试通过。

## T22：把 ToolExecutionState 注入 AgentLoop

**文件：** `src/agent/loop.ts`、`src/agent/loop.test.ts`

**依赖：** T13、T19

**步骤：**
1. AgentLoopRuntime 增加可选 toolExecutionState。
2. 构造 ToolScheduler 时传入同一状态。
3. 主 Agent没有配置时保持无缓存或使用既有默认路径，不引入共享全局状态。
4. 测试两个 AgentLoop 使用两个 execution state，读缓存互不影响。

**验证：** 运行 `pnpm exec tsx --test src/agent/loop.test.ts`，期望执行状态隔离测试通过。

## T23：扩展 Hook Agent 上下文和字段

**文件：** `src/hook/types.ts`、`src/hook/field.ts`、`src/hook/compiler.test.ts`

**依赖：** T3

**步骤：**
1. HookEventContext 增加 agent id、kind、role、sessionId、parentTurnId 快照。
2. Hook field 支持 agent.id、agent.kind、agent.role，缺失字段按未命中处理。
3. 定义 ScopedHookRuntime、HookAgentScope、AGENT_FAILED 和 NESTED_AGENT_FORBIDDEN。
4. 保持旧事件没有 agent 字段时的 matcher 行为。
5. 测试三类字段 exact/glob/regex、缺失角色和旧上下文兼容。

**验证：** 运行 `pnpm exec tsx --test src/hook/compiler.test.ts`，期望 Hook agent 字段测试通过。

## T24：实现 scoped HookRuntime

**文件：** `src/hook/manager.ts`、`src/hook/manager.test.ts`

**依赖：** T23

**步骤：**
1. 抽取 dispatch 接受 context base 和 prompt sink，不再硬编码全局 prompts。
2. createAgentScope 捕获 session/turn/agent 快照并创建独立 prompt queue。
3. scoped assistant、pre_tool_use、post_tool_use 使用捕获上下文。
4. scoped prepare/commit 只操作本 scope prompt；规则、once、logger、shutdown 共享。
5. scoped context 匹配 agent action 时记录 NESTED_AGENT_FORBIDDEN，不调用 executor。
6. scope close 清空 prompt；manager close 同时使所有 scope 停止发布。
7. 测试两个 scope prompt 隔离、父 turn 结束后上下文仍稳定、once 共享和递归拒绝。

**验证：** 运行 `pnpm exec tsx --test src/hook/manager.test.ts`，期望 Hook scope 测试通过。

## T25：扩展 Hook agent action 配置

**文件：** `src/hook/types.ts`、`src/hook/compiler.ts`、`src/hook/compiler.test.ts`

**依赖：** T23

**步骤：**
1. agent action 允许 type、prompt 和可选 role，拒绝其他字段。
2. role 必须是合法非空角色名，缺省不写入 compiled action。
3. 保持 pre_tool_use 禁止 agent、agent 禁止 timeout_ms 的现有校验。
4. 测试旧 `{type,prompt}`、指定 role、空 role、未知字段、pre_tool_use 和 timeout。

**验证：** 运行 `pnpm exec tsx --test src/hook/compiler.test.ts`，期望 Hook agent 配置测试通过。

## T26：让 Hook ActionExecutor 调用真实子 Agent

**文件：** `src/hook/action-executor.ts`、`src/hook/action-executor.test.ts`

**依赖：** T25

**步骤：**
1. DefaultHookActionExecutor 接收 HookAgentRunner 依赖。
2. 渲染 prompt，缺省 role 使用 general，并传 session、turn mode、background 和 signal。
3. completed 返回 success output；backgrounded 返回 success task ID；failed 返回 AGENT_FAILED。
4. 没有 runner 时返回明确 AGENT_FAILED，移除真实路径 NOT_IMPLEMENTED。
5. 保持 command/http/prompt 和 pre_tool decision 行为不变。
6. 测试旧格式、指定 role、同步、后台、失败和其他 action 回归。

**验证：** 运行 `pnpm exec tsx --test src/hook/action-executor.test.ts`，期望 Hook ActionExecutor 测试通过。

## T27：实现定义式 SubAgentRunner

**文件：** `src/subagent/runner.ts`、`src/subagent/runner.test.ts`、`src/permission/factory.ts`

**依赖：** T10、T14、T17、T21、T22、T24

**步骤：**
1. 定义 PermissionManagerFactory 并为每次 run 创建独立 manager。
2. 创建独立 ContextManager、ToolExecutionState 和 scoped HookRuntime。
3. 从空 history、角色 System Prompt 和定义式 task 启动 AgentLoop。
4. visibleToolNames 根据 TaskManager 当前 foreground/background 状态返回冻结集合。
5. 不传 permissionDecider，将 PERMISSION_UNAVAILABLE 归一化为非交互 PERMISSION_DENIED。
6. 转发结构化 AgentEvent，finally 关闭 context/cache/scope 和工具租约。
7. 测试空历史、固定角色、独立权限、前后台集合切换、完成与资源关闭。

**验证：** 运行 `pnpm exec tsx --test src/subagent/runner.test.ts`，期望定义式 Runner 测试通过。

## T28：实现 Fork SubAgentRunner

**文件：** `src/subagent/runner.ts`、`src/subagent/runner.test.ts`

**依赖：** T19、T24、T27

**步骤：**
1. Fork history 结构化复制 parentRequest.messages，并追加 Fork task。
2. 使用 parentRequest.systemPrompt、过滤后 ToolDefinition 顺序和父 Provider。
3. 使用全局 forkMaxIterations 和父 Agent mode。
4. 不注入定义式角色或 Skill 列表，仍创建独立 Context/Permission/cache/Hook scope。
5. 测试首请求前缀、无当前工具调用消息、固定工具、父模式和 cache usage 透传。

**验证：** 运行 `pnpm exec tsx --test src/subagent/runner.test.ts`，期望 Fork Runner 测试通过。

## T29：实现 Coordinator 的 Agent 工具调度

**文件：** `src/subagent/coordinator.ts`、`src/subagent/coordinator.test.ts`

**依赖：** T7、T9、T10、T17、T27、T28

**步骤：**
1. 只处理 agent + dispatch metadata，其他工具结果原样返回。
2. defined 解析角色、Provider、工具快照、角色权限和父 mode。
3. fork 校验 parent ProviderRequest，过滤父工具，继承父 Provider/权限模式并强制后台。
4. 创建 TaskManager operation，并传 session、父 turn、文件跟踪回调。
5. 显式后台/Fork 立即返回 task ID；前台调用 waitForeground。
6. completed 前台返回有界文本成功；failed/cancelled 返回稳定子 Agent错误。
7. 测试角色不存在、模型解析、合法 defined/fork、非 agent passthrough 和错误结果。

**验证：** 运行 `pnpm exec tsx --test src/subagent/coordinator.test.ts`，期望 Agent 工具调度测试通过。

## T30：实现 Coordinator 后台控制与 Hook 入口

**文件：** `src/subagent/coordinator.ts`、`src/subagent/coordinator.test.ts`

**依赖：** T18、T26、T29

**步骤：**
1. 订阅 TaskManager terminal event，把后台任务送入 ResultInbox。
2. 提供 moveForegroundToBackground、list/get、cancelSession 和 close 委托。
3. runHookAgent 缺省 general，只允许 defined，使用 Hook context 的 mode/session/signal。
4. Hook background 立即返回 taskId；同步等待完成或自动/手动转后台。
5. session 已失效或 coordinator 关闭时拒绝创建任务。
6. 测试后台入队、前台不重复入队、Hook general/role、失败和关闭边界。

**验证：** 运行 `pnpm exec tsx --test src/subagent/coordinator.test.ts src/subagent/result-inbox.test.ts`，期望后台与 Hook 调度测试通过。

## T31：调整 Skill 与 Agent 工具边界

**文件：** `src/skill/manager.ts`、`src/skill/manager.test.ts`、`src/skill/runner.ts`、`src/skill/runner.test.ts`

**依赖：** T9、T29

**步骤：**
1. AgentTool 在 SkillManager 构造前注册，使主上下文 base tools 包含 agent。
2. 主/shared Skill 可见集合保留 agent 系统工具，即使 Skill 白名单收窄普通工具。
3. isolated Skill scope 强制移除 agent，防止临时 Agent 再委派。
4. 子 Agent运行期间调用 beginExecution/endExecution，延后专属工具热更新。
5. Skill reload 成功后通知 AgentDefinitionManager 重新校验角色工具引用。
6. 测试 shared 可见、isolated 不可见、运行租约和既有 load_skill 行为。

**验证：** 运行 `pnpm exec tsx --test src/skill/manager.test.ts src/skill/runner.test.ts src/skill/agent-integration.test.ts`，期望 Skill 边界测试通过。

## T32：接入 ChatManager 工具结果组合和任务控制

**文件：** `src/chat/manager.ts`、`src/chat/manager.test.ts`

**依赖：** T20、T30、T31

**步骤：**
1. ChatManager options 注入 Coordinator 和当前 session ResultInbox runtime。
2. transformToolResult 先调用 SkillRunner，再调用 Coordinator，按工具名互斥处理。
3. dispatch 时传当前 sessionId、父权限模式、ProviderRequest 和 trackToolEdit 回调。
4. 暴露 list/get/background/subscribe/hasForeground 控制方法。
5. 子 Agent write/edit 复用当前 FileHistory 跟踪。
6. 测试普通工具不变、Skill 变换不变、agent 调度、任务查询和文件跟踪。

**验证：** 运行 `pnpm exec tsx --test src/chat/manager.test.ts src/skill/chat-integration.test.ts`，期望 Chat 工具组合测试通过。

## T33：接入 ChatManager 结果提交与会话清理

**文件：** `src/chat/manager.ts`、`src/chat/manager.test.ts`

**依赖：** T18、T20、T32

**步骤：**
1. AgentLoop instructionRuntime 指向当前 session inbox。
2. onInstructionsCommitted 把 subagent_result 持久化，不重复追加 outcome history。
3. clear/resume/close 先 cancelSession 并 await settle，再 discard inbox 和替换会话。
4. 新 session 建立后更新 Coordinator 可接受 session，旧任务 completion 被拒绝。
5. memory extraction 和 turnCount 不把 subagent_result 当用户输入。
6. 测试运行中下一迭代消费、自然结束后下一用户任务消费、clear/resume/close 迟到隔离。

**验证：** 运行 `pnpm exec tsx --test src/chat/manager.test.ts`，期望结果提交与会话生命周期测试通过。

## T34：持久化并恢复子 Agent 结果

**文件：** `src/session/session.ts`、`src/session/session.test.ts`、`src/chat/manager.ts`

**依赖：** T18、T33

**步骤：**
1. Session system type 支持 compact_boundary 与 subagent_result 联合。
2. 增加 saveSubAgentResult，保存 role system、type 和有界内容。
3. parseMessage 严格校验新 type，不接受任意 system 记录。
4. rebuildFromSession 恢复 boundary 后的 subagent_result 为 instruction message。
5. boundary 前的结果不重复恢复，由摘要代表；普通 user/assistant 顺序保持。
6. 测试无 boundary、有 boundary、损坏记录、未知 type 和 Chat resume history。

**验证：** 运行 `pnpm exec tsx --test src/session/session.test.ts src/chat/manager.test.ts`，期望会话持久化测试通过。

## T35：实现 `/tasks` 格式化和命令

**文件：** `src/subagent/format.ts`、`src/command/types.ts`、`src/command/builtins.ts`、`src/command/builtins.test.ts`

**依赖：** T17、T32

**步骤：**
1. formatTaskList 按创建时间倒序输出当前 session 摘要。
2. formatTaskDetail 输出 ID、类型/角色、状态、后台原因、停止原因、迭代和 Token/cache。
3. 结果与错误使用有界文本，空列表和未知 ID 给明确引导。
4. CommandUIController 增加 showSubAgentTasks。
5. 注册 `/tasks [任务 ID]`，不增加冲突别名。
6. 测试 help、无参数、合法 ID、未知 ID 和命令参数原样传递。

**验证：** 运行 `pnpm exec tsx --test src/command/builtins.test.ts`，期望 `/tasks` 命令测试通过。

## T36：接入 Hook scoped runtime 集成

**文件：** `src/subagent/runner.ts`、`src/hook/integration.test.ts`、`src/subagent/integration.test.ts`

**依赖：** T24、T27、T30

**步骤：**
1. Runner 为每个任务创建独立 Hook scope，传 task kind/role/session/turn。
2. scoped prompt 只进入该子 Agent下一 Provider 请求。
3. 子 Agent只发布 assistant/pre/post，不重复 parent turn/user 生命周期。
4. 工具 deny 继续作为普通 ToolResult 回灌子 Agent。
5. 测试并发 scope prompt 不串线、父 turn 结束后后台 Hook 正常和嵌套 agent 被拒绝。

**验证：** 运行 `pnpm exec tsx --test src/hook/integration.test.ts src/subagent/integration.test.ts`，期望 Hook 子 Agent集成测试通过。

## T37：接入任务查询与后台通知 UI

**文件：** `src/ui/app.tsx`、`src/ui/app.test.ts`、`src/command/types.ts`

**依赖：** T33、T35

**步骤：**
1. commandUi 实现 showSubAgentTasks，通过 ChatManager list/get 和 format 函数展示。
2. useEffect 订阅 SubAgentEvent，组件卸载时取消订阅。
3. backgrounded 事件显示任务 ID；后台 finished 显示成功/失败/取消通知。
4. 前台完成不重复通知，子 Agent中间 text/thinking 不加入 MessageList。
5. 启动消息显示 AgentDefinition diagnostics；`/status` 增加任务数量摘要。
6. 测试格式化调用、订阅清理、前后台通知去重和诊断消息。

**验证：** 运行 `pnpm exec tsx --test src/ui/app.test.ts && pnpm typecheck`，期望 UI 控制接口、通知逻辑与渲染编译通过。

## T38：接入 `Ctrl+B` 手动转后台

**文件：** `src/ui/app.tsx`、`src/ui/app.test.ts`、`src/chat/manager.ts`

**依赖：** T16、T32、T37

**步骤：**
1. 全局 useInput 在 ctrl+b 且 isStreaming 时调用 backgroundCurrentSubAgent。
2. 成功时显示任务 ID 和“已转后台”，没有任务时保持安静且不改变状态。
3. 只有 hasForegroundSubAgent 为 true 时显示 Ctrl+B 提示。
4. 保持 Ctrl+C 取消主任务和 permission prompt 输入不变。
5. 测试有前台、无前台、重复按键和 Ctrl+C 回归。

**验证：** 运行 `pnpm exec tsx --test src/ui/app.test.ts && pnpm typecheck`，期望快捷键控制逻辑与 Ctrl+C 回归测试通过。

## T39：实现完整启动和关闭编排

**文件：** `src/index.tsx`、`src/subagent/agent-tool.ts`、`src/config/loader.test.ts`

**依赖：** T7、T9、T26、T30、T31、T33、T37

**步骤：**
1. Provider resolver 同时服务 Skill 与模型档位。
2. MCP 后立即注册 AgentTool，再构造 SkillManager。
3. Skill 初始化后构造 AgentDefinitionManager 并启动 watcher。
4. 创建 Permission factory、TaskManager、Inbox、Runner 和 Coordinator。
5. 用延迟 hooks getter 解决 Runner 与 HookManager 循环，ActionExecutor 注入 Coordinator。
6. ChatManager 注入完整 subagent options，Hook system/session 只在依赖齐备后启动。
7. finally 按 Chat/Coordinator/Definition/Hook/Skill/MCP 顺序关闭，逐层捕获诊断。
8. 测试配置模型别名解析和无 subagent 配置启动路径；执行 typecheck 验证依赖无环。

**验证：** 运行 `pnpm typecheck`，期望入口和所有构造签名编译通过。

## T40：验证定义式前台、权限与 Plan Mode

**文件：** `src/subagent/integration.test.ts`

**依赖：** T27、T29、T32、T39

**步骤：**
1. 用脚本 Provider 驱动定义式子 Agent连续读工具并自然完成。
2. 断言首请求 history 为空、角色 System 存在、父 history 不可见。
3. default 未命中权限时断言没有 decider，模型收到 deny 后能改用允许工具完成。
4. allow 模式仍验证危险命令、路径沙箱和 Hook deny。
5. Plan Mode 调用 agent 时断言子 Agent请求和执行均无副作用工具。
6. 验证前台最终文本作为 parent tool result 回灌且不中间串流。

**验证：** 运行 `pnpm exec tsx --test src/subagent/integration.test.ts`，期望定义式端到端场景通过。

## T41：验证后台三路径、查询和回流

**文件：** `src/subagent/integration.test.ts`、`src/chat/manager.test.ts`

**依赖：** T30、T33、T35、T38

**步骤：**
1. 测试 explicit background 立即返回 task ID 且 operation 继续。
2. 用短阈值测试 timeout，不等待真实 120 秒。
3. 调用 ChatManager 手动切换测试 Ctrl+B 控制路径。
4. 断言三条路径任务 ID、历史、工具次数和 usage 连续，不重启。
5. 后台完成时断言 UI event 有通知但 Provider 调用数不增加。
6. 下一自然请求注入一次并持久化，`/tasks` 列表和详情可读取完整状态。

**验证：** 运行 `pnpm exec tsx --test src/subagent/integration.test.ts src/chat/manager.test.ts src/command/builtins.test.ts`，期望后台与回流场景通过。

## T42：验证 Fork 历史、工具和缓存用量

**文件：** `src/subagent/integration.test.ts`、`src/provider/anthropic.test.ts`、`src/provider/openai.test.ts`

**依赖：** T28、T29、T39

**步骤：**
1. 捕获父 ProviderRequest 和 Fork 首次 ProviderRequest 做结构对比。
2. 断言 System 完全一致，父 messages 是 Fork messages 前缀，当前 agent 调用消息不存在。
3. 断言工具保持父相对顺序并移除 agent/load_skill/global deny。
4. 断言 Fork 强制后台、继承父 Provider/Plan Mode/权限模式但不继承 session 规则。
5. Anthropic 模拟 cache creation/read，OpenAI 模拟 cached tokens，断言 Task usage 透传。
6. 测试不支持 cache 字段时用量为 0 且任务仍完成。

**验证：** 运行 `pnpm exec tsx --test src/subagent/integration.test.ts src/provider/anthropic.test.ts src/provider/openai.test.ts`，期望 Fork 缓存场景通过。

## T43：验证会话取消、持久化和 rewind

**文件：** `src/subagent/integration.test.ts`、`src/chat/manager.test.ts`、`src/session/session.test.ts`

**依赖：** T33、T34、T40、T41

**步骤：**
1. 后台子 Agent edit/write 后验证 FileHistory snapshot 可 rewind。
2. clear、resume、close 分别取消旧 session 任务并等待 settle。
3. 制造迟到 completion，断言不进入新 inbox/history/session 文件。
4. 已消费 subagent_result 保存后恢复为 instruction，不计 user turn。
5. compact boundary 前结果由摘要代表，boundary 后结果原样恢复。

**验证：** 运行 `pnpm exec tsx --test src/subagent/integration.test.ts src/chat/manager.test.ts src/session/session.test.ts`，期望会话与 rewind 场景通过。

## T44：验证 Hook agent 真实执行与失败开放

**文件：** `src/hook/action-executor.test.ts`、`src/hook/manager.test.ts`、`src/hook/integration.test.ts`、`src/subagent/integration.test.ts`

**依赖：** T26、T30、T36、T39

**步骤：**
1. 旧格式 agent action 使用 general 同步完成。
2. 指定 role、background true、自动转后台和任务查询分别生效。
3. 无效角色、流错误、权限拒绝和取消只写 Hook failure，不改变主 Agent停止原因。
4. pre_tool_use agent 配置仍在编译期失败。
5. 子 Agent scoped Hook 再匹配 agent action 时记录 NESTED_AGENT_FORBIDDEN，Provider 调用次数不增加。

**验证：** 运行 `pnpm exec tsx --test src/hook/action-executor.test.ts src/hook/manager.test.ts src/hook/integration.test.ts src/subagent/integration.test.ts`，期望 Hook 子 Agent场景通过。

## T45：更新用户文档和变更日志

**文件：** `README.md`、`changelogs/pending.md`

**依赖：** T39、T40、T41、T42、T44

**步骤：**
1. 说明 `agent_models` 和 `subagents` 配置字段、默认 120 秒和范围。
2. 说明四级角色目录、frontmatter 字段、覆盖和单角色诊断策略。
3. 说明 defined/fork、前台/后台、Ctrl+B、`/tasks` 和结果回流时机。
4. 说明非交互权限、全局禁用、Hook agent、无 Worktree 和并发编辑风险。
5. 用 BetterCode 名称编写中文 changelog，记录主要能力、测试和安全边界。
6. 扫描 README、changelog 和新文档，确保没有旧系统名。

**验证：** 运行 `rg -n "M[e]wCode|m[e]wcode|T[B]D|T[O]DO" README.md changelogs/pending.md docs/subagent-system`，期望无输出；运行 `git diff --check`，期望通过。

## T46：执行全量回归并修复本章问题

**文件：** 本章涉及的源码与测试文件

**依赖：** T40-T45

**步骤：**
1. 运行 TypeScript 类型检查，修复本章引入的类型错误。
2. 运行全部测试，修复本章引入的失败，不处理无关历史问题。
3. 单独复跑 subagent、agent、hook、chat、skill、permission、context、session 和 provider 定向测试。
4. 运行 `git diff --check`，清理行尾空格和格式问题。
5. 扫描新增源码注释，确保使用中文；扫描用户可见文案，确保使用 BetterCode。

**验证：** 运行 `pnpm check && git diff --check`，期望类型检查和全部测试成功，diff 检查无输出。

## T47：按 Checklist 执行验收

**文件：** `docs/subagent-system/checklist.md`

**依赖：** T46、已批准的 checklist.md

**步骤：**
1. 逐项运行 checklist 中的验证命令和端到端场景。
2. 记录实际命令、通过数量和关键行为证据。
3. 只有实际通过的项目改为 `[x]`，失败项保持未勾选并修复后重跑。
4. 补充最终全量测试数量、缓存字段、后台三路径和 Hook 场景证据。

**验证：** checklist 所有条目均为 `[x]`，且每类核心行为有实际测试证据。

## T48：创建大型 Plan 阶段性提交

**文件：** 本章全部已验证文件、`changelogs/pending.md`

**依赖：** T47

**步骤：**
1. 检查 `git status --short`，明确区分本章文件与用户 `.bettercode/` 运行数据。
2. 只暂存本章源码、测试、文档、README 和 changelog，不暂存 `.bettercode/`。
3. 运行 `git diff --cached --check` 并审阅 staged stat。
4. 使用中文提交信息，例如 `feat(子Agent系统): 实现隔离委派与后台任务`。
5. 按仓库 changelog 约定归档 pending 文件；如归档会改变提交内容，使用 amend 保持单个阶段提交。
6. 确认最终 status 只保留用户未跟踪运行数据，且不执行 git push。

**验证：** 运行 `git log -1 --oneline`，期望最新提交信息为中文子 Agent系统阶段提交；运行 `git status --short`，期望没有本章未提交改动且 `.bettercode/` 未被提交。

## 执行顺序

```text
配置与角色：
T1 -> T2
 |     |
 `-> T3 -> T4 -> T5 -> T6 -> T7 -> T8

工具基础：
T3 -> T9 -> T10
T3 -> T11 -> T12 -> T13
T3 -> T14

任务与回流：
T3 -> T15 -> T16 -> T17 -> T18

AgentLoop：
T10 + T18 -> T19 -> T20
T13 + T19 -> T21 -> T22

Hook：
T3 -> T23 -> T24 -> T25 -> T26

运行与调度：
T10 + T14 + T17 + T21 + T22 + T24 -> T27 -> T28
T7 + T9 + T27 + T28 -> T29 -> T30

系统集成：
T29 -> T31
T20 + T30 + T31 -> T32 -> T33 -> T34
T17 + T32 -> T35
T24 + T27 + T30 -> T36
T33 + T35 -> T37 -> T38
T7 + T9 + T26 + T30 + T31 + T33 + T37 -> T39

端到端与交付：
T39 -> T40 -> T41 -> T43
T39 -> T42
T36 + T39 -> T44
T40 + T41 + T42 + T44 -> T45 -> T46 -> T47 -> T48
```

可并行组：

- T4-T8（角色链）与 T11-T13（读取缓存链）在 T3 后可并行。
- T15-T18（任务链）与 T23-T26（Hook 链）在各自依赖满足后可并行。
- T35（命令）与 T36（Hook 集成）可在 Coordinator/Chat 基础完成后并行。
- T42（Fork）与 T43（会话）可在各自前置集成完成后并行。

## 覆盖检查

| Plan 组件 | 对应任务 |
|-----------|----------|
| 配置与模型档位 | T1-T2 |
| 角色 parser/loader/manager/内置角色 | T3-T8 |
| 稳定 Agent 工具与过滤 | T9-T10 |
| 文件读取缓存与失效 | T11-T13、T22 |
| 子 Agent Prompt | T14 |
| TaskManager 与三种后台方式 | T15-T17 |
| ResultInbox | T18、T20 |
| AgentLoop 快照与动态工具 | T19-T22 |
| Hook scope 与真实 agent action | T23-T26、T36、T44 |
| Runner 与 Coordinator | T27-T30 |
| Skill 边界 | T31 |
| Chat、Session、Command、UI | T32-T38 |
| 启动关闭 | T39 |
| 端到端与缓存验证 | T40-T44 |
| 文档、回归、验收、提交 | T45-T48 |
