# BetterCode MCP 客户端 Plan

## 架构概览

本章采用官方 MCP TypeScript SDK `@modelcontextprotocol/sdk` 作为协议与传输实现。SDK 负责 JSON-RPC 2.0 请求编号、异步响应配对、初始化握手、协议 Schema 校验、stdio framing 和 Streamable HTTP 会话；BetterCode 负责两层配置、敏感值展开与脱敏、连接编排、工具命名与适配、权限接入、故障隔离和生命周期关闭。

整体划分为六个组件：

1. **MCP 配置加载器**：读取用户级和项目级 YAML，逐层解析、逐 Server 校验、展开环境变量并完成覆盖合并。
2. **SDK 会话封装**：根据配置创建 stdio 或 Streamable HTTP transport，驱动官方 `Client` 完成初始化、分页列出工具、调用工具和关闭连接。
3. **工具命名与参数规范化**：生成跨 Provider 可接受的稳定本地名称，并把完整参数对象序列化为稳定权限目标。
4. **MCP 工具适配器**：把远端工具描述包装成现有 `Tool`，转换副作用分类、权限元数据、调用参数和结果。
5. **MCP 管理器**：并行初始化多个 Server，缓存成功会话，按稳定顺序注册工具，汇总诊断并统一关闭。
6. **启动集成**：先注册内置与 MCP 工具，再创建权限系统和 ChatManager；TUI 退出后关闭 MCP 管理器。

```text
用户级 mcp.yaml ─┐
                 ├─> McpConfigLoader ─> McpManager ─┬─> McpSdkSession(stdio)
项目级 mcp.yaml ─┘                                  └─> McpSdkSession(http)
                                                          │
                                                          v
ToolRegistry <─ McpToolAdapter <─ 远端工具描述 <─ tools/list
     │
     ├─> PermissionManager
     ├─> Agent / Plan Mode
     └─> Provider 工具定义
```

## 依赖选择

### 运行时依赖

- `@modelcontextprotocol/sdk@^1.29.0`
  - 当前 npm 稳定版本为 `1.29.0`。
  - 提供 `Client`、`StdioClientTransport`、`StreamableHTTPClientTransport` 和测试 Server 能力。
- `zod@^4.4.3`
  - MCP SDK 的必需 peer dependency。
  - 生产代码不额外使用 Zod 校验 BetterCode 配置；测试 MCP Server 使用它声明工具 Schema。

现有 `yaml` 继续负责配置解析，现有 `ajv` 继续负责注册后工具参数校验。MCP SDK 的协议 Schema 校验与 BetterCode 的工具输入校验保持两层独立职责。

### SDK 使用边界

生产代码只使用以下稳定客户端入口：

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
```

不使用 SDK 的实验性 Tasks、Sampling、Elicitation、Resources、Prompts、OAuth 或旧 SSE fallback。`Client.connect()` 负责初始化握手；`listTools()` 和 `callTool()` 负责工具协议。

## 核心数据结构

### MCP 配置

```typescript
type McpConfigLayer = 'user' | 'project';

interface McpServerConfigBase {
  name: string;
  layer: McpConfigLayer;
  file: string;
  secretValues: readonly string[];
}

interface StdioMcpServerConfig extends McpServerConfigBase {
  transport: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface HttpMcpServerConfig extends McpServerConfigBase {
  transport: 'http';
  url: string;
  headers: Record<string, string>;
}

type McpServerConfig = StdioMcpServerConfig | HttpMcpServerConfig;
```

`secretValues` 保存环境变量替换过程中实际插入的非空值，仅供错误脱敏，不进入状态展示、工具描述或模型上下文。

### 配置加载结果

```typescript
interface LoadedMcpConfig {
  servers: McpServerConfig[];
  diagnostics: McpDiagnostic[];
  secretValues: readonly string[];
}

type McpDiagnosticCode =
  | 'CONFIG_ERROR'
  | 'ENV_MISSING'
  | 'TRANSPORT_ERROR'
  | 'INITIALIZE_ERROR'
  | 'DISCOVERY_ERROR'
  | 'TOOL_SCHEMA_ERROR'
  | 'TOOL_NAME_CONFLICT'
  | 'CLOSE_ERROR';

interface McpDiagnostic {
  code: McpDiagnosticCode;
  message: string;
  layer?: McpConfigLayer;
  file?: string;
  serverName?: string;
  toolName?: string;
}
```

诊断只保留定位信息和脱敏原因。配置读取不抛出全局启动异常，错误通过 `diagnostics` 返回。

### 远端工具与结果

```typescript
interface McpRemoteTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
}

