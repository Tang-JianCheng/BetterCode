# BetterCode MCP 客户端 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|---|---|---|
| 修改 | `package.json` | 增加官方 MCP SDK 与 Zod 运行时依赖 |
| 修改 | `pnpm-lock.yaml` | 锁定 MCP SDK、Zod 及其传递依赖 |
| 新建 | `src/mcp/types.ts` | MCP 配置、诊断、会话、远端工具与结果类型 |
| 新建 | `src/mcp/redaction.ts` | 环境变量模板展开与敏感错误脱敏 |
| 新建 | `src/mcp/redaction.test.ts` | 多占位符、缺失变量、脱敏和长度限制测试 |
| 新建 | `src/mcp/config-loader.ts` | 用户级/项目级 YAML 加载、校验、覆盖与路径保护 |
| 新建 | `src/mcp/config-loader.test.ts` | 两层配置、字段校验、符号链接和敏感信息测试 |
| 新建 | `src/mcp/naming.ts` | 稳定 MCP 本地工具名生成与识别 |
| 新建 | `src/mcp/naming.test.ts` | 名称合法性、稳定性、长度与冲突测试 |
| 新建 | `src/mcp/sdk-session.ts` | 官方 SDK 的 stdio/Streamable HTTP 会话封装 |
| 新建 | `src/mcp/sdk-session.test.ts` | 连接、分页、调用、取消、断开、关闭和脱敏测试 |
| 新建 | `src/mcp/tool-adapter.ts` | 远端 MCP 工具到 BetterCode `Tool` 的适配 |
| 新建 | `src/mcp/tool-adapter.test.ts` | 安全分类、权限画像、结果与错误转换测试 |
| 新建 | `src/mcp/manager.ts` | 多 Server 并行发现、稳定注册、缓存与统一关闭 |
| 新建 | `src/mcp/manager.test.ts` | 故障隔离、注册顺序、幂等与生命周期测试 |
| 新建 | `src/mcp/factory.ts` | 配置加载器、生产会话和管理器组合入口 |
| 新建 | `src/mcp/integration.test.ts` | 真实本地 stdio 与 Streamable HTTP 集成测试 |
| 新建 | `src/mcp/fixtures/stdio-server.ts` | 测试用官方 MCP stdio Server |
| 新建 | `src/tool/stable-json.ts` | JSON 参数对象的确定性序列化 |
| 新建 | `src/tool/stable-json.test.ts` | 对象排序、数组语义和非法值测试 |
| 修改 | `src/tool/types.ts` | 增加 `arguments` 权限目标和 MCP 错误码 |
| 修改 | `src/tool/registry.ts` | 让 Schema validator 编译与工具注册保持原子性 |
| 修改 | `src/tool/registry.test.ts` | 无效 Schema 不残留半注册状态测试 |
| 修改 | `src/permission/sandbox.ts` | 将完整参数对象转换为稳定权限目标 |
| 修改 | `src/permission/sandbox.test.ts` | MCP 参数目标确定性与非法参数测试 |
| 修改 | `src/permission/rule-parser.ts` | `arguments` glob 匹配与离线 MCP 休眠规则 |
| 修改 | `src/permission/rule-parser.test.ts` | 参数 JSON glob、精确转义和休眠规则测试 |
| 修改 | `src/permission/config-store.test.ts` | 持久 MCP 规则离线加载与恢复测试 |
| 修改 | `src/index.tsx` | 启动发现、完整 Registry 装配和退出关闭 |
| 修改 | `src/ui/app.tsx` | 安全展示 MCP 启动诊断与外部安全边界 |

所有新增源码注释使用中文。第三方 API 名称、TypeScript 标识符和协议错误码保留其标准写法。实现阶段每组逻辑相关改动使用中文 Git 提交信息，不覆盖或回退任务开始前已有的未提交改动。

## T1：记录实现前基线

**文件：** 无

**依赖：** 无，必须在任何实现代码修改和依赖安装前完成

**步骤：**

1. 运行现有类型检查和全部测试，记录测试数量、退出状态与已有失败。
2. 检查 `git status --short`，区分前几章已有改动、已跟踪 `node_modules` 变化和本章文档。
3. 确认内置六工具、Agent Loop、系统提示和权限系统当前基线不被清理或回退。
4. 若有与本章无关的基线失败，只记录实际状态，不扩大本章修复范围。

**验证：** 运行 `pnpm check` 与 `git status --short`，期望得到可复核的实现前基线和工作区清单。

## T2：安装官方 MCP SDK 与 Zod

**文件：** `package.json`、`pnpm-lock.yaml`

**依赖：** T1

**步骤：**

