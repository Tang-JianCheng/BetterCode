# BetterCode Hook 系统 Checklist

> 验收日期：2026-07-31。证据：`pnpm check` 通过，258/258 项测试成功；Hook、Matcher、Permission、Agent、Chat、Skill 定向测试通过；真实 Shell 子进程、本地 HTTP Server、工具拒绝恢复、Prompt 单次消费和完整生命周期场景通过；`git diff --check` 通过。

## 配置与编译

- [x] 用户、项目、项目本地三个 YAML 按固定顺序加载。
- [x] 不存在的配置文件等价于空规则集。
- [x] 项目共享与本地配置通过真实路径检查，外部符号链接和悬空链接被拒绝。
- [x] YAML 重复键、语法错误、错误 version、未知根字段导致启动失败。
- [x] 缺失 event/action、未知事件、未知动作和错误字段类型导致启动失败。
- [x] 任一层或任一规则无效时不发布部分 Hook 集合。
- [x] 错误能指出配置层、文件和 1 基规则序号。
- [x] HTTP `${VAR}` 能展开，缺失变量启动失败，密钥值不进入错误。
- [x] `.bettercode/hooks.local.yaml` 和 `.bettercode/logs/` 已加入 Git 忽略。

## 生命周期事件

- [x] 启动时按 `system_start` → `session_start` 触发。
- [x] 正常关闭时按 `session_end` → `system_stop` 触发且只触发一次。
- [x] `/clear` 先结束旧会话，再开始新会话。
- [x] 会话恢复先结束旧会话，再以恢复后的 ID 开始新会话。
- [x] 一条用户输入只产生一次 `turn_start` 和一次 `turn_end`。
- [x] Agent 内部多次 LLM 迭代不会重复触发 turn 事件。
- [x] `turn_end` 对 completed、cancelled、max iterations、unknown tool、context error、stream error 都触发。
- [x] 每条被接受的用户任务产生一次 `user_message`。
- [x] 每个完整助手响应产生一次 `assistant_message`，流式 delta 不触发。
- [x] 带工具调用的中间助手消息也产生 `assistant_message`。
- [x] 直接 shared/isolated Skill 只有一组外层 turn 和 user_message。
- [x] 独立 Skill 内助手和工具事件继续使用当前会话与 turn。
- [x] compact、权限切换、状态查询和纯本地命令不产生 turn/message。
- [x] 重复结束会话或关闭 manager 不重复发布结束事件。

## 事件上下文

- [x] 所有事件包含 event、projectRoot、session.id 和 timestamp。
- [x] turn 事件包含 id、mode、task，结束事件包含 stopReason。
- [x] message 事件包含 role 和完整消息，助手工具摘要不泄漏参数。
- [x] pre tool 包含调用 ID、工具名和完整结构化参数。
- [x] post tool 增加最终 ToolResult。
- [x] 事件对象深冻结，Hook 无法修改原工具参数、历史或结果。
- [x] message/tool result 模板值有大小边界，工具执行前参数保持完整。

## 条件匹配

- [x] exact 只匹配完全相同的稳定文本。
- [x] glob 保持路径和普通字面字段的 slash 语义。
- [x] regex 在启动期编译并按 Unicode 模式匹配。
- [x] negate 能反转实际 exact/glob/regex 结果。
- [x] 缺失字段即使 negate 也不会命中。
- [x] `all` 要求全部条件满足，`any` 要求至少一个满足。
- [x] all/any 混用、空数组和递归嵌套被拒绝。
- [x] 当前事件不支持的字段和模板占位符在启动期被拒绝。
- [x] `tool.arguments.<name>` 和 result metadata 动态字段可读取。
- [x] 原型链键不能被字段路径读取。
- [x] 对象和数组匹配使用稳定 JSON，键顺序不影响结果。
- [x] 公共 matcher 接入后现有权限精确、glob、工具级规则行为不变。

## 命令动作

- [x] 命令使用系统 Shell 且 cwd 固定为项目根。
- [x] stdin 收到一次完整事件 JSON 后正常关闭。
- [x] 命令继承 BetterCode 环境，不经过 Tool 权限系统。
- [x] stdout/stderr 分别限制 64 KiB 并标记截断。
- [x] 非零退出、启动失败和非法输出转换为 Hook 失败日志。
- [x] timeout 终止进程组并返回超时失败。
- [x] AbortSignal 取消正在运行的命令和子进程树。
- [x] 测试结束没有悬挂子进程、计时器或监听器。