interface McpAttachmentSummary {
  type: 'image' | 'audio' | 'resource' | 'resource_link';
  mimeType?: string;
  uri?: string;
  name?: string;
  size?: number;
}

interface McpRemoteCallResult {
  isError: boolean;
  textParts: string[];
  structuredContent?: JsonObject;
  attachments: McpAttachmentSummary[];
}
```

SDK 返回类型在会话封装内转换为上述中立结构。图片、音频和 blob 不携带 base64 数据离开会话封装，只留下类型、MIME、URI、名称和估算大小等有限摘要。

### 会话接口

```typescript
interface McpSession {
  readonly serverName: string;
  readonly state: 'new' | 'connected' | 'unavailable' | 'closed';

  connect(signal?: AbortSignal): Promise<void>;
  listTools(signal?: AbortSignal): Promise<McpRemoteTool[]>;
  callTool(
    remoteToolName: string,
    input: JsonObject,
    signal: AbortSignal,
  ): Promise<McpRemoteCallResult>;
  close(): Promise<void>;
}

type McpSessionFactory = (
  config: McpServerConfig,
  options: McpSessionOptions,
) => McpSession;
```

`McpSessionFactory` 允许管理器单元测试注入受控假会话；生产工厂返回基于官方 SDK 的实现。

### MCP 管理状态

```typescript
interface McpStartupStatus {
  configuredServers: number;
  connectedServers: number;
  registeredTools: number;
  diagnostics: readonly McpDiagnostic[];
}
```

状态供启动入口和 TUI 展示，不包含请求头、环境变量、完整远端响应或子进程标准错误正文。

### 权限元数据扩展

现有 `ToolPermissionProfile` 增加完整参数目标：

```typescript
type PermissionTargetKind =
  | 'path'
  | 'command'
  | 'glob'
  | 'value'
  | 'arguments';

type ToolPermissionProfile =
  | {
      targetKind: 'path' | 'command' | 'glob' | 'value';
      targetArgument: string;
      defaultTarget?: string;
      pathIntent?: PermissionPathIntent;
      risk: 'read' | 'write' | 'execute';
    }
  | {
      targetKind: 'arguments';
      risk: 'read' | 'write' | 'execute';
    };
```

MCP 工具使用 `arguments`，权限目标由完整调用参数的稳定 JSON 表示生成。现有六工具继续使用原有参数目标，不改变规则语义。

## 模块设计

### `src/mcp/config-loader.ts`

**职责：**

- 计算 `~/.bettercode/mcp.yaml` 和 `<root>/.bettercode/mcp.yaml`。
- 使用 `parseDocument` 读取 YAML，并只报告行列位置，不回显配置正文。
- 校验顶层只能包含 `servers`，每个 Server 只能包含对应 transport 的字段。
- 逐 Server 展开 stdio env 与 HTTP headers 中的 `${VAR}`。
- 合并两层 map，项目级同名项完整覆盖用户级项。
- 保留“项目级无效覆盖”：项目层存在同名 key 时，即使该定义无效，也不恢复用户层定义。
- 对项目配置路径使用 `PathGuard`，拒绝 `.bettercode/mcp.yaml` 符号链接逃逸。
- 返回按 Server 名称码点顺序排序的配置与诊断。

**接口：**

```typescript
interface McpConfigLoaderOptions {
  userHome?: string;
  env?: NodeJS.ProcessEnv;
}

class McpConfigLoader {
  constructor(rootDir: string, options?: McpConfigLoaderOptions);
  load(): LoadedMcpConfig;
}
```

配置文件整体 YAML 损坏时，该层视为空层；单个条目结构错误时只禁用该条目。同层 YAML map 的重复 key 由 YAML 解析错误处理，不采用“最后一个静默生效”。

### `src/mcp/redaction.ts`

**职责：**

- 记录模板展开时实际插入的环境变量值和完整展开值。
- 在 SDK、HTTP、stdio 和关闭错误进入诊断前替换已知敏感片段。
- 清除换行控制字符并限制诊断长度。

**接口：**

```typescript
function expandMcpTemplate(
  value: string,
  env: NodeJS.ProcessEnv,
): { value: string; secretValues: string[]; missing: string[] };

