# BetterCode MCP 客户端 Checklist

> 每一项都通过运行代码、测试或观察终端行为验证。自动化测试只使用临时目录、本地子进程、`127.0.0.1` 随机端口或受控假会话，不访问真实模型 API 和公网 MCP Server。实现完成前所有项目保持未勾选。

## 配置加载与敏感信息

- [ ] **C1：空配置正常降级**  
  用户级和项目级 MCP 配置都不存在时，加载结果包含零个 Server、零条配置诊断，BetterCode 仍能创建内置工具 Registry。（验证：运行 `pnpm exec tsx --test src/mcp/config-loader.test.ts src/mcp/manager.test.ts` 的空配置场景；覆盖 AC1、AC10）

- [ ] **C2：两层不同名配置完整合并**  
  用户级和项目级分别声明不同 Server 时，两者都出现在加载结果中，顺序不受 YAML 声明顺序影响。（验证：运行配置合并与稳定排序测试；覆盖 AC1）

- [ ] **C3：项目同名配置完整覆盖**  
  两层存在同名 Server 时，只保留项目级完整定义，用户级 command、args、env、URL 或 headers 不会被深度拼接。（验证：运行同名覆盖测试并比较最终配置对象；覆盖 AC1）

- [ ] **C4：无效项目覆盖不回退**  
  项目层存在无效同名定义时，该 Server 被禁用并产生项目层诊断，不恢复被覆盖的用户级定义。（验证：运行无效覆盖测试并检查连接工厂调用次数为零；覆盖 AC1）

- [ ] **C5：单层损坏不影响另一层**  
  分别损坏用户级和项目级 YAML，确认损坏层视为空层，另一层的有效 Server 仍可加载。（验证：运行 YAML 语法错误、重复 key 和跨层隔离测试；覆盖 AC1）

- [ ] **C6：单个 Server 配置错误被隔离**  
  同层同时包含有效和无效条目时，有效条目继续加载，无效条目只产生自己的诊断。（验证：运行 transport、必填字段、字段类型和未知字段矩阵测试；覆盖 AC1）

- [ ] **C7：项目配置符号链接逃逸被拒绝**  
  项目 `.bettercode/mcp.yaml` 指向根目录外时，该项目层不被读取，外部文件内容不出现在诊断中，用户层仍可正常工作。（验证：运行临时目录符号链接测试并扫描诊断；覆盖 AC1、AC14）

- [ ] **C8：环境变量支持多次和多变量展开**  
  stdio env 与 HTTP headers 中同一变量重复出现或多个变量组合时，最终传输配置得到正确完整值。（验证：运行 `pnpm exec tsx --test src/mcp/redaction.test.ts src/mcp/config-loader.test.ts`；覆盖 AC2）

- [ ] **C9：缺失环境变量只禁用对应 Server**  
  一个 Server 引用缺失变量时不发送原占位符、不尝试连接，其他有效 Server 保持可用；诊断只显示缺失变量名和定位信息。（验证：运行缺失变量隔离测试并检查会话工厂调用记录；覆盖 AC2、AC14）

- [ ] **C10：配置与模板诊断不泄露秘密**  
  在 header/env 模板的普通文本、变量值和错误正文中放入测试秘密，确认配置诊断、状态对象和测试捕获输出均不包含任何秘密片段。（验证：运行配置与脱敏测试，并对捕获结果执行秘密字符串扫描；覆盖 AC2、AC14）

## 命名与参数目标

- [ ] **C11：本地 MCP 工具名合法且稳定**  
  相同 Server/工具输入在多次运行中产生相同名称，名称符合 `^[a-z][a-z0-9_]*$` 且最长 64 个字符。（验证：运行 `pnpm exec tsx --test src/mcp/naming.test.ts`；覆盖 AC6）

- [ ] **C12：同名与规范化碰撞不会覆盖**  
  两个 Server 暴露同名工具，或两组原名规范化后 slug 相同，最终名称仍因稳定哈希不同而互不冲突。（验证：运行命名碰撞测试并比较名称集合；覆盖 AC6）

- [ ] **C13：名称不依赖发现顺序**  
  交换 Server 响应先后和工具列表顺序后，每个来源二元组仍得到相同本地名称。（验证：重复运行管理器乱序发现测试；覆盖 AC6）