1. 使用 pnpm 将 `@modelcontextprotocol/sdk@^1.29.0` 加为运行时直接依赖。
2. 将 SDK peer dependency `zod@^4.4.3` 加为运行时直接依赖。
3. 只接受 pnpm 为本次依赖解析产生的 lockfile 与已跟踪依赖目录变化。
4. 不升级现有无关直接依赖，不手工编辑 lockfile。

**验证：** 运行 `pnpm list @modelcontextprotocol/sdk zod --depth 0`，期望显示两个直接依赖及批准的版本范围；运行 `pnpm typecheck`，期望依赖安装后项目仍可编译。

## T3：定义 MCP 公共类型

**文件：** `src/mcp/types.ts`

**依赖：** T2

**步骤：**

1. 定义用户级/项目级配置层、stdio/HTTP Server 配置和联合类型。
2. 定义 `LoadedMcpConfig`、诊断代码、诊断定位字段和启动状态。
3. 定义 `McpRemoteTool`、附件摘要和中立调用结果，确保类型不携带媒体 base64。
4. 定义 `McpSession`、`McpSessionOptions` 和可注入的 `McpSessionFactory`。
5. 严格复用现有 `JsonObject` 与 `JsonSchema`，不复制工具协议结构。

**验证：** 运行 `pnpm typecheck`，期望 MCP 公共契约可独立编译且没有循环依赖。

## T4：实现模板展开与诊断脱敏

**文件：** `src/mcp/redaction.ts`

**依赖：** T3

**步骤：**

1. 实现 `expandMcpTemplate()`，支持一个字符串内重复变量和多个 `${VAR}`。
2. 只读取注入的 `ProcessEnv`，不执行 Shell 展开、命令替换或默认值语法。
3. 返回完整展开值、去重的非空秘密值和缺失变量名；缺失时不保留原占位符用于发送。
4. 实现 `redactMcpMessage()`，按秘密长度从长到短替换，并清除换行控制字符。
5. 对最终诊断设置固定最大长度，避免 stdio、HTTP 或远端正文无界进入界面。

**验证：** 使用 `pnpm exec tsx -e` 调用两个函数，期望多变量正确展开、秘密被替换为固定标记、诊断为单行且长度有界。

## T5：覆盖模板与脱敏边界

**文件：** `src/mcp/redaction.test.ts`

**依赖：** T4

**步骤：**

1. 覆盖单变量、多变量、重复变量、变量前后普通文本和空字符串变量。
2. 覆盖缺失变量，断言结果报告变量名且不会把原占位符当作可发送值。
3. 覆盖秘密互为前缀，断言较长秘密不会因替换顺序而部分泄露。
4. 覆盖换行、控制字符和超长异常文本。
5. 扫描测试得到的诊断，断言所有展开后秘密均不存在。

**验证：** 运行 `pnpm exec tsx --test src/mcp/redaction.test.ts`，期望展开、缺失和脱敏场景全部通过。

## T6：实现单层 MCP YAML 读取与校验

**文件：** `src/mcp/config-loader.ts`

**依赖：** T3、T4

**步骤：**

1. 计算 `~/.bettercode/mcp.yaml` 与 `<root>/.bettercode/mcp.yaml`，允许测试注入 `userHome` 和 `env`。
2. 使用 YAML `parseDocument()` 读取，文件不存在时返回空层。
3. YAML 语法失败只报告行列位置，不回显配置正文；重复 map key 作为解析错误处理。
4. 严格校验顶层 `servers` map 和 stdio/HTTP 各自字段白名单。
5. 校验非空 command、字符串 args/env、合法 HTTP URL 和字符串 headers。
6. 每个 Server 单独产生诊断，不因一个条目无效丢弃同层其他有效条目。

**验证：** 使用临时目录运行 `pnpm exec tsx -e` 加载一份含有效 stdio、有效 HTTP 和无效条目的单层配置，期望保留两个有效 Server 并只报告无效条目。

## T7：实现环境展开、两层覆盖与项目路径保护

**文件：** `src/mcp/config-loader.ts`

**依赖：** T6

**步骤：**

1. 对 stdio env 和 HTTP headers 的每个字符串调用模板展开，不扩展其他字段。
2. 任一引用变量缺失时禁用当前 Server，诊断仅包含变量名、配置层、文件和 Server 名称。
3. 按 Server 名合并两层，项目级同名定义完整覆盖用户级定义，不做字段深合并。
4. 记录项目层出现过的名称，使无效项目定义也能压住同名用户定义而不回退。
5. 使用 `PathGuard` 解析项目配置文件，拒绝 `.bettercode/mcp.yaml` 符号链接逃逸。
6. 汇总秘密值并对 Server 和诊断按码点顺序稳定排序。