## HTTP 动作

- [x] 默认 POST 且省略 body 时发送完整事件 JSON。
- [x] method、URL、headers 和显式 JSON body 正确渲染。
- [x] 只允许 HTTP/HTTPS，非法 URL 在启动期失败。
- [x] host、content-length 等受保护请求头被拒绝。
- [x] URL/header/body 同时支持环境变量和事件模板。
- [x] 2xx 视为成功，非 2xx 视为 Hook 失败。
- [x] 响应正文限制 64 KiB。
- [x] timeout 和用户取消能终止 fetch。
- [x] 认证头、环境密钥和完整响应不进入日志。
- [x] 本地测试 Server 关闭后没有悬挂连接。

## Prompt 与 Agent 动作

- [x] Prompt 文本支持事件字段占位符。
- [x] Prompt 不展开环境变量。
- [x] `turn_start` 和 `user_message` Prompt 进入当前首个 Provider 请求。
- [x] `assistant_message` 和 `post_tool_use` Prompt 进入下一次 Provider 请求。
- [x] 没有后续迭代时 Prompt 保留到下一次正常请求。
- [x] 多个 Prompt 按 Hook 稳定顺序合并。
- [x] Prompt 只消费一次，不写入真实对话历史。
- [x] Prompt 不改变 System Prompt 和稳定工具定义。
- [x] ContextManager 未 ready 时 Prompt 不消费。
- [x] Provider 流失败时已发送 Prompt 保持已消费。
- [x] 手动 compact 不读取或消费 Hook Prompt。
- [x] `system_stop` prompt 和 background prompt 在启动期被拒绝。
- [x] agent 动作触发时只写未实现日志，不调用 Provider 或创建 Agent。
- [x] agent 动作不能用于 `pre_tool_use`。

## 工具拦截

- [x] `pre_tool_use` 位于可见性、Plan Mode、Schema 之后。
- [x] `pre_tool_use` 位于 PermissionManager、文件快照和 Registry 之前。
- [x] command stdout 和 HTTP body 使用同一 allow/deny JSON。
- [x] 合法 deny 必须含非空 reason，拒绝原因清理并限制 500 字符。
- [x] 合法 deny 返回稳定 `HOOK_DENIED` ToolResult。
- [x] 拒绝元信息只包含层级和规则序号，不暴露配置路径、命令或 URL。
- [x] deny 后权限确认、快照、Registry 执行次数均为零。
- [x] deny 后剩余 pre Hook 不继续执行。
- [x] allow 只放行当前 Hook，仍经过权限系统。
- [x] allow 不能绕过 Plan Mode、黑名单、路径沙箱或显式 deny。
- [x] 空输出、非法 JSON、额外字段、非法 decision 按 Hook 失败开放。
- [x] Hook 失败后其余 pre Hook 和权限流程继续。
- [x] Hook 拒绝作为工具结果回灌，Agent 可以调整工具后完成任务。
- [x] 被 Plan、Schema、Hook 或权限拒绝的调用不触发 post Hook。
- [x] 实际执行成功和工具自身失败都触发一次 post Hook。
- [x] post Hook 不能替换原 ToolResult。
- [x] 内置、系统、MCP 和 Skill 专属工具都进入相同前置路径。

## 调度与顺序

- [x] 三层和文件内规则按稳定配置顺序匹配。
- [x] 同一事件的同步 Hook 串行执行。
- [x] 第一个明确 deny 稳定决定最终拒绝来源。
- [x] 后台 Hook 按配置顺序启动但不保证完成顺序。
- [x] 多工具前置 Hook 按模型原调用顺序执行。
- [x] 只读工具完成前置 Hook 和权限后仍并发执行。
- [x] 副作用工具继续串行执行。
- [x] post tool 事件按原调用索引顺序发布。
- [x] 最终工具结果顺序与原调用顺序一致。
- [x] Hook 拒绝和失败不改变 unknown tool streak。

## Once 与后台执行