function redactMcpMessage(
  message: string,
  secretValues: readonly string[],
): string;
```

替换按敏感值长度从长到短执行，避免较短值先替换导致较长秘密残留。空字符串不进入敏感值集合。

### `src/mcp/naming.ts`

**职责：**

- 把 Server 名称和远端工具名规范化为小写字母、数字和下划线。
- 生成 `mcp_<server>_<tool>_<hash8>` 形式的本地名称。
- 使用原始 Server 名和工具名计算稳定 SHA-256 短哈希。
- 将最终名称限制在 64 个字符内并满足 `^[a-z][a-z0-9_]*$`。
- 识别由 BetterCode 生成的 MCP 工具名，供权限配置保留离线规则。

**接口：**

```typescript
const MAX_LOCAL_TOOL_NAME_LENGTH = 64;

function createMcpToolName(serverName: string, remoteToolName: string): string;
function isMcpToolName(name: string): boolean;
```

始终附加哈希，而不是只在碰撞时附加，确保名称不依赖 Server 响应顺序或同批工具集合。

### `src/tool/stable-json.ts`

**职责：**

- 对 JSON 对象递归按 key 码点排序。
- 保持数组顺序和 JSON 原始值语义。
- 生成无空白、确定性的字符串，作为 MCP 权限目标。
- 遇到循环引用、`undefined`、函数、symbol 或非有限数字时返回参数错误。

**接口：**

```typescript
function stableStringifyJson(value: unknown): string;
```

模型工具调用来自 JSON，正常路径不会产生非 JSON 值；失败检查用于测试注入和内部调用防御。

### `src/mcp/sdk-session.ts`

**职责：**

- 根据配置创建官方 SDK `Client` 和 transport。
- stdio 使用项目根目录作为 `cwd`，环境为 `getDefaultEnvironment()` 与配置 env 合并，配置值优先。
- stdio 使用 `stderr: 'pipe'`，只保留有界尾部缓冲，并在错误诊断前脱敏。
- HTTP 使用 `requestInit.headers` 注入静态 headers。
- HTTP 显式设置 `maxRetries: 0`，关闭 SDK transport 默认有限重连。
- `Client` 使用空 capabilities，不注册 Sampling、Elicitation 或 list-changed handler。
- `connect()` 使用有界初始化超时；SDK 自动完成 initialize 与 initialized。
- `listTools()` 循环读取 `nextCursor`，检测重复 cursor 并设置最大页数保护。
- `callTool()` 传入 AbortSignal 和请求超时，转换 SDK 结果。
- `Client.onclose` 把会话标记为 `unavailable`；关闭后标记 `closed`。
- 所有对外错误先分类并脱敏，调用方不接触原始 SDK 错误对象。

**接口：**

```typescript
interface McpSessionOptions {
  rootDir: string;
  connectTimeoutMs: number;
  discoveryTimeoutMs: number;
  callTimeoutMs: number;
  maxStderrBytes: number;
}

class McpSdkSession implements McpSession {
  constructor(config: McpServerConfig, options: McpSessionOptions);
  connect(signal?: AbortSignal): Promise<void>;
  listTools(signal?: AbortSignal): Promise<McpRemoteTool[]>;
  callTool(name: string, input: JsonObject, signal: AbortSignal): Promise<McpRemoteCallResult>;
  close(): Promise<void>;
}
```

默认连接与发现超时均为 10 秒。调用层传入与 ToolRegistry 一致的 30 秒上限，Registry 仍是最终超时裁决者。

### `src/mcp/tool-adapter.ts`

**职责：**

- 实现现有 `Tool` 接口。
- 保留远端输入 Schema，不自行增加、删除或推断参数。
- 描述前缀标明工具来自哪个 MCP Server，再拼接远端描述。
- `readOnly === true` 时设置 `effect: 'read_only'` 和 `risk: 'read'`；否则设置 `effect: 'side_effect'` 和 `risk: 'execute'`。
- 权限目标使用 `targetKind: 'arguments'`。
- 调用绑定的缓存会话与原始远端工具名。
- 把远端文本、结构化内容和附件摘要格式化为 `ToolResult.output`。
- 将远端 `isError` 转为 `MCP_TOOL_ERROR`，断开转为 `MCP_SERVER_UNAVAILABLE`，协议异常转为 `MCP_PROTOCOL_ERROR`。

**接口：**

```typescript
class McpToolAdapter implements Tool {
  constructor(
    localName: string,
    serverName: string,
    remote: McpRemoteTool,
    session: McpSession,
  );

