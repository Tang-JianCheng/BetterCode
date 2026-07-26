# BetterCode 五层权限系统 Plan

## 架构概览

本阶段在现有 Tool、Agent、Chat 和 UI 之间新增独立 Permission 层。Permission 层只负责判断工具调用是否允许，不执行工具、不维护对话历史，也不依赖 Ink。

```text
Ink UI
  |  permissionDecider(request) -> Promise<choice>
  v
ChatManager
  |  AgentRunOptions.permissionDecider
  v
AgentLoop
  |  AgentEvent: permission_request / permission_decision
  v
ToolScheduler
  |  先校验与判权，再按 effect 调度
  v
PermissionManager
  |- CommandBlacklist       不可配置危险命令
  |- SandboxPolicy          项目真实路径边界
  |- RuleEngine             四层规则与冲突优先级
  |- PermissionMode         未命中规则时的默认行为
  `- PermissionConfigStore  三层 YAML 加载与本地规则持久化
  |
  v
ToolRegistry.execute() -> Tool.execute()
```

- **PermissionManager**：五层防御的统一入口。顺序执行黑名单、沙箱、规则、模式和人工确认，返回可执行或结构化拒绝结果。
- **CommandBlacklist**：维护不可配置的危险命令正则与安全类别，只检查命令类工具。
- **SandboxPolicy**：复用 `PathGuard` 对路径类目标执行真实路径预检；对 glob 目标执行项目相对模式检查。工具执行时仍保留现有 `PathGuard` 作为最终边界。
- **RuleEngine**：解析“工具名(模式)”表达式，按会话、项目本地、项目共享、用户全局的层级和同层具体程度确定结果。
- **PermissionConfigStore**：读取三个 YAML 文件，保存项目本地永久授权，并返回可展示的配置诊断。
- **ToolScheduler**：在工具实际执行前逐个完成参数校验和权限判断；权限全部收敛后，只读工具并发、副作用工具串行。
- **AgentLoop / ChatManager**：传递权限决策器并把权限事件纳入现有异步事件流。权限拒绝仍作为 `tool_result` 回灌，不新增停止原因。
- **Ink UI**：实现权限确认面板和权限模式命令。UI 通过 Promise 返回选择，不进入 Permission 层。

### Spec 覆盖

| Spec | 架构归属 |
|---|---|
| F1 | ToolScheduler + PermissionManager + ToolRegistry 参数校验 |
| F2 | CommandBlacklist + RunCommand 执行前判权 |
| F3 | SandboxPolicy + PathGuard + 各文件工具最终校验 |
| F4 | RuleParser + ToolPermissionProfile + RuleEngine |
| F5 | PermissionConfigStore + RuleEngine 层级合并 |
| F6 | PermissionMode + PermissionManager |
| F7 | PermissionDecider + PermissionPrompt + 本地规则持久化 |
| F8 | ToolScheduler 两阶段调度 |
| F9 | PermissionAuthorization + ToolErrorCode |
| F10 | AgentLoop 既有工具结果回灌路径 |
| F11 | AgentEvent + PermissionDecider + Ink UI |
| F12 | AbortSignal 竞速 + 调用绑定请求标识 |
| N1-N2 | 固定判定管线 + 失败关闭 + 稳定排序 |
| N3-N5 | Agent、Provider、Plan Mode 回归测试 |
| N6-N9 | Permission 单元测试 + 文档化边界 |

## 配置约定

### 文件位置

三层持久化配置使用相同结构：

| 层级 | 路径 | 用途 |
|---|---|---|
| 用户全局 | `~/.bettercode/permissions.yaml` | 当前用户所有项目的默认规则 |
| 项目共享 | `<project>/.bettercode/permissions.yaml` | 可提交到版本控制的团队规则 |
| 项目本地 | `<project>/.bettercode/permissions.local.yaml` | 当前工作副本的个人规则与永久授权 |

`<project>/.bettercode/permissions.local.yaml` 加入项目 `.gitignore`。不存在的文件等价于空规则集；用户全局文件读取属于 BetterCode 控制面，不受模型文件工具的项目沙箱限制。

### YAML 格式

```yaml
version: 1
rules:
  - effect: allow
    expression: read_file(src/**)
  - effect: allow
    expression: run_command(git *)
  - effect: deny
    expression: write_file(.env*)
```

- `version` 当前只接受整数 `1`。
- `rules` 为有序数组，可省略或为空。
- 每条规则只包含 `effect` 和 `expression`；`effect` 只能是 `allow` 或 `deny`。
- 未知字段、未知工具、空表达式和不成对括号均产生配置诊断，该文件不参与匹配。
- 单个文件无效时跳过该层，不影响其他有效层；诊断在启动界面和 `/permissions` 状态中展示。
- 项目本地文件写入前必须完整校验。已有文件无效时永久授权失败，不覆盖原内容。

### 权限模式

```typescript
type PermissionMode = 'strict' | 'default' | 'allow';
```

- 启动默认值为 `default`。
- CLI 参数 `--permission-mode <strict|default|allow>` 设置启动模式。
- TUI 命令 `/permissions <strict|default|allow>` 在空闲时切换当前会话模式。
- `/permissions` 不带参数时展示当前模式、有效规则数量和配置诊断。
- 模式不写入权限 YAML；重启后回到 CLI 指定值或 `default`。
- `/clear` 清空对话、计划和会话临时规则，但保留当前权限模式与持久化规则。

## 核心数据结构

### 工具权限画像

`Tool` 增加只供本地权限系统读取的权限画像，不加入发送给模型的 `ToolDefinition`：

```typescript
type PermissionTargetKind = 'path' | 'command' | 'glob' | 'value';
type PermissionPathIntent = 'existing' | 'write' | 'glob';

interface ToolPermissionProfile {
  targetArgument: string;
  targetKind: PermissionTargetKind;
  defaultTarget?: string;
  pathIntent?: PermissionPathIntent;
  risk: 'read' | 'write' | 'execute';
}

interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly effect: ToolEffect;
  readonly permission: ToolPermissionProfile;
  execute(input: JsonObject, context: ToolContext): Promise<ToolResult>;
}
```

六个核心工具的画像固定如下：

| 工具 | targetArgument | targetKind | defaultTarget | pathIntent | risk |
|---|---|---|---|---|---|
| `read_file` | `path` | `path` | - | `existing` | `read` |
| `write_file` | `path` | `path` | - | `write` | `write` |
| `edit_file` | `path` | `path` | - | `existing` | `write` |
| `run_command` | `command` | `command` | - | - | `execute` |
| `find_files` | `pattern` | `glob` | - | `glob` | `read` |
| `search_code` | `glob` | `glob` | `**/*` | `glob` | `read` |

`search_code` 未传 `glob` 时，权限目标使用工具默认值 `**/*`。规则只匹配权限画像声明的主目标，不匹配文件内容、替换原文或写入内容，避免敏感正文进入规则和确认事件。

### 规则类型

```typescript
type PermissionEffect = 'allow' | 'deny';
type PermissionRuleLayer = 'user' | 'project' | 'local' | 'session';
type PermissionPatternKind = 'tool' | 'glob' | 'exact';

interface PermissionRule {
  effect: PermissionEffect;
  expression: string;
  toolName: string;
  pattern?: string;
  patternKind: PermissionPatternKind;
  layer: PermissionRuleLayer;
  order: number;
  literalLength: number;
}

interface RuleMatch {
  effect: PermissionEffect;
  rule: PermissionRule;
}
```

表达式解析规则：

1. `read_file` 是工具级规则，匹配该工具全部调用。
2. `read_file(src/index.ts)` 的括号内容不含未转义 glob 元字符，按精确值匹配。
3. `read_file(src/**)` 包含 glob 元字符，按 glob 匹配。
4. 工具名大小写敏感，必须与注册名称一致。
5. 括号内容允许普通空格和括号，以第一个 `(` 与最后一个 `)` 作为外层边界。

同层排序使用稳定的具体程度元组：`exact > glob > tool`；多个 glob 同时命中时，非通配字面字符更多者优先；元组相同则 `order` 更大的后声明规则优先。

跨层匹配按 `session -> local -> project -> user` 依次进行。某层存在匹配结果后立即停止，不再查询下一层。

### 权限请求与选择

```typescript
type PermissionChoice =
  | 'deny'
  | 'allow_once'
  | 'allow_session'
  | 'allow_permanent';

interface PermissionRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  target: string;
  proposedRule: string;
  risk: 'read' | 'write' | 'execute';
  projectRoot: string;
}

type PermissionDecider = (
  request: PermissionRequest,
  signal: AbortSignal,
) => Promise<PermissionChoice>;
```

`target` 只包含权限主目标；写入内容、替换正文和其他敏感参数不进入事件。`proposedRule` 是由当前调用生成的精确表达式：路径先规范化为项目相对形式，命令保留完整文本，glob 使用当前实际值。表达式中的 glob 元字符会转义，确保会话和永久授权只精确匹配当前目标。

每次确认使用新的随机 `id` 并绑定 `toolCallId`。`PermissionManager` 将决策 Promise 与 `AbortSignal` 竞速；取消先完成时返回取消，之后到达的决定被忽略。Promise 只消费第一个有效结果，重复完成不会触发第二次执行。

### 权限判定结果

```typescript
type PermissionDecisionSource =
  | 'blacklist'
  | 'sandbox'
  | 'session_rule'
  | 'local_rule'
  | 'project_rule'
  | 'user_rule'
  | 'mode'
  | 'user';

type PermissionAuthorization =
  | {
      allowed: true;
      source: PermissionDecisionSource;
      requestId?: string;
      choice?: PermissionChoice;
    }
  | {
      allowed: false;
      source: PermissionDecisionSource;
      result: ToolResult;
      requestId?: string;
      choice?: PermissionChoice;
    };
```

`ToolErrorCode` 增加：

```typescript
type PermissionToolErrorCode =
  | 'DANGEROUS_COMMAND'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_CANCELLED'
  | 'PERMISSION_UNAVAILABLE'
  | 'PERMISSION_CONFIG_ERROR';
```

- `DANGEROUS_COMMAND`：命中不可配置黑名单。
- `PATH_OUTSIDE_ROOT`：沿用现有错误码表示沙箱拒绝。
- `PERMISSION_DENIED`：规则、严格模式或用户选择拒绝。
- `PERMISSION_CANCELLED`：等待确认时整个运行取消。
- `PERMISSION_UNAVAILABLE`：默认模式需要确认但未提供决策器，或决策器异常结束。
- `PERMISSION_CONFIG_ERROR`：永久授权无法安全写入项目本地配置。

权限结果 metadata 只记录 `source`、`rule`、`category`、`requestId` 等非敏感值。模型收到的拒绝信息说明可以缩小操作范围、改用专用工具或请求用户调整权限，不暗示绕过黑名单与沙箱。

### Agent 事件

```typescript
type AgentProgressStage =
  | 'requesting_model'
  | 'model_complete'
  | 'checking_permissions'
  | 'waiting_permission'
  | 'executing_tools'
  | 'tools_complete';

type PermissionAgentEvent =
  | {
      type: 'permission_request';
      iteration: number;
      request: PermissionRequest;
    }
  | {
      type: 'permission_decision';
      iteration: number;
      requestId?: string;
      toolCallId: string;
      toolName: string;
      allowed: boolean;
      source: PermissionDecisionSource;
      choice?: PermissionChoice;
    };
```

权限请求和结果均为纯数据事件，不携带 React 状态或回调函数。工具被拒绝后仍会继续发出既有 `tool_result`；`permission_decision` 用于界面状态，`tool_result` 用于模型历史。

### Agent 运行选项

```typescript
interface AgentRunOptions {
  mode?: AgentMode;
  signal?: AbortSignal;
  permissionDecider?: PermissionDecider;
}

interface AgentLoopRequest {
  history: Message[];
  userMessage: string;
  mode: AgentMode;
  provider: LLMProvider;
  signal: AbortSignal;
  permissionDecider?: PermissionDecider;
}
```

交互式 Ink 调用传入决策器；自动化、脚本或未来其他前端只有在能够实际处理确认时才传入。默认模式缺少决策器时失败关闭，不设置定时自动允许。

## 模块设计

### CommandBlacklist

**职责：** 在命令进入规则引擎前识别不可授权的已知高危形式。

```typescript
interface DangerousCommandPattern {
  category: string;
  description: string;
  pattern: RegExp;
}

interface DangerousCommandMatch {
  category: string;
  description: string;
}

function matchDangerousCommand(command: string): DangerousCommandMatch | undefined;
```

内置规则覆盖以下类别：

- 对 `/`、`/*` 或等价系统根目标的递归强制删除。
- `mkfs`、`newfs` 等文件系统格式化入口。
- 使用 `dd` 向常见裸磁盘设备写入。
- `shutdown`、`reboot`、`poweroff`、`halt` 等系统终止命令。
- 典型 Shell fork bomb 语法。

匹配允许前置 `sudo`、命令分隔符和常见参数排列，同时用命令边界避免把安全文本、文件名或 `echo` 内容误判为可执行入口。测试只调用纯匹配函数，绝不运行高危命令。

黑名单是高价值的已知模式防线，不把正则描述成完整 Shell 语义分析器。复杂间接调用仍由规则和人工确认约束。

### SandboxPolicy

**职责：** 在权限规则之前规范化权限目标并执行项目边界检查。

```typescript
interface PermissionSubject {
  target: string;
  profile: ToolPermissionProfile;
}

class SandboxPolicy {
  constructor(pathGuard: PathGuard);

  resolveSubject(
    tool: Tool,
    input: JsonObject,
  ): PermissionSubject;
}
```

- `path`：使用 `PathGuard.resolveForWrite()` 做权限预检。该方法对已存在目标解析真实路径，对不存在目标解析最近存在父目录，因此既能保护读取目标，也不会把普通“文件不存在”误判为越界。实际读取仍由工具返回 `FILE_NOT_FOUND`。
- `glob`：拒绝绝对模式和包含独立 `..` 段的模式，并统一分隔符；工具执行时继续使用 `followSymbolicLinks: false` 和逐结果真实路径过滤。
- `command`：不尝试从 Shell 文本推导文件访问范围，原样交给黑名单与规则层。
- `value`：仅做非空字符串规范化，不参与路径判断。

`PathGuard` 仍是文件工具执行时的最终强制边界，防止权限预检后目标状态变化导致直接越界。权限配置和模式不能捕获或覆盖 `PATH_OUTSIDE_ROOT`。

### RuleParser 与 RuleEngine

**职责：** 校验表达式、编译 glob、维护分层规则并返回第一个有效层的最佳匹配。

```typescript
function parsePermissionRule(
  raw: RawPermissionRule,
  layer: PermissionRuleLayer,
  order: number,
  knownTools: ReadonlySet<string>,
): PermissionRule;

class PermissionRuleEngine {
  replaceLayer(layer: PermissionRuleLayer, rules: readonly PermissionRule[]): void;
  addSessionRule(rule: PermissionRule): void;
  clearSessionRules(): void;
  match(toolName: string, target: string): RuleMatch | undefined;
  countByLayer(): Readonly<Record<PermissionRuleLayer, number>>;
}
```

glob 使用成熟字符串匹配库 `minimatch`，关闭隐式 basename 匹配并启用反斜杠转义。规则在加载时预编译，调用时只执行已校验 matcher。命令和路径使用同一匹配算法，但不进行 Shell 展开或文件系统遍历。

### PermissionConfigStore

**职责：** 加载三层配置、保存项目本地授权、保护已有配置不被部分写坏。

```typescript
interface PermissionDiagnostic {
  layer: Exclude<PermissionRuleLayer, 'session'>;
  file: string;
  message: string;
}

interface LoadedPermissionConfig {
  rules: Record<'user' | 'project' | 'local', PermissionRule[]>;
  diagnostics: PermissionDiagnostic[];
}

class PermissionConfigStore {
  constructor(rootDir: string, knownTools: ReadonlySet<string>);
  load(): LoadedPermissionConfig;
  appendLocalAllow(expression: string): Promise<PermissionRule>;
}
```

加载使用现有 `yaml` 依赖。永久授权写入流程：

1. 重新读取项目本地文件，避免覆盖运行期间的外部修改。
2. 解析并完整校验；无效则返回 `PERMISSION_CONFIG_ERROR`。
3. 已有相同 `allow` 表达式时直接复用，不重复追加。
4. 在同目录写入临时文件，再原子重命名为正式文件。
5. 写入成功后更新 RuleEngine 的 local 层，再允许当前调用。

使用 YAML Document API 尽量保留已有注释和顺序。任何失败都保留原文件，不降级成仅本次允许。

### PermissionManager

**职责：** 编排固定判定顺序，维护模式和会话规则，处理人工选择。

```typescript
interface PermissionAuthorizeOptions {
  signal: AbortSignal;
  decider?: PermissionDecider;
  onRequest: (request: PermissionRequest) => void;
}

class PermissionManager {
  constructor(
    mode: PermissionMode,
    sandbox: SandboxPolicy,
    rules: PermissionRuleEngine,
    store: PermissionConfigStore,
  );

  authorize(
    call: ToolCall,
    tool: Tool,
    options: PermissionAuthorizeOptions,
  ): Promise<PermissionAuthorization>;

  getMode(): PermissionMode;
  setMode(mode: PermissionMode): void;
  clearSessionRules(): void;
  getStatus(): PermissionStatus;
}
```

`authorize()` 固定执行：

1. 从工具画像提取目标并由 SandboxPolicy 规范化。
2. 命令目标进入 CommandBlacklist；命中立即拒绝。
3. RuleEngine 按四层优先级查找；命中后返回 allow 或 deny。
4. 未命中时读取模式：严格拒绝，放行允许，默认继续。
5. 默认模式无 decider 时返回 `PERMISSION_UNAVAILABLE`。
6. 创建权限请求、调用 `onRequest`，并等待 decider 与取消信号竞速。
7. `deny` 返回拒绝；`allow_once` 仅返回当前允许。
8. `allow_session` 先加入精确会话规则，再允许当前调用。
9. `allow_permanent` 先原子写入项目本地规则并刷新引擎，再允许当前调用。

规格中的全局顺序要求黑名单先于沙箱。实现中仅当工具画像是命令时执行黑名单；文件工具没有命令可检查，直接进入沙箱。两类强制层都在任何可配置规则之前，语义与规格一致。

### ToolRegistry

**职责：** 保留工具注册、Schema 校验、超时和实际执行能力，并向调度器公开安全的预检信息。

新增接口：

```typescript
class ToolRegistry {
  validate(call: ToolCall): ToolResult | undefined;
  get(name: string): Tool | undefined;
  execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult>;
}
```

`validate()` 成功返回 `undefined`，失败返回现有 `INVALID_ARGUMENTS` 结果。`execute()` 继续重复执行参数校验作为纵深保护。ToolScheduler 是 Agent 工具调用进入 PermissionManager 和 `execute()` 的唯一应用入口，测试可单独调用 Registry 验证底层执行保护。

### ToolScheduler

**职责：** 维护未知工具、Plan Mode、参数校验、权限判断和副作用调度的确定顺序。

构造函数调整为：

```typescript
class ToolScheduler {
  constructor(
    registry: ToolRegistry,
    permissionManager: PermissionManager,
  );
}
```

单批次分为两个阶段：

**阶段一：按模型原始顺序预检与判权**

1. 检查未知工具阈值和 Plan Mode 可用性。
2. 调用 `registry.validate()`；无效参数直接生成结果，不发起权限确认。
3. 发出 `checking_permissions` 进度。
4. 调用 `permissionManager.authorize()`；请求确认时发出 `permission_request` 和 `waiting_permission`。
5. 判定完成后发出 `permission_decision`。
6. 拒绝结果直接保存；允许调用按 `effect` 放入只读或副作用队列。

权限判断保持串行，因此前一个调用创建的会话或永久规则能影响同批次后续调用，也不会同时展示多个确认面板。

**阶段二：执行已授权调用**

1. 所有已授权只读工具使用 `Promise.all` 并发执行。
2. 所有已授权副作用工具按模型原始顺序串行执行。
3. 取消后尚未启动的调用写入 `CANCELLED` 结果。
4. 最终结果按原始调用顺序重组。

权限拒绝不增加 unknown tool streak，不触发 Agent 停止；未知工具和 Plan Mode 不可用继续沿用当前计数规则。

### AgentLoop 与 ChatManager

AgentLoop 把 `request.permissionDecider` 传给 ToolScheduler，并转发新增权限事件。工具权限失败不走 Agent `error`，也不修改停止原因；循环按现有路径把结构化结果序列化进 tool 消息，下一轮模型可以调整。

ChatManager 调整如下：

```typescript
class ChatManager {
  constructor(
    toolRegistry: ToolRegistry,
    permissionManager: PermissionManager,
    options?: Partial<AgentLoopOptions>,
    supplemental?: SupplementalPromptContent,
  );

  getPermissionStatus(): PermissionStatus;
  setPermissionMode(mode: PermissionMode): void;
}
```

`run()` 和 `executeLatestPlan()` 透传 PermissionDecider。`clear()` 同时调用 `permissionManager.clearSessionRules()`。模式切换只允许在 ChatManager 空闲时；运行中尝试切换返回明确错误，避免一个工具批次中途改变默认行为。

### Ink 权限确认

新增 `PermissionPrompt` 组件，展示：

- 工具名称与风险等级。
- 规范化目标。
- 即将保存的精确规则。
- `d` 拒绝、`o` 仅本次、`s` 本会话、`p` 永久允许四个选项。

命令类确认同时提示获准命令继承 BetterCode 进程的操作系统权限；`/help` 也保留这一边界说明，避免把路径沙箱误解为 Shell 系统级隔离。

App 为每次运行创建一个 PermissionDecider。收到请求后把 Promise 的完成函数存入 ref，并渲染单个确认面板；用户按键后只完成一次 Promise 并清空面板。运行取消或结束时清理尚未完成的面板，迟到按键不再关联任何请求。

等待权限时 InputBox 保持隐藏，`Ctrl+C` 继续取消整个运行。权限面板使用明确文本，不把写入内容或编辑正文显示到终端。顶部状态显示当前权限模式；`/help` 增加 `/permissions` 命令说明。

### 启动装配

`src/index.tsx` 的装配顺序调整为：

1. 解析 Provider、配置路径和 `--permission-mode`。
2. 以 `process.cwd()` 创建 ToolRegistry。
3. 从 Registry 取得已注册工具名，创建 PermissionConfigStore。
4. 加载三层配置并创建 RuleEngine、SandboxPolicy、PermissionManager。
5. 把 ToolRegistry 和 PermissionManager 注入 ChatManager。
6. 把权限状态与配置诊断交给 App 展示。

无效的 `--permission-mode` 在启动前报错。权限 YAML 诊断不终止应用，但对应无效层不参与匹配；默认模式仍要求用户确认，严格模式仍拒绝，放行模式仍受黑名单、沙箱及其他有效 deny 规则约束。

## 模块交互

### 规则直接允许

```text
LLM tool_call
  -> ToolScheduler 校验
  -> PermissionManager
     -> 黑名单未命中
     -> 沙箱通过
     -> project local allow 命中
  -> permission_decision(allowed, local_rule)
  -> ToolRegistry.execute
  -> tool_result
  -> AgentLoop 下一轮
```

### 默认模式人工确认

```text
LLM tool_call
  -> ToolScheduler 校验
  -> PermissionManager 未命中规则
  -> permission_request
  -> Ink PermissionDecider 等待按键
  -> allow_session
  -> RuleEngine 添加精确 session allow
  -> permission_decision(allowed, user)
  -> ToolRegistry.execute
  -> tool_result
```

### 黑名单拒绝后调整

```text
LLM run_command(高危命令)
  -> CommandBlacklist 命中
  -> permission_decision(denied, blacklist)
  -> tool_result(DANGEROUS_COMMAND)
  -> AgentLoop 不停止
  -> LLM 改用安全工具或解释限制
```

### 等待确认时取消

```text
permission_request
  -> PermissionDecider pending
  -> 用户 Ctrl+C
  -> AbortSignal 先完成
  -> PERMISSION_CANCELLED
  -> 迟到决定被忽略
  -> AgentLoop 以 cancelled 停止
```

## 文件组织

```text
bettercode/
├── .gitignore                                  — 忽略项目本地权限文件
├── package.json                                — 增加 minimatch 直接依赖
├── docs/permission-system/
│   ├── spec.md
│   ├── plan.md
│   ├── task.md
│   └── checklist.md
└── src/
    ├── permission/
    │   ├── types.ts                            — 模式、规则、请求、决定和诊断类型
    │   ├── command-blacklist.ts                — 不可配置危险命令匹配
    │   ├── command-blacklist.test.ts
    │   ├── sandbox.ts                          — 权限目标规范化与路径预检
    │   ├── sandbox.test.ts
    │   ├── rule-parser.ts                      — 规则表达式解析和 glob 编译
    │   ├── rule-parser.test.ts
    │   ├── rule-engine.ts                      — 分层匹配和优先级
    │   ├── rule-engine.test.ts
    │   ├── config-store.ts                     — 三层 YAML 加载与本地原子写入
    │   ├── config-store.test.ts
    │   ├── manager.ts                          — 五层判定编排与确认处理
    │   ├── manager.test.ts
    │   └── factory.ts                          — 权限模块启动装配
    ├── tool/
    │   ├── types.ts                            — ToolPermissionProfile 与权限错误码
    │   ├── registry.ts                         — 参数预检接口
    │   └── tools/*.ts                          — 六个工具声明权限画像
    ├── agent/
    │   ├── types.ts                            — 权限事件与 PermissionDecider 运行选项
    │   ├── tool-scheduler.ts                   — 两阶段权限调度
    │   ├── tool-scheduler.test.ts
    │   ├── loop.ts                             — 传递决策器并保持拒绝后循环
    │   └── loop.test.ts
    ├── chat/
    │   ├── manager.ts                          — 模式控制与会话规则清理
    │   └── manager.test.ts
    ├── ui/
    │   ├── permission-prompt.tsx               — 人工确认面板
    │   └── app.tsx                             — 决策 Promise、权限命令与状态
    └── index.tsx                               — 权限配置和依赖装配
```

不新增 Provider 协议文件：权限判断完全发生在模型工具调用解析完成之后，OpenAI、DeepSeek 和 Anthropic 继续共享同一 ToolCall。

## 技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 强制层顺序 | 黑名单与沙箱先于全部规则 | 保证任何配置和确认都不能突破硬边界 |
| 权限模式语义 | 只决定规则未命中的调用 | 保留显式 allow/deny 的可预测性，符合已批准方案 |
| 配置层级 | session > local > project > user | 越接近当前工作上下文优先级越高 |
| 永久授权位置 | 项目本地 YAML | 避免个人授权污染团队共享规则或全部项目 |
| 永久授权范围 | 当前主目标的精确规则 | 防止一次确认意外扩大成宽泛 glob 权限 |
| 规则格式 | 有序对象数组 | 能表达结果与表达式，保留顺序解决同层冲突 |
| glob 实现 | `minimatch` 预编译 matcher | 避免自制 glob 语义产生安全与兼容偏差 |
| 配置错误 | 跳过无效层并展示诊断 | 不让坏配置产生 allow，也不让非核心配置错误拖垮主程序 |
| 文件沙箱 | 权限预检 + 工具执行时 PathGuard | 同时提供早期拒绝和最终边界，降低状态变化风险 |
| Shell 路径边界 | 不解析 Shell 文件访问 | 文本解析无法形成可靠 OS 沙箱，明确依赖其余权限层 |
| 人工确认接口 | Promise 型 PermissionDecider | 不绑定 Ink，测试和未来前端可独立提供决策 |
| 权限事件 | 纯数据 AgentEvent | 保持 Agent 与 UI 解耦，不把回调塞进事件历史 |
| 批量权限 | 串行判权、分组执行 | 会话规则能影响后续调用，同时保留安全只读并发 |
| 拒绝行为 | 结构化 tool result，不新增停止原因 | 模型可以根据拒绝调整，符合 Agent Loop 恢复语义 |
| 模式切换 | CLI 初始值 + 空闲时 slash 命令 | 既支持启动自动化，也支持会话中明确切换 |
| 本地写入 | 重读校验 + 临时文件原子替换 | 避免覆盖外部修改或留下半写配置 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 正则黑名单存在漏报 | 明确其已知模式边界，默认模式仍确认命令，支持显式 deny |
| 黑名单误伤安全命令 | 使用命令边界并覆盖负例测试，返回命中类别便于诊断 |
| glob 规则授权范围超预期 | UI 展示将保存的规则；人工授权默认生成转义后的精确表达式 |
| 符号链接在判权后变化 | 工具执行时再次调用 PathGuard，不把预检结果当执行路径缓存 |
| 配置文件被并发修改 | 永久写入前重读并校验，使用同目录原子替换 |
| UI 未处理确认导致挂起 | 非交互调用不传 decider 时立即拒绝；取消信号可终止 pending Promise |
| 多调用同时弹确认 | 权限判定按原调用顺序串行，只维护一个活动确认 |
| 权限拒绝破坏工具消息配对 | 调度器为每个调用生成 ToolResult，并沿用按原顺序回灌逻辑 |
| 用户误以为 Shell 受路径沙箱 | 帮助、确认风险文字和文档明确命令继承进程系统权限 |

## 验证策略

1. **纯函数单元测试**：危险命令正反例、表达式解析、glob 具体程度和规则冲突。
2. **文件系统单元测试**：三层 YAML、损坏配置、符号链接逃逸、项目本地原子写入。
3. **PermissionManager 测试**：五层顺序、三档模式、四种人工选择、取消和决策器异常。
4. **Scheduler 测试**：无效参数不确认、串行判权、只读并发、副作用串行、结果保序。
5. **Agent 集成测试**：权限拒绝写入历史后模型下一轮调整并完成，不触发额外停止原因。
6. **Chat/UI 边界测试**：`/clear` 清会话规则、模式切换状态、确认 Promise 只完成一次。
7. **全量回归**：运行类型检查和全部自动化测试，确认 Provider、Prompt、Tool 与 Agent 既有能力不回退。
8. **人工验收**：默认模式实际确认一次命令，验证本次、会话和永久授权的交互与配置落盘。