**验证：** 使用临时用户目录与项目目录加载同名覆盖、无效覆盖和缺失变量组合，期望结果符合完整覆盖语义且诊断不包含秘密。

## T8：覆盖 MCP 配置加载行为

**文件：** `src/mcp/config-loader.test.ts`

**依赖：** T7

**步骤：**

1. 覆盖两层不存在、两层不同名、项目同名完整覆盖和项目无效覆盖不回退。
2. 覆盖单层 YAML 损坏、重复 key 和单 Server 字段错误，断言其他层/条目仍有效。
3. 覆盖 stdio 与 HTTP 必填字段、未知字段、错误数组和错误 map 值。
4. 覆盖多环境变量展开和缺失变量只禁用当前 Server。
5. 创建项目配置到根目录外的符号链接，断言该层被拒绝且用户层仍可加载。
6. 断言配置结果顺序稳定，所有诊断均不包含 env、header 或同字段其他明文秘密。

**验证：** 运行 `pnpm exec tsx --test src/mcp/config-loader.test.ts`，期望配置合并、失败隔离、路径边界和脱敏测试全部通过。

## T9：实现并测试稳定本地工具名

**文件：** `src/mcp/naming.ts`、`src/mcp/naming.test.ts`

**依赖：** T3

**步骤：**

1. 将原始 Server 名和远端工具名规范化为小写字母、数字和下划线片段。
2. 使用原始二元组计算 SHA-256，并固定追加 8 位十六进制短哈希。
3. 生成 `mcp_<server>_<tool>_<hash8>`，从 slug 部分截断以保证总长不超过 64。
4. 对空 slug、非 ASCII、标点和超长名称生成仍满足 Provider 约束的名称。
5. 实现 `isMcpToolName()`，只识别 BetterCode 生成格式。
6. 测试相同输入稳定、不同 Server 同名工具不冲突、不同原名规范化碰撞仍不冲突。

**验证：** 运行 `pnpm exec tsx --test src/mcp/naming.test.ts`，期望所有名称匹配 `^[a-z][a-z0-9_]*$`、长度不超过 64 且哈希稳定。

## T10：实现并测试稳定 JSON 序列化

**文件：** `src/tool/stable-json.ts`、`src/tool/stable-json.test.ts`

**依赖：** 无

**步骤：**

1. 实现 `stableStringifyJson()`，递归按对象 key 的码点顺序排序。
2. 保持数组顺序、字符串转义、布尔值、null 和数字 JSON 语义。
3. 拒绝循环引用、`undefined`、函数、symbol、bigint 和非有限数字。
4. 保证不同插入顺序的等价对象得到完全一致、无空白字符串。
5. 为嵌套对象、对象数组、Unicode key 和全部非法值增加测试。

**验证：** 运行 `pnpm exec tsx --test src/tool/stable-json.test.ts`，期望确定性和非法输入测试全部通过。

## T11：扩展工具权限类型与 MCP 错误码

**文件：** `src/tool/types.ts`

**依赖：** T3、T10

**步骤：**

1. 将 `ToolPermissionProfile` 改为可判别联合类型。
2. 原有 path/command/glob/value 分支继续要求 `targetArgument`，语义保持不变。
3. 新增不需要 `targetArgument` 的 `targetKind: 'arguments'` 分支。
4. 为 `ToolErrorCode` 增加 `MCP_SERVER_UNAVAILABLE`、`MCP_PROTOCOL_ERROR` 和 `MCP_TOOL_ERROR`。
5. 修正受联合类型收窄影响的现有调用点，不改变六个内置工具画像。

**验证：** 运行 `pnpm typecheck`，期望现有六工具与权限模块继续通过类型检查，`arguments` 分支不要求虚构参数名。

## T12：让 Registry 注册保持原子性

**文件：** `src/tool/registry.ts`、`src/tool/registry.test.ts`

**依赖：** T11

**步骤：**

1. 保持重复名称在任何状态修改前抛错。
2. 在 `register()` 中先使用 Ajv 编译输入 Schema validator。
3. 仅在编译成功后依次写入 tool 与 validator Map。
4. 添加无效 Schema 测试，断言工具定义、`get()`、effect 查询和后续同名有效注册均未受污染。
5. 保持定义顺序、参数校验、超时、取消和输出限制行为不变。

**验证：** 运行 `pnpm exec tsx --test src/tool/registry.test.ts`，期望无效 Schema 不留下半注册状态且全部既有 Registry 测试通过。

## T13：接入完整参数权限目标