- [x] once 默认关闭，普通规则每次匹配都执行。
- [x] once 首次调度写 running，避免并发重复启动。
- [x] once 成功后当前 BetterCode 进程内不再执行。
- [x] once 失败或取消后可在未来事件重试。
- [x] 重启后 once 状态不恢复。
- [x] `pre_tool_use` 配置 once 在启动期失败。
- [x] `pre_tool_use` 配置 background 在启动期失败。
- [x] 后台动作不阻塞 Agent 主流程。
- [x] 后台失败被记录且没有未处理 Promise rejection。
- [x] 关闭时后台命令和 HTTP 收到取消信号。
- [x] 关闭最多等待 2 秒，超时后不会卡住 BetterCode。

## 日志与失败隔离

- [x] 默认日志路径为 `.bettercode/logs/hooks.jsonl`。
- [x] 日志包含时间、层、文件、规则、事件、动作、代码和摘要。
- [x] 单行日志不超过 2 KiB。
- [x] 控制字符、环境密钥和认证值被脱敏。
- [x] 日志不记录完整事件上下文、完整工具输出或动作响应。
- [x] 并发日志按写入队列保持合法 JSONL。
- [x] 日志目录不可写、append 失败和 logger 抛错均不影响主流程。
- [x] 普通、前置和后台 Hook 失败均不会改变 Agent 停止原因。
- [x] Hook 失败不会破坏助手调用与工具结果历史配对。
- [x] 子 Agent 占位失败和 Prompt 渲染失败不会崩溃。

## 配置组合约束

- [x] command/http 接受合法 timeout，缺失时默认 30 秒。
- [x] timeout 小于 1 或大于 300000 被拒绝。
- [x] prompt/agent 配置 timeout 被拒绝。
- [x] prompt 配置 background 被拒绝。
- [x] pre tool 的 once/background/agent 被拒绝。
- [x] system stop 的 prompt 被拒绝。
- [x] HTTP body 必须是可序列化 JSON。
- [x] 未知 action 字段按动作类型严格拒绝。

## 文档与信任边界

- [x] README 记录三层路径和固定执行顺序。
- [x] README 列出十个事件和字段边界。
- [x] README 提供四类动作配置示例。
- [x] README 记录命令 stdin 和统一决定 JSON。
- [x] README 说明 Prompt 只进入下一次 runtime instruction。
- [x] README 说明 once、background、timeout 和无热更新。
- [x] README 明确命令和 HTTP 不经过 Agent 权限系统。
- [x] README 说明 Hook 配置应视为可信本地代码。
- [x] README 说明子 Agent 仅占位、日志不轮转、网络不沙箱。
- [x] README 示例能被真实 loader/compiler 加载。

## 编译与回归

- [x] `pnpm typecheck` 无错误。
- [x] Matcher 和 Permission 定向测试全部通过。
- [x] Hook 领域定向测试全部通过。
- [x] Agent、Chat、Skill 定向测试全部通过。
- [x] `pnpm test` 全部通过且无既有回归。
- [x] `git diff --check` 无空白错误。
- [x] 本章文件无旧产品名称、未完成占位符或新增英文源码注释。
- [x] 测试不读取真实用户 Hook 配置、不调用真实外部 HTTP 或模型 API。
- [x] 现有 `.bettercode/` 会话、记忆和运行数据未被修改或提交。

## 端到端场景

- [x] 场景 1：无 Hook 配置启动并完成普通文本任务，Provider 请求与现有行为一致。
- [x] 场景 2：`turn_start` Prompt 进入首请求，`post_tool_use` Prompt 进入第二次请求，均只出现一次。
- [x] 场景 3：pre command Hook 根据 `run_command` 参数返回 deny，模型收到原因后改用安全工具完成任务。
- [x] 场景 4：pre Hook 返回 allow，但危险命令仍被黑名单拒绝。
- [x] 场景 5：两个只读工具并发执行，pre/post Hook 与最终结果顺序保持规范。
- [x] 场景 6：HTTP Hook 向本地 Server 发送工具上下文并返回 deny，认证头不出现在日志。
- [x] 场景 7：后台格式化命令不阻塞 Agent，退出时仍运行的子进程被取消。
- [x] 场景 8：once 会话开始 Hook 在 clear/resume 后不重复，进程重建后可以再次执行。
- [x] 场景 9：项目配置损坏时启动失败，不运行用户层或本地层任何 Hook。
- [x] 场景 10：独立 Skill 内调用工具触发 Hook，但主历史仍只回流命令和摘要。