- [ ] **C14：参数对象稳定序列化**  
  key 插入顺序不同但语义相同的嵌套 JSON 参数生成完全相同的无空白权限目标，数组顺序保持不变。（验证：运行 `pnpm exec tsx --test src/tool/stable-json.test.ts src/permission/sandbox.test.ts`；覆盖 AC12）

- [ ] **C15：非 JSON 参数失败关闭**  
  循环引用、undefined、函数、symbol、bigint 和非有限数字不能形成权限目标，返回明确参数错误而非崩溃或宽泛授权。（验证：运行稳定 JSON 非法输入矩阵测试；覆盖 AC12）

- [ ] **C16：无效 Schema 不留下半注册工具**  
  注册 Ajv 无法编译的 Schema 后，Registry 的定义、查询、effect 和 validator 状态均不包含该工具，随后同名有效工具仍可注册。（验证：运行 `pnpm exec tsx --test src/tool/registry.test.ts` 的原子注册场景；覆盖 AC7）

## 会话与协议

- [ ] **C17：stdio 完成标准握手**  
  本地测试子进程收到 initialize 并完成 initialized，随后能响应 tools/list 和 tools/call。（验证：运行 `pnpm exec tsx --test --test-name-pattern=stdio src/mcp/integration.test.ts`；覆盖 AC3）

- [ ] **C18：stdio 使用项目工作目录和安全环境**  
  测试 Server 观察到 cwd 为项目根目录，环境由 SDK 安全默认值与配置覆盖组成，未配置的 BetterCode 私有环境变量不会被无条件继承。（验证：运行 stdio 环境集成测试并检查 Server 返回的非敏感探针值；覆盖 AC3、AC14）

- [ ] **C19：stdio stderr 不污染协议**  
  fixture 持续向 stderr 写诊断时，握手、工具发现和调用仍正确；公开错误只包含有界、脱敏的 stderr 摘要。（验证：运行 stdio stderr 与超长错误测试；覆盖 AC3、AC14）

- [ ] **C20：Streamable HTTP 完成标准握手**  
  本地 HTTP Server 能完成 initialize/initialized、工具发现和调用，并正确维持协议会话标识。（验证：运行 `pnpm exec tsx --test --test-name-pattern=HTTP src/mcp/integration.test.ts`；覆盖 AC4）

- [ ] **C21：HTTP 静态 headers 正确发送**  
  展开后的自定义 header 到达本地 Server，未配置 header 不被凭空加入；header 值不进入模型工具定义或公开诊断。（验证：运行 HTTP header 集成测试并扫描 Registry definitions 与诊断；覆盖 AC4、AC14）

- [ ] **C22：工具列表分页完整且有界**  
  多页 `nextCursor` 被完整汇总；重复 cursor 或超过最大页数时发现失败并关闭当前会话，不无限请求。（验证：运行 `pnpm exec tsx --test src/mcp/sdk-session.test.ts` 的分页场景；覆盖 AC3、AC4）

- [ ] **C23：并发响应乱序仍正确配对**  
  同一 Server 上并发调用不同延迟工具时，每个调用只取得对应结果，快请求不会完成慢请求的 Promise。（验证：运行 stdio 与 HTTP 并发延迟集成测试；覆盖 AC5）

- [ ] **C24：未知、重复或迟到响应不串线**  
  受控协议测试注入未知、重复和取消后迟到响应，确认它们不会完成其他活动调用或产生第二个结果。（验证：运行 SDK 会话响应关联测试并按调用 ID 统计结果；覆盖 AC5、AC8）

- [ ] **C25：连接、发现和调用均有超时边界**  
  分别让 Server 在握手、tools/list 和 tools/call 阶段无响应，确认等待在配置上限内结束，其他 Server 或 Agent 继续运行。（验证：运行 SDK 会话与管理器超时测试并断言耗时范围；覆盖 AC8、AC10）

- [ ] **C26：调用取消传递到协议层**  
  工具调用期间触发 AbortSignal 后，本地等待及时结束为 `CANCELLED`，迟到响应不覆盖取消结果，也不启动下一次调用。（验证：运行会话、Registry 与 Agent 调度取消测试；覆盖 AC8）

## 工具适配与结果