**文件：** `src/permission/sandbox.ts`、`src/permission/sandbox.test.ts`

**依赖：** T10、T11

**步骤：**

1. `SandboxPolicy.resolveSubject()` 先按 `targetKind` 收窄工具权限画像。
2. `arguments` 分支直接对完整 input 调用 `stableStringifyJson()`，不读取 `targetArgument`，也不做路径解析。
3. 将稳定序列化失败转换为现有 `INVALID_ARGUMENTS` 工具失败。
4. 保持 path、glob、command 和 value 的现有提取与沙箱行为不变。
5. 测试参数 key 顺序无关、嵌套对象稳定、JSON 中 `/` 保留以及非法注入被拒绝。

**验证：** 运行 `pnpm exec tsx --test src/permission/sandbox.test.ts`，期望 MCP 参数目标稳定且所有既有路径/符号链接测试通过。

## T14：支持参数 glob 与离线 MCP 休眠规则

**文件：** `src/permission/rule-parser.ts`、`src/permission/rule-parser.test.ts`、`src/permission/config-store.test.ts`

**依赖：** T9、T11、T13

**步骤：**

1. 让 `arguments` 与 command/value 一样在 glob 匹配时把 `/` 当普通字符。
2. 当工具不在当前 Registry、但名称通过 `isMcpToolName()` 时，以 `arguments` 目标编译规则。
3. 保持普通未知工具、非法工具名和伪造 MCP 格式失败关闭。
4. 验证 `createExactPermissionExpression()` 能对稳定 JSON 内的 glob 元字符做字面转义。
5. 在配置存储测试中加载离线 MCP 永久规则，断言同层其他规则不失效。
6. 用相同稳定本地名称模拟 Server 恢复，断言休眠规则重新匹配完整参数目标。

**验证：** 运行 `pnpm exec tsx --test src/permission/rule-parser.test.ts src/permission/config-store.test.ts`，期望参数规则、休眠/恢复和既有未知工具保护全部通过。

## T15：构造官方 SDK transport 与连接握手

**文件：** `src/mcp/sdk-session.ts`

**依赖：** T2、T3、T4

**步骤：**

1. 实现 `McpSdkSession` 状态机与构造参数，初始状态为 `new`。
2. stdio 使用 `StdioClientTransport`，`cwd` 固定为项目根目录，环境由 `getDefaultEnvironment()` 加配置覆盖组成。
3. stdio 配置 `stderr: 'pipe'`，维护固定字节上限的尾部缓冲，不把 stderr 混入协议流。
4. HTTP 使用 `StreamableHTTPClientTransport`，通过 `requestInit.headers` 注入静态 headers，并显式设置 `maxRetries: 0`。
5. 创建空 capabilities 的官方 `Client`，不注册 Sampling、Elicitation 和工具变化处理器。
6. `connect()` 合并调用方取消与 10 秒默认超时，成功后进入 `connected`；失败分类并脱敏。

**验证：** 运行 `pnpm typecheck`，期望两种 transport 使用 SDK 稳定客户端入口正确编译；运行聚焦测试确认构造参数包含项目 `cwd` 和 `maxRetries: 0`。

## T16：实现分页工具发现

**文件：** `src/mcp/sdk-session.ts`

**依赖：** T15

**步骤：**

1. `listTools()` 只允许在 connected 状态调用，并使用独立发现超时。
2. 从无 cursor 开始调用 SDK `listTools()`，持续读取 `nextCursor` 直到结束。
3. 检测重复 cursor，并设置固定最大页数，避免错误 Server 无限分页。
4. 保留远端名称、描述和 inputSchema；只有 `annotations.readOnlyHint === true` 映射为只读。
5. 远端工具条目或结果结构异常时转换为发现错误，不泄露无界远端正文。

**验证：** 运行聚焦会话测试，期望多页工具完整汇总、缺失/false 只读提示按副作用处理、重复 cursor 明确失败。

## T17：实现调用结果转换与会话生命周期

**文件：** `src/mcp/sdk-session.ts`

**依赖：** T16

**步骤：**

1. `callTool()` 传递远端工具名、原始参数、调用方 signal 和调用超时给 SDK。
2. 转换 text、resource text 与 `structuredContent`，保持业务错误的 `isError` 标记。
3. 对 image、audio、blob resource 和 resource link 只生成有限附件摘要，不返回 base64 数据。
4. `Client.onclose` 在非主动关闭时把会话置为 `unavailable`，后续调用稳定失败且不重连。
5. `close()` 幂等关闭 Client/transport，主动关闭后状态为 `closed`。
6. 所有 transport、协议、超时、取消和关闭错误先分类、脱敏、截断再离开模块。