  execute(input: JsonObject, context: ToolContext): Promise<ToolResult>;
}
```

`ToolErrorCode` 增加：

```typescript
type McpToolErrorCode =
  | 'MCP_SERVER_UNAVAILABLE'
  | 'MCP_PROTOCOL_ERROR'
  | 'MCP_TOOL_ERROR';
```

取消和 Registry 超时继续使用现有 `CANCELLED` 与 `TIMEOUT`，避免重复错误语义。

### `src/mcp/manager.ts`

**职责：**

- 接收已加载配置、Registry 和会话工厂。
- 对所有有效 Server 并行执行 `connect()` 与 `listTools()`。
- 使用 `Promise.allSettled` 隔离单个 Server 错误。
- Server 发现失败时关闭该会话，不加入缓存。
- 等全部发现任务结束后，按 Server 名称、远端工具名称的码点顺序串行注册，消除网络完成顺序影响。
- 每个有效工具创建稳定名称和 `McpToolAdapter`。
- 捕获 Registry 重名和 Ajv Schema 编译错误，跳过当前工具并继续。
- 缓存成功连接，后续工具调用不重新握手。
- 提供结构化启动状态和幂等关闭。
- 关闭时使用 `Promise.allSettled`，一个会话失败不阻塞其他会话。

**接口：**

```typescript
interface McpManagerOptions {
  sessionFactory?: McpSessionFactory;
  connectTimeoutMs?: number;
  discoveryTimeoutMs?: number;
  callTimeoutMs?: number;
  maxStderrBytes?: number;
}

class McpManager {
  constructor(
    rootDir: string,
    loaded: LoadedMcpConfig,
    options?: McpManagerOptions,
  );

  initialize(registry: ToolRegistry, signal?: AbortSignal): Promise<McpStartupStatus>;
  getStatus(): McpStartupStatus;
  close(): Promise<readonly McpDiagnostic[]>;
}
```

`initialize()` 只能成功调用一次；重复调用返回现有状态，不重复连接或注册。`close()` 可重复调用，第二次不重复关闭 transport。

### `src/mcp/factory.ts`

**职责：**

- 组合 `McpConfigLoader`、生产 `McpSessionFactory` 和 `McpManager`。
- 为测试注入 userHome、env、超时和假会话工厂。

**接口：**

```typescript
interface McpFactoryOptions extends McpConfigLoaderOptions, McpManagerOptions {}