- [ ] **C27：远端定义无感进入 Registry**  
  Provider 看到 MCP 工具的稳定本地名称、来源描述和原始 inputSchema，不看到本地 effect、权限画像、会话对象或秘密配置。（验证：运行适配器与管理器测试，检查 `registry.definitions()`；覆盖 AC6、AC14）

- [ ] **C28：调用路由回正确 Server 和远端工具**  
  两个 Server 暴露同名工具时，通过各自本地名称调用会到达正确会话和原始远端工具名，参数对象保持完整。（验证：运行双 Server 适配器调用测试并检查会话调用记录；覆盖 AC6）

- [ ] **C29：明确只读提示映射为只读**  
  只有 `readOnlyHint === true` 的远端工具映射为 `read_only` 与 read 风险，允许进入 Plan Mode 和只读并发组。（验证：运行适配器与 Scheduler 分类测试；覆盖 AC12、AC13）

- [ ] **C30：缺失或 false 提示采用副作用默认**  
  未提供 readOnlyHint 或明确为 false 的工具映射为 `side_effect` 与 execute 风险，不进入 Plan Mode，并按副作用串行执行。（验证：运行三种 annotation 矩阵测试；覆盖 AC12、AC13）

- [ ] **C31：文本与结构化结果完整转换**  
  远端 text、resource text 和 structuredContent 转成模型可理解的单个工具结果，内容次序和 JSON 数据保持可辨识。（验证：运行 `pnpm exec tsx --test src/mcp/tool-adapter.test.ts` 的结果矩阵；覆盖 AC8）

- [ ] **C32：媒体内容只进入有限摘要**  
  image、audio、blob resource 和 resource link 只返回类型、MIME、URI、名称或大小等摘要，输出和对话历史中没有 base64 正文。（验证：运行媒体结果测试并扫描 `ToolResult.output` 与 Agent 历史；覆盖 AC8、AC14）

- [ ] **C33：远端业务错误保持结构化失败**  
  MCP `isError` 结果映射为唯一 `MCP_TOOL_ERROR`，保留有限业务说明和原调用标识，不被误报为成功。（验证：运行适配器业务错误测试；覆盖 AC8）

- [ ] **C34：协议错误与不可用可稳定区分**  
  JSON-RPC/结果格式异常返回 `MCP_PROTOCOL_ERROR`，连接断开返回 `MCP_SERVER_UNAVAILABLE`，两者都不会抛崩 Agent Loop。（验证：运行适配器错误矩阵和 Agent 失败回灌测试；覆盖 AC8、AC11）

- [ ] **C35：每次调用恰好一个最终结果**  
  成功、业务错误、协议错误、断开、超时和取消场景均按原 toolCallId 产生且只产生一个 tool result，历史中没有孤立或重复调用。（验证：运行适配器、Scheduler 与 Agent 历史关联测试；覆盖 AC8）

- [ ] **C36：结果仍受 Registry 输出限制**  
  远端返回超长文本或结构化内容时，最终 ToolResult 按现有字节上限截断并带正确元数据，不无界进入对话。（验证：运行适配器经 Registry 执行的超长结果测试；覆盖 AC8、AC14）

## 管理器与生命周期

- [ ] **C37：多个 Server 并行初始化**  
  两个带独立延迟的 Server 同时开始连接，总耗时接近最慢单个 Server 而不是两者之和。（验证：运行 `pnpm exec tsx --test src/mcp/manager.test.ts` 的并行屏障测试；覆盖 AC9、AC10）

- [ ] **C38：注册顺序不受网络完成顺序影响**  
  多次交换 Server 与 tools/list 完成顺序后，Registry definitions 始终按 Server 名和远端工具名稳定排列。（验证：重复运行乱序管理器测试并比较完整名称数组；覆盖 AC6）

- [ ] **C39：单个无效工具不影响同批有效工具**  
  同一 Server 同时返回有效工具、非法 Schema 和注册冲突工具时，有效工具仍可调用，无效项各自生成带 Server/工具定位的诊断。（验证：运行混合工具注册测试；覆盖 AC7）

- [ ] **C40：单个 Server 失败不影响其他能力**  
  同时配置正常、拒绝连接、握手失败和发现失败的 Server，正常 MCP 工具与六个内置工具继续可用。（验证：运行故障矩阵管理器测试并实际执行一个正常 MCP 工具和一个内置工具；覆盖 AC10）