**验证：** 运行聚焦会话测试，期望文本/结构/媒体结果正确转换，断开后不再发请求，重复关闭不重复操作。

## T18：覆盖 SDK 会话行为

**文件：** `src/mcp/sdk-session.test.ts`

**依赖：** T17

**步骤：**

1. 使用受控 SDK Server/transport 覆盖 initialize/initialized 和客户端身份。
2. 覆盖 stdio 安全默认环境加配置覆盖、项目 cwd 和 stderr 有界缓冲。
3. 覆盖 HTTP 静态 headers 与 `maxRetries: 0`。
4. 覆盖工具多页汇总、重复 cursor、最大页数和只读提示映射。
5. 覆盖调用参数、文本、结构化内容、resource text、媒体摘要和远端 `isError`。
6. 覆盖并发调用乱序完成、调用取消、超时、意外断开、不可用状态和幂等关闭。
7. 在每类错误中放入测试秘密，断言公开错误与诊断不包含秘密。

**验证：** 运行 `pnpm exec tsx --test src/mcp/sdk-session.test.ts`，期望握手、分页、并发、转换、故障和生命周期场景全部通过且进程无残留句柄。

## T19：实现 MCP 工具适配器

**文件：** `src/mcp/tool-adapter.ts`

**依赖：** T3、T11、T17

**步骤：**

1. 实现 `McpToolAdapter` 的名称、来源描述和远端 inputSchema 映射。
2. 仅远端 `readOnly === true` 时声明 `read_only/read`，其余声明 `side_effect/execute`。
3. 所有 MCP 工具声明 `targetKind: 'arguments'` 权限画像。
4. `execute()` 使用绑定会话和原始远端工具名，原样传递完整参数与 `ToolContext.signal`。
5. 将文本片段、稳定结构化内容和附件摘要组合成有界前的 `ToolResult.output`。
6. 映射远端工具错误、协议错误和 Server 不可用错误；取消与超时继续交由 Registry 统一裁决。

**验证：** 运行 `pnpm typecheck`，期望适配器完整实现现有 `Tool` 接口且无需修改 Agent 或 Provider 契约。

## T20：覆盖适配器分类、结果与错误

**文件：** `src/mcp/tool-adapter.test.ts`

**依赖：** T19

**步骤：**

1. 断言远端名称仅用于会话调用，本地名称与来源描述用于 Registry 定义。
2. 覆盖 readOnly true、false 和缺失三种安全分类。
3. 覆盖文本、structuredContent、resource text 与多个附件摘要的输出格式。
4. 断言原始参数对象和 signal 未被复制丢字段或替换。
5. 覆盖 `MCP_TOOL_ERROR`、`MCP_PROTOCOL_ERROR` 和 `MCP_SERVER_UNAVAILABLE`。
6. 通过 Registry 执行超长结果、取消与超时，断言仍由现有限流和裁决逻辑处理。

**验证：** 运行 `pnpm exec tsx --test src/mcp/tool-adapter.test.ts`，期望安全分类、参数透传、结果转换和错误码全部通过。

## T21：实现多 Server 并行发现

**文件：** `src/mcp/manager.ts`

**依赖：** T3、T17

**步骤：**

1. 实现 `McpManager` 构造参数、默认超时选项、初始状态和可注入会话工厂。
2. `initialize()` 为每个有效 Server 创建一个会话，并并行执行 connect 与 listTools。
3. 使用 `Promise.allSettled()` 隔离 Server 失败，失败会话立即尝试关闭且不进入成功缓存。
4. 成功会话按 Server 名缓存，发现数据先保留而不按网络完成顺序注册。
5. 将配置加载诊断与连接、初始化、发现诊断合并为脱敏启动状态。

**验证：** 使用延迟不同的假会话运行管理器测试，期望初始化时间体现并行、失败 Server 被关闭、成功 Server 保留。

## T22：实现稳定工具注册与故障隔离

**文件：** `src/mcp/manager.ts`

**依赖：** T9、T12、T19、T21

**步骤：**

1. 等所有发现任务完成后，按 Server 名和远端工具名码点顺序串行注册。
2. 为每个工具生成稳定本地名称并创建 `McpToolAdapter`。
3. 捕获 Registry 重名和 Ajv Schema 编译错误，分别生成工具冲突或 Schema 诊断。
4. 单个无效工具只被跳过，同 Server 和其他 Server 的有效工具继续注册。
5. 统计 configuredServers、connectedServers 和 registeredTools，不把秘密或完整响应写入状态。
6. 重复 `initialize()` 返回现有状态，不重新连接或重复注册。

