# BetterCode Hook 系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|---|---|---|
| 新建 | `src/matcher/pattern.ts` | 权限与 Hook 共用的精确、glob、正则匹配器 |
| 新建 | `src/hook/types.ts` | 配置、规则、事件、动作、日志和运行时类型 |
| 新建 | `src/hook/field.ts` | 事件字段白名单、嵌套读取和稳定文本化 |
| 新建 | `src/hook/template.ts` | 文本及 JSON 事件模板编译与渲染 |
| 新建 | `src/hook/config-loader.ts` | 三层 YAML 严格加载和环境变量展开 |
| 新建 | `src/hook/compiler.ts` | 条件、动作和执行控制集中编译校验 |
| 新建 | `src/hook/command-executor.ts` | Shell 子进程、输入输出、超时和取消 |
| 新建 | `src/hook/http-executor.ts` | HTTP 请求、模板、响应限制和取消 |
| 新建 | `src/hook/action-executor.ts` | 四类动作分发和前置决定解析 |
| 新建 | `src/hook/logger.ts` | 脱敏、有界、串行 JSONL Hook 日志 |
| 新建 | `src/hook/manager.ts` | 生命周期、匹配、once、后台任务和提示词队列 |
| 新建 | `src/hook/*.test.ts` | Hook 领域单元与集成测试 |
| 修改 | `src/permission/rule-parser.ts` | 复用公共 matcher，保持权限外部行为 |
| 修改 | `src/agent/tool-scheduler.ts` | 接入执行前拦截和执行后 Hook |
| 修改 | `src/agent/loop.ts` | 助手消息事件和 Prompt 两阶段消费 |
| 修改 | `src/chat/manager.ts` | 会话、轮次和用户消息生命周期 |
| 修改 | `src/skill/runner.ts` | 独立 Skill Agent 复用 HookRuntime |
| 修改 | `src/index.tsx` | Hook 初始化、系统生命周期和关闭顺序 |
| 修改 | `src/tool/types.ts` | 增加 `HOOK_DENIED` 稳定错误码 |
| 修改 | `.gitignore` | 忽略本地 Hook 配置和运行日志 |
| 修改 | `README.md` | 记录配置、动作协议、示例和信任边界 |

## T1：抽取公共匹配器

**文件：** `src/matcher/pattern.ts`、`src/matcher/pattern.test.ts`、`src/permission/rule-parser.ts`、`src/permission/*.test.ts`
**依赖：** 无

1. 定义 `PatternSyntax`、`PatternTargetMode`、`CompiledPattern` 和编译错误。
2. 从权限 parser 抽取 minimatch 编译、slash 保护和字面长度计算。
3. 增加显式 exact、glob、regex，正则固定 Unicode 模式并启动期编译。
4. 权限 parser 改用 `auto` 模式，保持工具级、精确、glob 和转义行为。
5. 覆盖路径与字面目标、非法 glob、非法正则和权限回归矩阵。

**验证：**

```bash
pnpm exec tsx --test src/matcher/pattern.test.ts src/permission/rule-parser.test.ts src/permission/rule-engine.test.ts
```

## T2：定义 Hook 公共契约

**文件：** `src/hook/types.ts`
**依赖：** T1

1. 定义十个事件、三层来源、原始配置、编译规则和四类动作。
2. 定义系统、会话、轮次、消息、工具判别联合上下文。
3. 定义动作成功/失败、allow/deny、dispatch、Prompt 批次和日志类型。
4. 定义最小 `HookRuntime` 接口，避免 Agent、Chat 依赖具体 manager。
5. 保持类型只引用既有 Agent/Tool 纯类型，不引入 UI 或 Provider 实现。

**验证：** `pnpm typecheck` 能解析新增契约，且无循环运行时导入。

## T3：实现事件字段读取

**文件：** `src/hook/field.ts`、`src/hook/field.test.ts`
**依赖：** T2

1. 建立各事件固定字段和动态前缀白名单。
2. 校验字段只能读取当前事件允许的数据。
3. 实现安全点路径读取，拒绝 `__proto__`、`prototype`、`constructor`。
4. 用稳定 JSON 表示对象与数组，用确定文本表示标量。
5. 缺失字段返回显式 missing 状态，供 negate 保持不命中。