- [ ] **C41：全部 MCP Server 失败仍可启动**  
  所有 Server 都失败时，BetterCode 继续创建权限系统、ChatManager 和 TUI，Registry 保持内置工具，不把 MCP 降级误报为全局启动失败。（验证：运行管理器降级测试，并执行一次失败配置 TUI 冒烟；覆盖 AC10）

- [ ] **C42：同一 Server 会话被复用**  
  工具发现后连续调用同 Server 的多个工具，子进程启动/HTTP initialize/Client connect 各只发生一次。（验证：运行会话计数测试；覆盖 AC9）

- [ ] **C43：重复初始化保持幂等**  
  对同一 Manager 重复调用 initialize，不新增连接、不重复注册，返回状态与首次结果一致。（验证：运行管理器重复初始化测试并检查连接与定义计数；覆盖 AC9）

- [ ] **C44：断开后不自动重连**  
  已连接 stdio 或 HTTP Server 被终止后，后续调用稳定返回不可用；子进程启动数、HTTP 会话数和 initialize 数都不再增长。（验证：运行两种传输的断开后调用测试；覆盖 AC11）

- [ ] **C45：关闭回收全部活动会话**  
  BetterCode 正常退出后所有 Client/transport 都关闭，stdio 子进程退出，HTTP Server 无活动会话，测试进程无残留句柄。（验证：运行集成测试并检查 close、exit 与 Node 测试进程自行结束；覆盖 AC3、AC9）

- [ ] **C46：关闭失败互相隔离且 close 幂等**  
  一个会话关闭抛错时其他会话仍关闭，生成单条脱敏 `CLOSE_ERROR`；第二次 close 不重复操作。（验证：运行管理器关闭失败与幂等测试；覆盖 AC9）

## 权限、Plan Mode 与界面

- [ ] **C47：全部 MCP 调用先经过权限系统**  
  默认模式未命中规则时，MCP 调用在远端执行前产生权限请求；用户拒绝后会话调用计数保持零。（验证：运行真实 Registry + PermissionManager + MCP 适配器集成测试；覆盖 AC12）

- [ ] **C48：权限规则匹配稳定名称和完整参数**  
  工具级、精确和 glob 规则使用本地 MCP 名称匹配，精确目标是完整稳定 JSON；参数 key 顺序变化不影响命中。（验证：运行规则解析、沙箱和权限管理器组合测试；覆盖 AC12）

- [ ] **C49：离线永久 MCP 规则可休眠与恢复**  
  Server 离线时已持久化的合法 MCP 规则不会使整个权限层失效，也不能被 Agent 调用；相同工具名恢复注册后规则重新生效。（验证：运行 `pnpm exec tsx --test src/permission/rule-parser.test.ts src/permission/config-store.test.ts`；覆盖 AC12）

- [ ] **C50：Plan Mode 只暴露明确只读 MCP 工具**  
  `/plan` 的 Provider definitions 包含 readOnlyHint 为 true 的 MCP 工具，不包含缺失/false 提示的工具；后者即使被模型猜中也不执行。（验证：运行 Agent/ChatManager 的 Plan Mode 工具定义和不可用调用测试；覆盖 AC12、AC13）

- [ ] **C51：三档权限模式保持现有语义**  
  MCP 工具在 strict/default/allow 下分别遵循严格拒绝、人工确认和未命中放行；显式 deny 规则始终优先于模式。（验证：运行 PermissionManager MCP 模式矩阵测试；覆盖 AC12）

- [ ] **C52：MCP 安全边界如实展示**  
  用户可见诊断或帮助明确说明外部 MCP Server 不受 BetterCode 文件沙箱和危险命令黑名单强制保护，不宣称 cwd 等于隔离。（验证：启动含 MCP 诊断的 TUI 并检查初始消息；覆盖 AC13）

- [ ] **C53：启动诊断展示有信息且无噪声**  
  有 MCP 错误时 TUI 同时显示 Server 摘要、逐项原因和已有权限诊断；空配置或全部成功时不添加无意义初始消息。（验证：分别使用三种状态渲染 TUI 并观察消息列表；覆盖 AC10、AC14）