**验证：** 使用乱序假 Server 和含非法 Schema 的工具集运行管理器测试，期望定义顺序稳定、有效工具可执行且无效项只有对应诊断。

## T23：实现管理器统一关闭

**文件：** `src/mcp/manager.ts`

**依赖：** T22

**步骤：**

1. `close()` 对所有已创建且尚未关闭的会话使用 `Promise.allSettled()`。
2. 一个会话关闭失败只产生 `CLOSE_ERROR`，不阻止其他会话关闭。
3. 主动关闭前后的缓存状态保持可预测，不允许关闭后再次初始化或调用。
4. 重复 `close()` 不重复关闭 transport，并返回稳定诊断。
5. 关闭错误沿用会话脱敏策略，不包含环境变量、header 或无界 stderr。

**验证：** 使用一个正常关闭和一个抛错的假会话，期望两者都收到一次关闭调用，结果只含一个脱敏关闭诊断，第二次 close 不增加调用次数。

## T24：覆盖管理器编排与生命周期

**文件：** `src/mcp/manager.test.ts`

**依赖：** T23

**步骤：**

1. 覆盖多 Server 并行发现和稳定注册顺序。
2. 分别模拟连接、初始化、发现、Schema 和名称冲突失败，断言其他 Server 与内置工具不受影响。
3. 覆盖全部 Server 失败和空配置，断言 Registry 仍只包含原内置工具。
4. 覆盖同一 Server 多工具共享一个会话、重复 initialize 不重复注册。
5. 覆盖意外断开后已注册工具返回不可用且不会创建新会话。
6. 覆盖幂等 close 与单个关闭失败隔离，并扫描所有诊断无秘密。

**验证：** 运行 `pnpm exec tsx --test src/mcp/manager.test.ts`，期望发现、注册、降级、缓存和关闭测试全部通过。

## T25：实现生产组合入口

**文件：** `src/mcp/factory.ts`

**依赖：** T7、T17、T23

**步骤：**

1. 实现 `createMcpManager(rootDir, options)`。
2. 使用 `McpConfigLoader` 读取两层配置，并把结果传入 `McpManager`。
3. 默认会话工厂创建 `McpSdkSession`，统一传入真实项目根目录和超时选项。
4. 保留 userHome、env、超时和 sessionFactory 注入点，避免测试读取真实用户配置或访问公网。
5. 不在 factory 中初始化连接或吞掉诊断，生命周期仍由启动入口控制。

**验证：** 运行 `pnpm typecheck`，并用临时空配置调用 factory，期望只构造未初始化管理器且状态为零 Server。

## T26：创建真实 stdio 测试 Server

**文件：** `src/mcp/fixtures/stdio-server.ts`

**依赖：** T2

**步骤：**

1. 使用官方 `McpServer` 与 `StdioServerTransport` 创建最小测试 Server。
2. 暴露明确只读 echo、可控延迟 echo、返回业务错误和媒体摘要输入的工具。
3. 启动时向 stderr 输出固定诊断，证明 stderr 不污染 stdout 协议。
4. 支持通过环境变量验证配置 env 已展开并覆盖默认值，但不打印该值。
5. 进程断开或收到终止时关闭 Server，避免测试残留子进程。

**验证：** 由父进程运行 fixture 并通过官方客户端完成一次 initialize/list/call/close，期望 echo 返回且测试结束后子进程退出。

## T27：覆盖真实 stdio 集成流程

**文件：** `src/mcp/integration.test.ts`

**依赖：** T18、T22、T26

**步骤：**

1. 在临时项目配置 stdio fixture，使用真实 `McpSdkSession` 和 `McpManager` 启动。
2. 验证初始化、工具发现、稳定注册、权限画像和 echo 调用完整链路。
3. 并发调用不同延迟工具，断言每个调用得到自己的结果。
4. 触发业务错误和超时/取消，断言只产生一个最终结构化结果。
5. 验证 stderr 固定文本不污染协议，close 后 fixture 子进程退出。

**验证：** 运行 `pnpm exec tsx --test --test-name-pattern=stdio src/mcp/integration.test.ts`，期望 stdio 握手、并发、错误和进程回收场景通过。

## T28：覆盖真实 Streamable HTTP 集成流程

**文件：** `src/mcp/integration.test.ts`

**依赖：** T18、T22

**步骤：**