**验证：** 覆盖十个事件、嵌套参数、结果 metadata、缺失字段和原型链攻击路径。

## T4：实现事件模板

**文件：** `src/hook/template.ts`、`src/hook/template.test.ts`
**依赖：** T3

1. 解析 `{{field.path}}` 占位符并在编译阶段校验事件字段。
2. 支持普通文本嵌入和整值占位符。
3. 递归编译 JSON 对象与数组，为 HTTP body 保留合法 JSON 类型。
4. 渲染时限制单个值和最终文本大小，避免无界复制。
5. 对缺失运行时字段返回动作失败，不产生部分 Prompt 或请求。

**验证：** 覆盖文本、数字、布尔、对象、数组、多占位符、未知字段和超限裁剪。

## T5：实现三层配置加载

**文件：** `src/hook/config-loader.ts`、`src/hook/config-loader.test.ts`
**依赖：** T2

1. 读取用户、项目、项目本地三个固定文件。
2. 使用唯一键 YAML 解析和根节点严格字段校验。
3. 为每条规则记录 layer、file、1 基 index 和内部 ID。
4. 按 user → project → local、文件内声明顺序稳定合并。
5. 对 HTTP 字符串递归展开 `${VAR}`，收集脱敏值，缺失变量直接失败。
6. 用 `PathGuard` 拒绝项目配置符号链接逃逸和悬空链接。
7. 任一存在层错误时抛出带来源但不含密钥的启动错误。

**验证：** 临时目录测试覆盖缺文件、三层顺序、坏 YAML、重复键、未知字段、环境变量和符号链接。

## T6：集中编译 Hook 规则

**文件：** `src/hook/compiler.ts`、`src/hook/compiler.test.ts`
**依赖：** T1、T3、T4、T5

1. 校验 event/action 必填和根字段类型。
2. 编译 `all`/`any` 条件、exact/glob/regex 和 negate。
3. 编译 command、prompt、HTTP、agent 四种动作及模板。
4. 校验 once、background、timeout 默认值和范围。
5. 拒绝 `pre_tool_use` 的 once/background/agent。
6. 拒绝 prompt background、`system_stop` prompt 及 prompt/agent timeout。
7. 校验 HTTP method、URL、headers、body 和受保护请求头。
8. 返回不再需要运行期解析的不可变规则数组。

**验证：** 用字段组合矩阵覆盖所有合法动作和非法互斥组合。

## T7：实现 Hook 日志

**文件：** `src/hook/logger.ts`、`src/hook/logger.test.ts`、`.gitignore`
**依赖：** T2、T5

1. 实现可注入 `HookLogger` 和默认 JSONL logger。
2. 日志固定写入 `.bettercode/logs/hooks.jsonl`。
3. 替换环境密钥、认证值、控制字符并限制单行 2 KiB。
4. 用内部 Promise 队列保持追加顺序。
5. 目录创建、写入、序列化和关闭错误全部吞掉。
6. 将 `.bettercode/hooks.local.yaml` 和 `.bettercode/logs/` 加入 Git 忽略。

**验证：** 覆盖稳定 JSONL、并发写入、脱敏、截断、不可写路径和幂等关闭。

## T8：实现命令动作执行器

**文件：** `src/hook/command-executor.ts`、`src/hook/command-executor.test.ts`
**依赖：** T2

1. 在项目根通过系统 Shell 启动命令，不接受运行时命令改写。
2. 把深冻结事件上下文 JSON 写入 stdin 后关闭输入。
3. 分别收集有界 stdout/stderr，并记录截断状态。
4. 组合事件取消、动作超时和应用关闭信号。
5. macOS/Linux 使用进程组 SIGTERM/SIGKILL 清理子进程树。
6. 将启动、退出、超时、取消转换为统一 HookActionResult。

**验证：** 真实子进程 fixture 覆盖成功、stdin、非零退出、超时、取消、超大输出和无悬挂进程。

## T9：实现 HTTP 动作执行器

**文件：** `src/hook/http-executor.ts`、`src/hook/http-executor.test.ts`
**依赖：** T2、T4、T5

1. 渲染 URL、headers 和可选 JSON body，省略 body 时使用完整上下文。
2. 固定只允许 HTTP/HTTPS 并拒绝受保护 headers。
3. 使用 `fetch` 和组合 AbortSignal 处理超时、取消、关闭。
4. 有界读取 64 KiB 响应，不读取无限流。
5. 2xx 返回成功，非 2xx、连接、超时、取消和模板失败归一化。
6. 动作错误只保留脱敏 URL 来源和有界摘要。