- [ ] **C54：界面诊断不泄露认证信息**  
  用包含测试 Token 的配置触发配置、连接、握手、发现、调用和关闭错误，终端可见文本中均找不到 Token。（验证：捕获 TUI/stdout/stderr 并执行精确秘密字符串扫描；覆盖 AC14）

## 编译、测试与回归

- [ ] **C55：TypeScript 严格类型检查通过**  
  新增 SDK 类型、Tool 联合类型和启动装配没有类型错误。（验证：运行 `pnpm typecheck`）

- [ ] **C56：MCP 单元测试全部通过**  
  配置、脱敏、命名、会话、适配器和管理器测试零失败、零意外跳过。（验证：运行 `pnpm exec tsx --test src/mcp/*.test.ts`；覆盖 AC16）

- [ ] **C57：stdio 与 HTTP 本地集成测试通过**  
  两类真实 transport 测试零失败，并在结束后自行退出，不依赖公网和真实模型。（验证：运行 `pnpm exec tsx --test src/mcp/integration.test.ts`；覆盖 AC3-AC5、AC9、AC16）

- [ ] **C58：工具与权限回归通过**  
  六个内置工具、PathGuard、Registry、权限模式、规则和人工确认测试保持通过。（验证：运行 `pnpm exec tsx --test src/tool/*.test.ts src/permission/*.test.ts`；覆盖 AC12、AC15）

- [ ] **C59：Agent 与 Chat 回归通过**  
  Agent Loop、多工具调度、拒绝后恢复、Plan Mode 和 ChatManager 测试保持通过。（验证：运行 `pnpm exec tsx --test src/agent/*.test.ts src/chat/*.test.ts`；覆盖 AC12、AC15）

- [ ] **C60：Provider 回归通过**  
  OpenAI 兼容 Provider 和 Anthropic Provider 的流式文本、工具调用、缓存字段及错误处理测试保持通过。（验证：运行 `pnpm exec tsx --test src/provider/*.test.ts`；覆盖 AC6、AC15）

- [ ] **C61：完整自动化检查通过**  
  项目严格类型检查和全部测试退出码为 0，无未处理 Promise、残留子进程、开放 HTTP Server 或挂起定时器。（验证：运行 `pnpm check` 并记录测试数量与进程正常退出；覆盖 AC15、AC16）

- [ ] **C62：自动化测试不使用外部服务**  
  测试只连接 `127.0.0.1` 或 stdio fixture，不读取真实 `~/.bettercode/mcp.yaml`，不调用真实 LLM API，也不执行危险 Shell 命令。（验证：审阅测试注入点，并运行 `rg -n "https?://|api[_-]?key|sk-" src/mcp src/**/*.test.ts` 逐项确认命中均为本地地址或测试假值；覆盖 AC16）

- [ ] **C63：敏感值与媒体正文静态扫描通过**  
  MCP 源码、测试、文档和捕获快照中没有真实 Token、认证 header 值或内嵌 base64 媒体正文。（验证：运行 `rg -n "sk-[A-Za-z0-9]|Bearer [A-Za-z0-9._-]{12,}|data:[^,]+;base64" src/mcp docs/mcp-client` 并审阅所有命中；覆盖 AC14）

- [ ] **C64：代码与补丁规范通过**  
  新增源码注释使用中文，产品名统一为 BetterCode，无占位内容、冲突标记、尾随空格或无关文件回退。（验证：运行 `rg -n "T[B]D|T[O]DO|Mew[C]ode|<{7}|={7}|>{7}" src/mcp docs/mcp-client`、`git diff --check` 和 `git status --short`）

## 端到端场景

- [ ] **E1：stdio 工具完整闭环**  
  在临时项目配置官方 stdio fixture，启动 BetterCode 后发现 echo 工具；允许调用后 Agent 收到正确结果并完成回复，退出后 fixture 进程被回收。（验证：自动化集成测试加一次本地 TUI 冒烟；覆盖 AC3、AC6、AC8、AC9）

- [ ] **E2：Streamable HTTP 工具完整闭环**  
  在 `127.0.0.1` 随机端口启动测试 Server，通过环境变量 header 完成握手、发现和调用；会话标识正确，终端和历史不显示认证值。（验证：自动化 HTTP 集成测试加一次本地 TUI 冒烟；覆盖 AC4、AC6、AC8、AC14）