1. 在 `127.0.0.1` 随机端口启动官方 `McpServer` 与 `StreamableHTTPServerTransport`，不访问公网。
2. 验证初始化请求携带展开后的静态 header，并正确维持 MCP session id。
3. 完成分页工具发现、稳定注册、工具调用和并发乱序响应配对。
4. 主动终止 Server 后再次调用，断言返回不可用且没有新 HTTP 会话或自动重试。
5. 在认证失败和协议失败中注入测试秘密，断言诊断、工具结果和测试输出均不泄露。
6. 测试结束统一关闭 HTTP Server、transport 和 Manager，避免残留句柄。

**验证：** 运行 `pnpm exec tsx --test --test-name-pattern=HTTP src/mcp/integration.test.ts`，期望 header、会话、调用、断开和禁用重连场景通过。

## T29：在 TUI 安全展示 MCP 启动诊断

**文件：** `src/ui/app.tsx`

**依赖：** T3、T24

**步骤：**

1. 为 `App` 增加可选 `mcpStatus` 属性，不改变现有调用者的必填契约。
2. 将 MCP 诊断格式化为 Server 数量摘要和逐项中文原因。
3. 初始消息同时保留权限配置诊断与 MCP 诊断，不让一类覆盖另一类。
4. 未配置 MCP 或全部成功时不增加初始聊天消息。
5. 在存在 MCP 工具/诊断时明确外部 Server 不受 BetterCode 文件沙箱和命令黑名单强制保护。
6. 展示只消费已脱敏状态字段，不访问 Server 配置、header、env 或原始异常。

**验证：** 运行 `pnpm typecheck`，并以空状态、成功状态和含诊断状态渲染 App，期望前两者无噪声、后者显示脱敏原因与准确安全边界。

## T30：接入启动顺序与退出关闭

**文件：** `src/index.tsx`

**依赖：** T25、T29

**步骤：**

1. 保持 CLI 和 Provider 配置先完成，再创建内置 ToolRegistry。
2. 创建并初始化 McpManager，把发现工具注册到同一 Registry。
3. MCP 空配置、部分失败或全部失败均继续创建 PermissionManager 与 ChatManager。
4. 只有在 MCP 注册结束后创建 PermissionManager，使在线 MCP 工具进入规则加载与判权。
5. 将 `mcpStatus` 传给 TUI，不改变 Agent、Provider 或 ChatManager 的工具调用协议。
6. 用 `try/finally` 包住 TUI 生命周期，`waitUntilExit()` 结束或渲染异常时都关闭 Manager。
7. 关闭诊断只以已脱敏单行文本写 stderr，单个关闭失败不改变正常退出流程。

**验证：** 运行 `pnpm typecheck`，并使用临时空 MCP 配置启动到 TUI 后退出，期望 BetterCode 正常启动、六个内置工具仍可用且 Manager 完成关闭。

## T31：验证权限、Plan Mode 与 Agent 调度集成

**文件：** `src/mcp/tool-adapter.test.ts`、`src/mcp/manager.test.ts`、`src/permission/manager.test.ts`、`src/agent/tool-scheduler.test.ts`

**依赖：** T20、T24、T30

**步骤：**

1. 将只读和副作用 MCP 适配器注册到真实 ToolRegistry，并创建真实 PermissionManager。
2. 断言默认模式未命中规则时产生人工确认请求，目标是完整参数稳定 JSON。
3. 断言严格和放行模式继续沿用现有定义，MCP 工具不绕过规则引擎。
4. 断言永久精确规则、glob 规则和离线恢复均匹配同一稳定本地名称。
5. 断言 Plan Mode definitions 只包含 `readOnlyHint === true` 的 MCP 工具。
6. 断言同批只读 MCP 工具可并发，副作用 MCP 工具保持串行，拒绝或失败结果继续回灌 Agent Loop。

**验证：** 运行 `pnpm exec tsx --test src/mcp/tool-adapter.test.ts src/mcp/manager.test.ts src/permission/manager.test.ts src/agent/tool-scheduler.test.ts`，期望权限模式、规则、Plan Mode 和调度行为全部通过。

## T32：执行全量回归与静态检查

**文件：** 本任务涉及的全部文件

**依赖：** T27、T28、T31

**步骤：**

1. 运行 TypeScript 严格类型检查和全部自动化测试。
2. 重复运行 MCP 集成测试，确认随机端口、子进程和关闭逻辑无偶发残留。
3. 扫描 MCP 源码与测试，确认没有真实 API Key、公网 MCP 地址、base64 正文和无界错误输出。
4. 扫描新增源码注释，确认使用中文；标准协议名和第三方标识符无需翻译。
5. 运行占位符、旧产品名和文档完整性扫描。
6. 运行 `git diff --check`，确认无空白错误；检查 `git status --short`，区分本章改动与用户已有改动。
7. 按后续批准的 `checklist.md` 逐项验收，并记录实际命令与结果。