**验证：** 本地 HTTP Server 覆盖 method/header/body、状态码、超时、取消、截断和密钥不泄漏。

## T10：实现动作分发和决定协议

**文件：** `src/hook/action-executor.ts`、`src/hook/action-executor.test.ts`
**依赖：** T4、T8、T9

1. 按动作类型调用 command/http，直接渲染 prompt，agent 返回占位失败。
2. 只在 `pre_tool_use` 解析 command stdout 或 HTTP body 决定。
3. 严格校验 allow/deny JSON、额外字段和拒绝原因。
4. 清理拒绝原因控制字符并限制 500 字符。
5. 捕获执行器抛出的所有异常，转换为失败结果。
6. 非前置动作忽略普通成功输出，不误解析为拒绝。

**验证：** 覆盖合法 allow/deny、空输出、非法 JSON、额外字段、缺 reason、超长 reason 和 agent 不调用 Provider。

## T11：实现 HookManager 核心分发

**文件：** `src/hook/manager.ts`、`src/hook/manager.test.ts`
**依赖：** T3、T6、T7、T10

1. 构造深冻结事件上下文并维护系统、会话、轮次状态。
2. 按 event 过滤规则，再执行 all/any/negate 条件。
3. 同步规则按配置顺序串行执行，普通失败写日志后继续。
4. 前置明确 deny 返回来源并立即停止剩余前置规则。
5. prompt 成功后按规则顺序加入待消费队列。
6. 实现 `preparePromptBatch` 和单调 `commitPromptBatch`。
7. 保证生命周期开始/结束配对、重复关闭和重复结束幂等。

**验证：** 覆盖事件状态、条件矩阵、同步顺序、首个拒绝、Prompt 队列和生命周期非法调用保护。

## T12：实现 once、后台和关闭控制

**文件：** `src/hook/manager.ts`、`src/hook/manager.test.ts`
**依赖：** T11

1. 用 running/completed 状态防止一次性规则重复调度。
2. 成功保留 completed，失败或取消清除状态以允许重试。
3. 后台动作按稳定顺序启动，不等待结果。
4. 后台失败异步写日志且不产生未处理 Promise rejection。
5. 关闭时停止普通事件、发布一次 system_stop、取消后台并等待最多 2 秒。
6. logger 关闭放在所有动作清理之后，重复 close 幂等。

**验证：** fake executor 覆盖并发 once、失败重试、后台延迟、关闭取消、超时放弃等待和句柄清理。

## T13：接入工具调度

**文件：** `src/agent/tool-scheduler.ts`、`src/agent/tool-scheduler.test.ts`、`src/tool/types.ts`
**依赖：** T11

1. ToolScheduler 接收可选 HookRuntime。
2. 在可见性、Plan Mode、Schema 之后按调用顺序发布 `pre_tool_use`。
3. Hook deny 转换为 `HOOK_DENIED`，不进入权限、快照和 Registry。
4. Hook allow 或失败后继续现有 PermissionManager 流程。
5. 记录实际进入 Registry 的调用；执行完成后按原索引串行发布 `post_tool_use`。
6. 保持只读 Registry 调用并发和副作用 Registry 调用串行。
7. pre/post Hook 取消不覆盖现有工具取消和 unknown streak 语义。

**验证：** 覆盖 deny/allow/失败、权限组合、系统工具、MCP、Skill 工具、只读并发、执行后顺序和结果配对。

## T14：接入 Agent Loop

**文件：** `src/agent/loop.ts`、`src/agent/loop.test.ts`
**依赖：** T11、T13

1. `AgentLoopRuntime` 增加可选 HookRuntime。
2. 每个完整模型响应发布一次 `assistant_message`，不对 delta 触发。
3. 每轮正常请求前 prepare Prompt 批次并加入 runtime reminder。
4. ContextManager 返回 ready 后、Provider 调用前 commit 批次。
5. blocked/cancelled/skipped 请求不消费 Prompt；流错误已发送请求保持已消费。
6. 手动 compact 不 prepare 或 commit Hook Prompt。
7. 内部构造参数 `hooks` 改名 `callbacks`，现有快照和记忆行为不变。