- [ ] **E3：并发同名工具正确路由**  
  两个 Server 暴露同名延迟工具，模型同轮调用两个稳定本地名称；调用并发、结果按原 toolCallId 回灌，并在下一轮得到正确汇总。（验证：管理器 + Scheduler + Agent 自动化端到端测试；覆盖 AC5、AC6、AC8）

- [ ] **E4：故障 Server 与正常 Server 共存**  
  同时配置正常、拒绝连接、握手失败和发现失败的 Server，BetterCode 显示脱敏诊断，正常 MCP 工具和内置读文件工具仍能完成任务。（验证：自动化故障矩阵加一次 TUI 状态观察；覆盖 AC7、AC10、AC14）

- [ ] **E5：断开后 Agent 调整**  
  已注册 Server 在首次调用后退出，第二次调用返回稳定不可用结果且不重连；Agent 收到结果后改用其他可用工具或给出说明，主进程继续运行。（验证：Fake Provider + 真实本地 Server 的 Agent 集成测试；覆盖 AC8、AC11）

- [ ] **E6：MCP 权限与 Plan/Do 两阶段**  
  `/plan` 只能使用明确只读 MCP 工具；`/do` 恢复全部工具并对副作用 MCP 工具重新判权，拒绝时远端未执行，允许后完成任务。（验证：自动化 ChatManager/Agent 测试加一次 TUI 权限交互；覆盖 AC12、AC13）

- [ ] **E7：无 MCP 配置的既有主路径**  
  删除临时 MCP 配置后启动 BetterCode，普通聊天、六个内置工具、权限确认、`/plan`、`/do`、取消和退出行为与本章前一致。（验证：运行全量回归并完成一次无 MCP 的 TUI 冒烟；覆盖 AC15）

## 最终门槛

- [ ] **G1：规格覆盖完整**  
  AC1-AC16 均至少有一个已通过条目和实际证据，不以代码审阅或“应该可用”代替运行结果。（验证：逐项核对本清单覆盖索引与验收记录）

- [ ] **G2：关键自动化检查全部通过**  
  `pnpm check`、MCP 集成测试和 `git diff --check` 均以退出码 0 完成。（验证：记录实际命令、退出码、测试数量和耗时）

- [ ] **G3：端到端场景均有实际结果**  
  E1-E7 全部记录输入、传输、权限模式、观察结果和资源关闭状态；若真实 Provider 不可用，明确标记阻塞，不用 Fake Provider 冒充真实 TUI 结果。（验证：审阅端到端验收记录）

- [ ] **G4：安全边界与敏感信息检查通过**  
  MCP 外部权限边界被如实展示，所有测试秘密和媒体正文扫描无泄露，缺失只读提示始终按副作用处理。（验证：汇总 C10、C29-C30、C32、C52、C54、C63 的实际证据）

## Spec 覆盖索引

| Spec 验收标准 | Checklist 覆盖位置 |
|---|---|
| AC1 两层配置合并 | C1-C7 |
| AC2 环境变量安全展开 | C8-C10 |
| AC3 stdio 完整流程 | C17-C19、C45、C57、E1 |
| AC4 Streamable HTTP 完整流程 | C20-C21、C57、E2 |
| AC5 异步请求正确配对 | C23-C24、E3 |
| AC6 工具无感注册 | C11-C13、C27-C28、C38、E1-E3 |
| AC7 无效工具隔离 | C16、C39、E4 |
| AC8 结果与错误转换 | C24-C26、C31-C36、E1-E2、E5 |
| AC9 连接复用与关闭 | C37、C42-C43、C45-C46、E1 |
| AC10 Server 故障隔离 | C1、C25、C37、C40-C41、C53、E4 |
| AC11 断开后不自动重连 | C34、C44、E5 |
| AC12 权限与 Plan Mode | C14-C15、C29-C30、C47-C51、C58-C59、E6 |
| AC13 外部安全边界不被误报 | C29-C30、C50、C52、E6 |
| AC14 敏感信息不泄露 | C7、C9-C10、C18-C21、C27、C32、C36、C46、C53-C54、C63、E2、E4 |
| AC15 现有功能回归 | C58-C61、E7 |
| AC16 自动化验证 | C56-C57、C61-C62、G2 |