function createMcpManager(
  rootDir: string,
  options?: McpFactoryOptions,
): McpManager;
```

### `src/tool/registry.ts`

**改动：**

- `register()` 先编译 Ajv validator，再写入 `tools` 和 `validators` 两个 Map。
- Schema 编译失败时 Registry 保持完全不变，MCP 管理器可以安全跳过该工具。
- 保持重复名称抛错和现有定义顺序行为。

### `src/permission/sandbox.ts` 与 `src/permission/rule-parser.ts`

**改动：**

- `SandboxPolicy` 遇到 `targetKind: 'arguments'` 时调用 `stableStringifyJson(input)`，不走路径解析。
- `arguments` 的 glob 处理与 `value` 相同，`*` 可以匹配 JSON 字符串中的 `/`。
- `createExactPermissionExpression()` 继续转义 JSON 中的 glob 特殊字符。
- 对当前 Registry 未注册、但名称满足 BetterCode MCP 命名格式的规则，按 `arguments` 目标解析为休眠规则。
- 普通未知工具仍保持配置错误，避免放宽原有规则校验。

休眠规则只存在于权限规则引擎；未注册工具无法被 Agent 调用。Server 恢复并注册出相同稳定名称后，规则自动重新匹配。

### `src/index.tsx`

**改动：**

启动顺序调整为：

1. 解析 CLI 与权限模式。
2. 加载 Provider 配置并创建 Provider。
3. 创建内置 ToolRegistry。
4. 创建并初始化 McpManager，将成功发现的工具注册到同一 Registry。
5. 基于完整 Registry 创建 PermissionManager。
6. 创建 ChatManager 并启动 TUI。
7. `waitUntilExit()` 结束后在 `finally` 中关闭 McpManager。

MCP 初始化失败不会进入外层“启动失败”分支，只有 Provider 配置、核心 Registry 或 TUI 自身的致命错误继续导致进程退出码 1。关闭诊断在 TUI 退出后以脱敏文本写到标准错误。

### `src/ui/app.tsx`

**改动：**

- `App` 增加可选 `mcpStatus` 属性。
- 初始消息合并权限配置诊断和 MCP 启动诊断。
- 只在存在 MCP 诊断时展示摘要与逐项原因；全部成功或未配置时不增加聊天噪声。
- 不增加 `/mcp` 命令，不提供运行时重连或刷新入口。

## 模块交互

### 启动与发现

```text
index
  -> createCoreToolRegistry(rootDir)
  -> createMcpManager(rootDir)
       -> McpConfigLoader.load()
  -> McpManager.initialize(registry)
       -> Promise.allSettled(server configs)
            -> McpSdkSession.connect()
                 -> Client.connect(transport)
                 -> initialize / initialized（SDK）
            -> McpSdkSession.listTools()
                 -> 按 nextCursor 循环 tools/list
       -> 排序全部成功发现结果
       -> createMcpToolName(server, remoteTool)
       -> registry.register(MCP 工具适配器)
  -> createPermissionManager(完整 registry)
  -> new ChatManager(registry, permissionManager)
  -> render(App)
```

Server A 失败时只生成 A 的诊断；Server B 的发现和注册不等待 A 重试，也不被 A 的异常取消。

### Agent 调用 MCP 工具

```text
AgentLoop
  -> ToolScheduler
       -> registry.validate(call)
       -> PermissionManager.authorize(call, adapter)
            -> targetKind=arguments
            -> stableStringifyJson(call.arguments)
       -> registry.execute(call, signal)
            -> McpToolAdapter.execute()
                 -> cached McpSession.callTool(remoteName, args, signal)
                      -> Client.callTool(远端工具与参数, 请求选项)
                 -> normalize result / error
            -> Registry output limit
  -> tool_result 回灌 AgentLoop
```

MCP 工具在调度层与内置工具完全一致：明确只读工具可并发，其他工具串行；权限拒绝和调用失败均作为普通结构化结果回灌模型。

### 关闭

```text
TUI exit
  -> waitUntilExit() resolve
  -> finally
       -> McpManager.close()
            -> allSettled(session.close())
                 -> Client.close()
                 -> transport.close()
                 -> stdio 子进程结束 / HTTP session 终止
       -> 输出脱敏关闭诊断（如有）
```

## 文件组织

```text
Bettercode Agent/
├── package.json
├── pnpm-lock.yaml
├── src/
│   ├── index.tsx                         # 启动发现、完整 Registry、退出关闭
│   ├── mcp/
│   │   ├── types.ts                      # 配置、诊断、会话、远端工具类型
│   │   ├── config-loader.ts              # 两层 YAML、覆盖合并、ENV 展开
│   │   ├── config-loader.test.ts         # 配置、路径、覆盖和脱敏测试
│   │   ├── redaction.ts                  # 模板展开与敏感值脱敏
│   │   ├── redaction.test.ts             # 多占位符和泄露测试
│   │   ├── naming.ts                     # 稳定工具名与格式识别
│   │   ├── naming.test.ts                # 长名称、特殊字符和碰撞测试
│   │   ├── sdk-session.ts                # 官方 SDK 两类 transport 封装
│   │   ├── sdk-session.test.ts           # 会话状态、分页、关闭和错误分类
│   │   ├── tool-adapter.ts               # Tool 接口适配与结果转换
│   │   ├── tool-adapter.test.ts          # effect、权限和结果测试
│   │   ├── manager.ts                    # 多 Server 编排、缓存、注册、关闭
│   │   ├── manager.test.ts               # 故障隔离、顺序和生命周期测试
│   │   ├── factory.ts                    # 生产组合入口
│   │   ├── integration.test.ts           # 真实 stdio 与 HTTP 本地集成
│   │   └── fixtures/
│   │       └── stdio-server.ts           # 测试 MCP stdio Server
│   ├── tool/
│   │   ├── types.ts                      # arguments 权限目标、MCP 错误码
│   │   ├── stable-json.ts                # 确定性 JSON 序列化
│   │   ├── stable-json.test.ts           # 排序与非法值测试
│   │   ├── registry.ts                   # 原子注册
│   │   └── registry.test.ts              # Schema 失败不残留测试
│   ├── permission/
│   │   ├── sandbox.ts                    # 参数对象权限目标
│   │   ├── sandbox.test.ts               # MCP 参数目标测试
│   │   ├── rule-parser.ts                # arguments glob 与休眠规则
│   │   └── rule-parser.test.ts            # 离线 MCP 规则测试
│   └── ui/
│       └── app.tsx                        # 安全展示启动诊断
└── docs/mcp-client/
    ├── spec.md
    ├── plan.md
    ├── task.md
    └── checklist.md