**验证：** FakeProvider 覆盖首请求、工具后请求、一次消费、上下文失败保留、流失败消费和助手消息次数。

## T15：接入 Chat 生命周期

**文件：** `src/chat/manager.ts`、`src/chat/manager.test.ts`
**依赖：** T11、T14

1. ChatManager 接收 HookManager/Runtime 生命周期依赖。
2. 普通 run 在 Agent 前触发一次 turn_start 和 user_message。
3. completed、cancelled、max iteration、unknown tool、context error、stream error 都在 finally 触发 turn_end。
4. 直接 shared/isolated Skill 命令只发布一个外层 turn 和 user_message。
5. clear/resume 按旧 session_end → 状态切换 → 新 session_start 执行。
6. close 发布一次 session_end；重复 close 不重复事件。
7. compact、本地命令和状态查询不产生 turn/message 事件。

**验证：** Chat 测试覆盖普通、计划、执行、Skill、clear、resume、取消、异常和关闭事件序列。

## T16：接入独立 Skill Agent

**文件：** `src/skill/runner.ts`、`src/skill/runner.test.ts`、`src/skill/chat-integration.test.ts`
**依赖：** T14、T15

1. SkillRunner options 接收同一个 HookRuntime。
2. 临时 AgentLoop 复用工具前后和助手消息 Hook。
3. 不在 Runner 内触发额外 turn、user_message 或 session 事件。
4. 保持独立历史隔离、Provider 选择、摘要回流和资源关闭不变。

**验证：** 断言独立 Skill 工具触发 Hook，但生命周期只记录一组外层 turn。

## T17：接入启动与系统生命周期

**文件：** `src/index.tsx`、必要的启动测试
**依赖：** T5-T16

1. MCP、Skill 和 Permission 初始化后加载并编译 Hook 配置。
2. 创建默认 logger、action executor 和 HookManager。
3. 将 HookRuntime 传给 ChatManager 和 SkillRunner。
4. TUI 启动前依次发布 system_start、session_start。
5. 关闭时依次结束 Chat session、发布 system_stop、关闭 Hook、Skill 和 MCP。
6. 启动中途失败时只关闭已创建资源，不重复生命周期事件。
7. Hook 配置错误进入现有中文启动失败输出，不泄漏环境变量值。

**验证：** 装配测试覆盖空配置、严格配置失败、启动顺序、关闭顺序和幂等清理。

## T18：更新文档与安全边界

**文件：** `README.md`、`.gitignore`
**依赖：** T5-T17

1. 记录三层路径、完整 YAML Schema 和十个事件。
2. 提供格式化、Prompt 注入、HTTP 通知和工具拦截示例。
3. 记录命令 stdin 和 pre_tool allow/deny 协议。
4. 说明 once、background、timeout 约束和无热更新行为。
5. 明确 Hook 命令/HTTP 不经过 Agent 权限系统，配置必须可信。
6. 说明日志路径、脱敏边界和子 Agent 尚未执行。

**验证：** 示例配置可被真实 loader/compiler 读取，README 无旧系统名。

## T19：执行全量验收

**文件：** `docs/hook-system/checklist.md`
**依赖：** T1-T18

1. 按 checklist 逐项执行单元、集成和端到端场景。
2. 运行 TypeScript 类型检查和全量测试。
3. 检查 Git 空白、未跟踪运行数据和敏感配置。
4. 扫描旧产品名、占位符和新增英文源码注释。
5. 把验证命令、测试数量和日期写入 checklist 顶部。
6. 只暂存本章文档、源码、测试、README、`.gitignore` 和 changelog，不提交现有 `.bettercode/` 运行数据。

**验证：**

```bash
pnpm check
git diff --check
git status --short
```

## T20：阶段性 Git 提交

**文件：** `changelogs/<hash>.md`
**依赖：** T19

1. 按仓库 super-commit 流程收集完整变更。
2. 生成中文 changelog，记录 Hook 系统设计、实现和测试证据。
3. 使用 Angular 风格中文提交信息。
4. amend changelog 文件名和提交信息后确认工作区状态。
5. 本次只提交，不推送远程。

**建议提交信息：**

```text
feat(Hook系统): 实现生命周期自动化与工具拦截
```