**验证：** 运行 `pnpm check`、`pnpm exec tsx --test src/mcp/integration.test.ts`、`rg -n "T[B]D|T[O]DO|Mew[C]ode|sk-[A-Za-z0-9]|data:[^,]+;base64" src/mcp docs/mcp-client` 和 `git diff --check`；期望类型检查与测试全部通过，扫描无未处理命中，差异检查无错误。

## 执行顺序

```text
T1 -> T2 -> T3 -> T4 -> T5
                  |      \
                  |       -> T6 -> T7 -> T8
                  |       -> T15 -> T16 -> T17 -> T18
                  -> T9

T10 -> T11 -> T12
          |      \
          |       -> T13 -> T14
          -> T19 -> T20

T9 + T12 + T17 + T19 -> T21 -> T22 -> T23 -> T24
T7 + T17 + T23 -> T25
T2 -> T26 -> T27
T18 + T22 -> T28
T24 -> T29 -> T30
T20 + T24 + T30 -> T31
T27 + T28 + T31 -> T32
```

可并行组：T4/T9/T10；T5/T6；T12/T15；T14/T18/T20；T26 与 T21-T25。凡共享同一文件的任务仍按编号串行执行，避免覆盖同文件中的前序改动。

## 增量任务：项目根 `.mcp.json` 配置桥接

### T33：接入兼容配置来源

**文件：** `src/mcp/config-loader.ts`

**步骤：**

1. 在项目路径保护下发现根目录 `.mcp.json`。
2. 解析 `mcpServers`，逐 Server 归一化 stdio 与 Streamable HTTP 字段。
3. 复用现有 Server 校验、环境变量展开和秘密收集逻辑。
4. 按用户 YAML、兼容 JSON、项目 YAML 的顺序完整覆盖。
5. 隔离 JSON 语法错误、单 Server 错误和符号链接逃逸。

**验证：** 运行 `pnpm exec tsx --test src/mcp/config-loader.test.ts`，期望兼容格式、覆盖和安全场景全部通过。

### T34：验证统一工具链闭环

**文件：** `src/mcp/config-loader.test.ts`、`src/mcp/integration.test.ts`

**步骤：**

1. 增加无显式类型的 stdio 配置和显式 HTTP 配置转换测试。
2. 增加三层同名覆盖与不同名合并测试。
3. 增加非法 JSON、缺失环境变量、无效兄弟 Server 和符号链接逃逸测试。
4. 让真实本地 HTTP MCP 集成测试从 `.mcp.json` 启动。
5. 断言远端工具仍进入统一 Registry，完成发现、调用、错误处理和关闭。

**验证：** 运行 `pnpm exec tsx --test src/mcp/config-loader.test.ts src/mcp/integration.test.ts`。

### T35：补充文档并执行回归

**文件：** `docs/mcp-client/spec.md`、`docs/mcp-client/plan.md`、`docs/mcp-client/task.md`、`docs/mcp-client/checklist.md`

**步骤：**

1. 以增量章节记录问题根因、兼容边界和覆盖优先级。
2. 明确兼容层复用现有 MCP 适配和 Agent 调用链。
3. 运行 MCP 聚焦测试、TypeScript 类型检查和全量项目检查。
4. 扫描敏感信息、旧产品名、空白错误和未跟踪用户文件。
5. 创建中文 Git 阶段检查点，只提交本次源码、测试和文档。

**验证：** 运行 `pnpm check`、`git diff --check` 和针对 `src/mcp`、`docs/mcp-client` 的静态扫描。

### 增量执行顺序

```text
T33 -> T34 -> T35
```

## T: /mcp 命令与面板

**文件：** `src/mcp/types.ts`、`src/mcp/manager.ts`、`src/bootstrap/application.ts`、`src/index.tsx`、`src/ui/mcp-dialog.tsx`、`src/command/types.ts`、`src/command/builtins.ts`、`src/ui/app.tsx`

**步骤：**

1. `McpServerToolListing` 类型 + `McpManager.listServerTools()`（初始化时记录每 Server 工具，含失败 server 标 `connected:false`）。
2. `application` 暴露 `mcpServerTools`，`index.tsx` 注入 App props。
3. `McpDialog` 两级动态面板（服务器 → 工具），遵循动态面板交互约束。
4. 注册 `/mcp` 命令、`CommandUIController.showMcpTools`、App 接线。
5. 测试覆盖 dialog、builtins/dispatcher、app 集成、manager 工具清单。

**验证：** `pnpm exec tsx --test src/ui/mcp-dialog.test.ts src/mcp/manager.test.ts src/ui/app.test.ts` 与全量 `pnpm check`。