```

测试文件可根据聚焦程度合并，但生产模块边界保持不变。测试 fixture 不读取真实用户配置、不访问公网、不调用真实模型。

## 测试设计

### 配置测试

- 用户与项目不同名合并。
- 项目同名完整覆盖，不发生字段深合并。
- 项目同名无效时不回退用户定义。
- 单层 YAML 损坏、另一层仍有效。
- 单 Server 字段错误不影响同层其他 Server。
- `${VAR}` 多次和多变量展开。
- 缺失变量只禁用当前 Server。
- env、headers、URL、command、args 的字段白名单。
- 项目配置符号链接逃逸拒绝。
- 诊断不包含展开后的秘密。

### 会话与协议测试

- `Client.connect()` 完成 initialize/initialized。
- `listTools()` 多页 cursor 汇总、重复 cursor 拒绝。
- `callTool()` 传递参数、取消和超时。
- 并发延迟工具乱序完成时结果正确配对。
- stdio stderr 不污染协议，关闭后子进程退出。
- HTTP headers 和 session id 正确。
- HTTP `maxRetries: 0`，断开后不创建新会话。
- SDK 错误分类并脱敏。

### 适配与权限测试

- 本地名称合法、稳定、长度不超过 64。
- 两个 Server 同名工具得到不同名称。
- `readOnlyHint === true` 映射只读；缺失和 false 映射副作用。
- 参数对象 key 顺序不同得到相同权限目标。
- Plan Mode 只包含明确只读 MCP 工具。
- 会话和永久精确规则可重新匹配。
- Server 离线时持久 MCP 规则休眠，不使其他权限规则失效。
- 文本、structuredContent、resource text 和媒体摘要转换。
- `isError`、协议错误、断开、取消、超时映射到正确错误码。

### 管理器与启动测试

- 多 Server 并行初始化且注册顺序稳定。
- 单 Server 配置、连接、握手、发现或 Schema 失败不影响其他。
- 全部 MCP Server 失败时内置工具 Registry 不变且可继续创建 Agent。
- 同一 Server 多次调用只建立一个会话。
- 重复 initialize 不重复注册。
- close 幂等且一个关闭失败不阻塞其他。
- TUI 初始诊断脱敏，未配置或全成功时无额外消息。

### 真实本地集成测试

- stdio fixture 使用官方 `McpServer` 与 `StdioServerTransport` 暴露只读 echo、延迟 echo 和错误工具。
- HTTP 测试在随机本地端口使用官方 `McpServer` 与 `StreamableHTTPServerTransport`，验证自定义 header、会话标识、工具调用和终止。
- 集成测试并发调用不同延迟的 echo，验证 JSON-RPC 响应配对。
- 所有测试使用 `127.0.0.1` 与临时目录，不访问公网。

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| MCP 协议实现 | 官方 TypeScript SDK 1.29 | 用户选择方案 1；减少协议 framing、请求配对和 Streamable HTTP 兼容风险 |
| SDK peer dependency | 直接添加 Zod 4 | SDK 明确要求，避免依赖树偶然满足 peer dependency |
| 配置文件 | 独立 `mcp.yaml` 两层 | 不污染 Provider 配置，符合用户级与项目级覆盖需求 |
| 合并粒度 | 同名 Server 整体覆盖 | 避免 command、headers、env 跨层拼接产生意外连接或凭据组合 |
| 无效项目覆盖 | 禁用且不回退 | “后面的盖前面的”保持真实，避免静默连接用户层其他服务 |
| 多 Server 初始化 | 并行发现、排序注册 | 缩短启动等待，同时保持工具定义和缓存输入确定性 |
| 本地工具名 | slug + 固定短哈希，最长 64 | 跨 Provider 合法、稳定、防同名，且不依赖发现顺序 |
| 工具 Schema | MCP SDK 校验协议，Ajv 校验调用 | 复用现有 Registry，并在注册阶段发现本地不兼容 Schema |
| Registry 注册 | validator 编译成功后原子写入 | 防止无效 MCP Schema 留下半注册工具 |
| 工具安全分类 | 仅 `readOnlyHint === true` 视为只读 | 缺失提示时采用副作用默认，Plan Mode 失败关闭 |
| MCP 权限目标 | 稳定序列化完整参数对象 | 任意远端 Schema 都能产生确定的精确与 glob 匹配目标 |
| 离线永久规则 | 识别 MCP 命名格式并作为休眠规则加载 | Server 临时故障不应破坏整层权限配置，恢复后规则继续生效 |
| HTTP 重连 | SDK `maxRetries: 0` | 严格满足本章不自动重连的范围 |
| stdio 环境 | SDK 安全默认环境 + 配置覆盖 | 保留 PATH 等启动条件，不默认继承 BetterCode 全部环境变量 |
| 非文本结果 | 文本与结构保留，媒体只输出摘要 | 当前 Provider 工具结果是文本，避免 base64 无界进入上下文 |
| 启动失败策略 | MCP 降级，核心启动继续 | 单 Server 与全部 Server 故障都不影响内置工具和聊天 |
| 生命周期 | Manager 缓存单会话，finally 统一关闭 | 防重复握手和遗留子进程，关闭错误相互隔离 |
| 动态工具刷新 | 不注册 list-changed handler | 与本章“不做运行时刷新”边界一致 |

## Spec 覆盖

| Spec | 设计归属 |
|------|----------|
| F1 两层配置 | `McpConfigLoader`、完整覆盖算法、PathGuard |
| F2 环境变量 | `expandMcpTemplate`、`redactMcpMessage`、诊断模型 |
| F3 stdio | `StdioClientTransport`、安全环境、stderr 缓冲、关闭 |
| F4 Streamable HTTP | `StreamableHTTPClientTransport`、headers、禁用重连 |
| F5 会话协议 | SDK `Client.connect/listTools/callTool`、分页保护 |
| F6 工具适配注册 | 稳定命名、`McpToolAdapter`、Registry 原子注册 |
| F7 调用结果 | 中立结果结构、错误码、媒体摘要、Registry 限流 |
| F8 缓存生命周期 | `McpManager`、单会话缓存、幂等关闭 |
| F9 故障隔离 | `Promise.allSettled`、结构化诊断、不可用状态 |
| F10 权限与 Plan Mode | `arguments` 目标、readOnlyHint、休眠规则 |

## 风险与约束

- MCP SDK 与 Zod 会增加依赖体积；仓库当前跟踪 `node_modules`，安装依赖会产生较多受版本控制的依赖文件变更，提交时需要与锁文件保持一致。
- MCP `readOnlyHint` 是远端 Server 自声明，不是可信沙箱信号。Plan Mode 依赖该提示只能表达协议意图，不能防御恶意 Server。
- stdio Server 继承 BetterCode 进程用户权限，`cwd` 指向项目根目录不等于文件系统隔离。
- HTTP 静态 headers 适合 API Token，但不支持 OAuth 过期刷新；返回 401 后 Server 保持不可用，直到用户重启 BetterCode。
- 参数对象作为权限规则目标可能较长，仍受权限配置和界面显示能力约束；实现中保持完整匹配值，但界面可做仅显示层截断，不改变规则语义。
- 工具列表只在启动时读取。Server 运行期间改变工具列表不会反映到当前 BetterCode 会话。
