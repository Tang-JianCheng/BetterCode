# BetterCode Hook 系统 Plan

## 架构概览

本章新增独立 `hook` 领域层，以 `HookManager` 作为唯一运行入口。配置加载、条件编译、动作执行、一次性状态、提示词队列、后台任务和失败日志都收敛在该层；系统入口、Chat、Agent Loop 和 ToolScheduler 只发布类型化生命周期事件，不解析 YAML，也不直接执行动作。

```text
~/.bettercode/hooks.yaml
<project>/.bettercode/hooks.yaml
<project>/.bettercode/hooks.local.yaml
                |
                v
HookConfigLoader -- 严格解析、环境变量展开、三层稳定合并
                |
                v
HookCompiler ----- 公共 PatternMatcher + 事件字段校验 + 模板编译
                |
                v
HookManager
  |- lifecycle state    system / session / turn
  |- dispatch(event)    条件匹配、同步串行、后台调度、首个拒绝
  |- prompt queue       prepare / commit，一次 Provider 请求消费
  |- once state         idle / running / completed
  |- background tasks   有界关闭与取消
  `- HookLogger         .bettercode/logs/hooks.jsonl
       |
       +--> CommandActionExecutor
       +--> PromptActionExecutor
       +--> HttpActionExecutor
       `--> AgentActionExecutor（占位）

index.tsx       system_start / system_stop
ChatManager     session_start/end, turn_start/end, user_message
AgentLoop       assistant_message, 下一请求提示词消费
ToolScheduler   pre_tool_use / post_tool_use
```

现有 `AgentLoop` 构造参数中的内部 `hooks` 回调改名为 `callbacks`，继续承担文件快照与记忆提取等硬编码内部协作，避免与用户可配置 Hook 概念混淆。用户 Hook 通过独立 `HookRuntime` 接口注入，不复用这组内部回调。

### Spec 覆盖

| Spec | 设计归属 |
|---|---|
| F1、F12 | HookConfigLoader + HookCompiler |
| F2、F3 | HookEventContext + index/Chat/Agent/Tool 发布点 |
| F4 | 公共 PatternMatcher + HookConditionCompiler |
| F5 | CommandActionExecutor |
| F6 | HookPromptQueue + AgentLoop Provider 请求提交点 |
| F7 | HttpActionExecutor |
| F8 | AgentActionExecutor 占位实现 |
| F9 | ToolScheduler 前置 Hook 阶段 + `HOOK_DENIED` 结果 |
| F10 | HookManager once/background 状态 + 动作超时 |
| F11 | 三层加载顺序 + dispatch 串行策略 |
| F13 | HookLogger + 动作错误归一化 |
| F14 | AbortSignal 组合 + HookManager.close |
| N1-N10 | 失败开放、权限组合、资源边界、日志脱敏和集成测试 |

## 配置约定

### 文件位置与顺序

| 层级 | 路径 | 用途 | 执行顺序 |
|---|---|---|---:|
| 用户全局 | `~/.bettercode/hooks.yaml` | 跨项目个人自动化 | 1 |
| 项目共享 | `<project>/.bettercode/hooks.yaml` | 团队共享自动化 | 2 |
| 项目本地 | `<project>/.bettercode/hooks.local.yaml` | 当前工作副本个人自动化 | 3 |

每个文件内按 `hooks` 数组顺序执行。规则没有用户可配的 `id` 或 `priority`；编译后使用 `<layer>:<array-index>` 作为内部稳定标识。项目本地配置和 Hook 日志加入 `.gitignore`：

```gitignore
.bettercode/hooks.local.yaml
.bettercode/logs/
```

### YAML 根结构

```yaml
version: 1
hooks:
  - event: pre_tool_use
    if:
      all:
        - field: tool.name
          match: exact
          value: run_command
        - field: tool.arguments.command
          match: regex
          value: '(^|\\s)git\\s+push($|\\s)'
          negate: false
    action:
      type: command
      command: node .bettercode/hooks/check-push.mjs
    timeout_ms: 5000
    once: false
    background: false
```

- `version` 必须是整数 `1`。
- `hooks` 必须是数组，可省略或为空。
- 规则允许字段：`event`、`if`、`action`、`once`、`background`、`timeout_ms`。
- `event` 与 `action` 必填；`if`、三个执行控制字段可选。
- `once`、`background` 默认 `false`。
- `timeout_ms` 只允许命令和 HTTP 动作使用，默认 `30000`，范围为 `1..300000`。
- YAML 使用唯一键解析；未知字段、重复键、类型错误和非法组合均使 BetterCode 启动失败。

### 条件格式

```yaml
if:
  any:
    - field: tool.arguments.path
      match: glob
      value: '**/*.generated.ts'
    - field: tool.arguments.command
      match: regex
      value: '(^|\\s)pnpm\\s+test($|\\s)'
      negate: true
```

`if` 必须且只能包含 `all` 或 `any`，值为至少一个原子条件的数组，不允许嵌套条件组。原子条件字段如下：

```typescript
type HookMatchKind = 'exact' | 'glob' | 'regex';

interface RawHookCondition {
  field: string;
  match: HookMatchKind;
  value: string;
  negate?: boolean;
}
```

- `negate: true` 对实际匹配结果取反。
- 字段缺失时始终不匹配，不因 `negate` 变成命中。
- 配置加载阶段按事件校验字段路径。固定对象字段必须精确存在；`tool.arguments.<name>` 和 `tool.result.metadata.<name>` 允许动态后缀。
- 对象与数组用 `stableStringifyJson` 转成稳定文本；标量使用确定性字符串。
- 正则使用 JavaScript Unicode 正则并在启动期编译，不开放 flags 字段，固定启用 `u`。

### 事件字段白名单

所有事件都有：

```text
event
projectRoot
session.id
timestamp
```

各事件增加：

| 事件 | 可匹配上下文 |
|---|---|
| `system_start` / `system_stop` | `system.reason` |
| `session_start` / `session_end` | `session.reason` |
| `turn_start` | `turn.id`、`turn.mode`、`turn.task` |
| `turn_end` | `turn.id`、`turn.mode`、`turn.task`、`turn.stopReason` |
| `user_message` | `turn.*`、`message.role`、`message.content` |
| `assistant_message` | `turn.*`、`message.role`、`message.content`、`message.toolCalls` |
| `pre_tool_use` | `turn.*`、`tool.id`、`tool.name`、`tool.arguments`、`tool.arguments.*` |
| `post_tool_use` | 执行前全部字段，加 `tool.result.ok/output/error/metadata` |

`message.toolCalls` 是仅含调用标识和工具名的稳定数组，不复制完整参数；工具参数只在工具事件中提供。

### 动作格式

#### 命令

```yaml
action:
  type: command
  command: pnpm exec prettier --write .
```

- 使用系统 Shell，`cwd` 固定为项目根，继承 BetterCode 环境。
- 事件上下文以单个 JSON 对象写入 stdin；stdout 和 stderr 分别限制为 64 KiB。
- `pre_tool_use` 时 stdout 必须是单个结构化决定；其他事件不解析 stdout。

#### 提示词

```yaml
action:
  type: prompt
  prompt: |
    本轮涉及 {{tool.name}}，请在下一次回复中说明验证结果。
```

- `prompt` 是非空字符串，支持 `{{field.path}}` 占位符。
- 占位符必须引用当前事件允许的字段；未知占位符在启动期失败。
- 值位于整段占位符时按稳定文本插入，嵌入普通文本时进行字符串化。
- 不展开环境变量，避免无意把密钥注入模型。

#### HTTP

```yaml
action:
  type: http
  method: POST
  url: https://example.test/hooks/${HOOK_TOKEN}
  headers:
    authorization: Bearer ${HOOK_TOKEN}
    content-type: application/json
  body:
    event: '{{event}}'
    tool: '{{tool.name}}'
    arguments: '{{tool.arguments}}'
```

- `method` 默认为 `POST`，只接受标准 HTTP token；`url` 只接受 HTTP/HTTPS。
- `headers` 是字符串 map；禁止用户覆盖 `content-length` 和 `host`。
- `body` 可为任意 JSON 值，省略时默认发送完整事件上下文。
- URL、请求头和 JSON body 中的字符串支持 `${VAR}` 环境变量展开；缺失变量使启动失败，展开值进入日志脱敏集合。
- URL、请求头和 body 同时支持 `{{field.path}}` 事件模板。先展开环境变量，再编译事件模板。
- 响应正文限制为 64 KiB；非 2xx 状态按动作失败处理。

#### 子 Agent 占位

```yaml
action:
  type: agent
  prompt: 检查当前改动并给出摘要
```

- 本章只校验非空 `prompt` 和事件模板。
- 触发时返回 `NOT_IMPLEMENTED` 动作错误并写 Hook 日志，不调用 Provider。
- `pre_tool_use` 禁止使用该动作。

### 执行前决定协议

命令 stdout 或 HTTP 2xx 响应正文使用同一 JSON：

```json
{ "decision": "allow" }
```

```json
{ "decision": "deny", "reason": "禁止直接推送受保护分支" }
```

解析规则：

1. 根节点必须是对象，只允许 `decision` 和 `reason`。
2. `decision` 只能是 `allow` 或 `deny`。
3. `allow` 不允许携带非空 `reason`。
4. `deny` 必须携带非空字符串 `reason`，清理控制字符后限制为 500 字符。
5. 空输出、额外字段、非法 JSON 或不满足约束都记为动作失败并按放行继续。

## 核心数据结构

### 原始配置与编译规则

```typescript
type HookEventName =
  | 'system_start'
  | 'system_stop'
  | 'session_start'
  | 'session_end'
  | 'turn_start'
  | 'turn_end'
  | 'user_message'
  | 'assistant_message'
  | 'pre_tool_use'
  | 'post_tool_use';

type HookLayer = 'user' | 'project' | 'local';
type HookLogic = 'all' | 'any';
type HookActionType = 'command' | 'prompt' | 'http' | 'agent';

interface HookSource {
  layer: HookLayer;
  file: string;
  index: number;
  id: string;
}

interface CompiledHookRule {
  source: HookSource;
  event: HookEventName;
  condition?: CompiledHookConditionGroup;
  action: CompiledHookAction;
  once: boolean;
  background: boolean;
  timeoutMs: number;
}
```

`RawHookRule` 保留 YAML 字段形状；`CompiledHookRule` 只包含已经验证和编译的匹配器、模板、URL、方法与动作字段，运行期不再解析用户字符串。

### 生命周期上下文

```typescript
interface HookBaseContext {
  event: HookEventName;
  projectRoot: string;
  session: { id: string; reason?: string };
  timestamp: string;
}

interface HookTurnContext {
  id: string;
  mode: AgentMode;
  task: string;
  stopReason?: AgentStopReason;
}

type HookEventContext =
  | HookSystemEventContext
  | HookSessionEventContext
  | HookTurnEventContext
  | HookMessageEventContext
  | HookToolEventContext;
```

联合类型用 `event` 判别。构造后执行深冻结，动作执行器只拿快照。事件文本和工具结果在构造时按 Hook 上限裁剪，避免日志、模板和网络动作复制无界数据；传给工具前 Hook 的 `tool.arguments` 保持完整 JSON 参数，保证安全策略可判断实际调用。

### 匹配器

```typescript
type PatternSyntax = 'auto' | 'exact' | 'glob' | 'regex';
type PatternTargetMode = 'path' | 'literal';

interface CompiledPattern {
  kind: 'exact' | 'glob' | 'regex';
  literalLength: number;
  matches(value: string): boolean;
}

function compilePattern(input: {
  pattern: string;
  syntax: PatternSyntax;
  targetMode: PatternTargetMode;
}): CompiledPattern;
```

- `src/matcher/pattern.ts` 从现有权限 parser 抽取 minimatch 编译、路径与字面值 slash 处理、具体程度计算。
- 权限规则继续传 `syntax: 'auto'`，由 magic 字符决定 exact/glob，保持已有行为。
- Hook 条件传显式 exact/glob/regex，并在 `CompiledHookCondition` 外处理 `negate` 和缺失字段。
- 正则只接受字符串输入，`literalLength` 对 Hook 不参与排序，但保留统一返回结构。

### 动作结果与拒绝

```typescript
type HookDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string };

type HookActionResult =
  | { status: 'success'; decision?: HookDecision; prompt?: string }
  | { status: 'failed'; code: HookFailureCode; message: string };

interface HookDispatchResult {
  denied?: {
    reason: string;
    source: HookSource;
    actionType: 'command' | 'http';
  };
  matched: number;
  completed: number;
}
```

`HookManager.dispatch()` 自己吞掉动作异常，调用方只会收到可选的合法拒绝。ToolScheduler 将拒绝转换为：

```typescript
createToolError('HOOK_DENIED', reason, {
  hookLayer: source.layer,
  hookRule: source.index + 1,
});
```

不向模型暴露配置绝对路径、命令文本、URL、请求头或原始动作输出。

### 提示词批次

```typescript
interface HookPromptEntry {
  id: number;
  source: HookSource;
  content: string;
}

interface PreparedHookPromptBatch {
  throughId: number;
  content: string;
}

interface HookRuntime {
  dispatch(context: HookEventInput, signal: AbortSignal): Promise<HookDispatchResult>;
  preparePromptBatch(): PreparedHookPromptBatch | undefined;
  commitPromptBatch(throughId: number): void;
}
```

`preparePromptBatch` 只读取当前队列，不删除。AgentLoop 把内容加入当前 runtime reminder，ContextManager 返回 `ready` 后、调用 Provider 前执行 `commitPromptBatch`。上下文压缩取消、容量错误或其他未发送请求不会丢失注入；Provider 流失败时请求已经发出，因此批次保持已消费。

### 一次性和后台状态

```typescript
type HookOnceState = 'running' | 'completed';

interface BackgroundHookTask {
  source: HookSource;
  controller: AbortController;
  promise: Promise<void>;
}
```

- 非一次性规则不进入状态表。
- 一次性规则调度前原子写入 `running`；同规则再次触发时跳过。
- 动作成功后改为 `completed`；失败或取消后删除状态，允许后续事件重试。
- 后台任务持有应用关闭信号与事件信号的组合信号，完成后从集合移除。
- `close()` 先停止接收普通事件，再取消后台任务并有界等待；`system_stop` 通过专用关闭入口在停止接收前同步发布一次。

### 日志记录

```typescript
interface HookLogEntry {
  timestamp: string;
  level: 'error' | 'warning';
  source: HookSource;
  event: HookEventName;
  actionType: HookActionType;
  code: HookFailureCode;
  message: string;
}

interface HookLogger {
  write(entry: HookLogEntry): Promise<void> | void;
}
```

默认 `JsonlHookLogger` 追加写入 `<project>/.bettercode/logs/hooks.jsonl`。每行不超过 2 KiB，消息先替换环境展开密钥、认证头值和控制字符，再截断。日志写入使用内部串行队列；目录创建、文件写入和 logger 自身错误全部吞掉，不反向影响 HookManager。

## 模块设计

### `src/matcher/pattern.ts`

**职责：** 提供权限和 Hook 共用的精确、glob、正则编译与匹配。

**接口：** `compilePattern()`、`PatternCompileError`。

**依赖：** `minimatch`。

**兼容要求：** 权限 parser 迁移后现有字符串 slash 处理、转义和具体程度必须逐项保持。

### `src/hook/types.ts`

**职责：** 定义原始配置、编译规则、事件上下文、动作结果、日志和运行接口。

**依赖：** Agent、Tool 的纯类型导入。

### `src/hook/field.ts`

**职责：** 维护每种事件允许的字段路径，读取嵌套值并转换成匹配文本；拒绝原型链键和越界路径。

**接口：** `validateHookField(event, field)`、`readHookField(context, field)`、`formatHookField(value)`。

### `src/hook/template.ts`

**职责：** 编译和渲染 `{{field.path}}` 模板；递归处理 HTTP JSON body；保证未知字段在启动期失败。

**接口：** `compileTextTemplate()`、`compileJsonTemplate()`。

### `src/hook/config-loader.ts`

**职责：** 读取三层 YAML、严格校验根结构和规则、展开 HTTP 环境变量、返回带来源信息的原始规则与脱敏值。

**接口：** `HookConfigLoader.load(): LoadedHookConfig`。

**错误策略：** 任一层错误抛 `HookConfigError`；错误消息包含层、文件和 1 基规则序号，但不包含密钥值。

### `src/hook/compiler.ts`

**职责：** 编译条件、模板、URL 和动作；校验事件与 once/background/timeout/action 的组合约束。

**接口：** `compileHooks(loaded): CompiledHookRule[]`。

**关键校验：**

- `pre_tool_use` 禁止 `once`、`background` 和 agent 动作。
- prompt 动作禁止 `background`；`system_stop` 禁止 prompt。
- prompt/agent 禁止 `timeout_ms`。
- 条件字段和模板字段必须属于所选事件。
- HTTP 请求结构必须能序列化为 JSON。

### `src/hook/command-executor.ts`

**职责：** 通过 Shell 启动进程、写 stdin 上下文、限制输出、处理进程组终止、超时和取消。

**接口：** `executeCommandAction(action, context, signal): Promise<HookActionResult>`。

### `src/hook/http-executor.ts`

**职责：** 渲染 URL/header/body、组合取消和超时信号、发起 fetch、限制响应、解析可选前置决定。

**接口：** `executeHttpAction(action, context, signal): Promise<HookActionResult>`。

### `src/hook/action-executor.ts`

**职责：** 按动作类型分发，提示词动作渲染后返回 prompt，agent 动作返回占位失败；捕获所有实现异常并归一化。

**接口：** `HookActionExecutor.execute(rule, context, signal)`。

### `src/hook/logger.ts`

**职责：** 日志脱敏、有界 JSONL 序列化、串行追加和关闭等待。

**接口：** `JsonlHookLogger.write()`、`close()`。

### `src/hook/manager.ts`

**职责：** 维护系统/会话/轮次状态，构造深冻结事件上下文，匹配规则，执行同步与后台动作，管理 once、提示词队列和生命周期关闭。

**主要接口：**

```typescript
class HookManager implements HookRuntime {
  startSystem(reason?: string): Promise<void>;
  startSession(sessionId: string, reason: string): Promise<void>;
  endSession(reason: string): Promise<void>;
  startTurn(input: HookTurnStartInput, signal: AbortSignal): Promise<string>;
  endTurn(reason: AgentStopReason, signal: AbortSignal): Promise<void>;
  emitUserMessage(content: string, signal: AbortSignal): Promise<void>;
  emitAssistantMessage(message: HookAssistantMessageInput, signal: AbortSignal): Promise<void>;
  dispatch(context: HookEventInput, signal: AbortSignal): Promise<HookDispatchResult>;
  preparePromptBatch(): PreparedHookPromptBatch | undefined;
  commitPromptBatch(throughId: number): void;
  close(reason?: string): Promise<void>;
}
```

生命周期辅助方法保证成对和幂等；工具事件直接走 `dispatch`，由 ToolScheduler 提供当前调用和结果。

### `src/agent/tool-scheduler.ts`

**职责变化：** 增加前置 Hook 阶段和执行后事件，同时保持可见性、Plan Mode、Schema、权限和并发策略。

单个调用的判定顺序：

```text
存在性
 -> Skill 可见性
 -> Plan Mode
 -> Schema 校验
 -> pre_tool_use Hook
 -> PermissionManager
 -> 文件快照回调
 -> ToolRegistry.execute
 -> post_tool_use Hook
```

前置 Hook 对调用按模型原始顺序同步执行。只读工具在完成前置 Hook 和权限后仍并发执行；实际执行结束后，`post_tool_use` 按原调用索引顺序串行发布，确保提示词和同步副作用顺序稳定。被拒绝或执行前取消的调用不发布执行后事件。

### `src/agent/loop.ts`

**职责变化：**

1. 每次收集到完整模型响应后发布一次 `assistant_message`。
2. 每次准备正常 Provider 请求时读取提示词批次并加入 runtime reminder。
3. ContextManager 返回 `ready` 后，在调用 Provider 前提交消费批次。
4. 把 HookRuntime 传给 ToolScheduler。
5. 手动压缩不读取或消费 Hook 提示词。

助手消息 Hook 发生在 usage 统计后、工具调度或自然完成判断前。Hook 动作失败不走 Agent `error` 事件；只有 Hook 日志记录。

### `src/chat/manager.ts`

**职责变化：**

- 构造时接收 HookManager。
- 普通运行和直接 Skill 运行在接受输入后依次发布 `turn_start`、`user_message`，结束时无论成功、取消或异常都发布一次 `turn_end`。
- `clear()` 和 `resumeSession()` 在状态切换前发布旧 `session_end`，状态完成后发布新 `session_start`。
- `close()` 发布当前 `session_end`，但不负责 `system_stop`。
- 手动上下文压缩、权限切换、状态查询和本地命令不算用户任务，不发布 turn/message 事件。

Hook 失败由 HookManager 隔离，因此 ChatManager 不需要围绕每次发布额外 catch；生命周期方法只需保证 finally 中结束轮次。

### `src/skill/runner.ts`

**职责变化：** 把同一个 HookRuntime 传入独立 AgentLoop，使独立 Skill 内的助手消息和工具调用仍触发当前外层 turn 的 Hook。独立 Runner 不重复发布 turn 或 user_message 事件。

### `src/index.tsx`

**启动顺序调整：**

```text
配置与 Provider
 -> 核心工具、MCP、Skill
 -> PermissionManager
 -> HookConfigLoader + HookCompiler + HookManager
 -> ChatManager / SkillRunner
 -> system_start
 -> session_start
 -> TUI
```

Hook 在完整工具列表与权限系统可用后创建，但系统开始 Hook 早于 TUI。关闭顺序为 ChatManager 结束会话、HookManager 发布 `system_stop` 并关闭、Skill/MCP 关闭。启动期 Hook YAML 错误直接进入现有“启动失败”路径。

## 模块交互

### 普通文本任务

```text
ChatManager.start
  -> HookManager.startTurn
  -> HookManager.emitUserMessage
  -> AgentLoop.execute
      -> preparePromptBatch
      -> ContextManager.manage(runtime reminder)
      -> commitPromptBatch
      -> Provider stream
      -> HookManager.emitAssistantMessage
      -> 无工具：完成
  -> HookManager.endTurn
```

### 工具被 Hook 拒绝

```text
Provider -> tool call
ToolScheduler
  -> visibility / plan / schema
  -> HookManager.dispatch(pre_tool_use)
       -> condition match
       -> command/http action
       -> { decision: deny, reason }
  -> createToolError(HOOK_DENIED)
  -> 不调用 PermissionManager
  -> 不调用 beforeToolExecution 快照
  -> 不调用 ToolRegistry.execute
AgentLoop
  -> tool result 写入历史
  -> 下一轮 Provider 根据原因调整
```

### 工具成功并注入提示词

```text
pre_tool_use 全部无拒绝
 -> PermissionManager allow
 -> ToolRegistry.execute
 -> post_tool_use prompt action
 -> HookPromptQueue append
 -> AgentLoop 下一次请求 prepare + commit
 -> Provider 收到一次 runtime instruction
```

### 后台动作

```text
dispatch matching rule
 -> once 规则写 running
 -> 创建组合 AbortSignal
 -> 按顺序启动 Promise
 -> dispatch 立即继续
 -> Promise success: completed / 从任务集移除
 -> Promise failure: 清除 once / 写日志 / 从任务集移除
 -> close: abort + 有界等待
```

### 会话切换

```text
clear/resume
 -> session_end(old id)
 -> 清理或恢复 Chat 状态
 -> session_start(new/restored id)
 -> 已完成 once 状态保持
 -> 已排队 prompt 保持，影响下一次正常 Provider 请求
```

## 文件组织

```text
src/
├── matcher/
│   ├── pattern.ts                 公共精确、glob、正则匹配器
│   └── pattern.test.ts
├── hook/
│   ├── types.ts                   Hook 公共契约
│   ├── field.ts                   事件字段白名单、读取与文本化
│   ├── field.test.ts
│   ├── template.ts                文本与 JSON 事件模板
│   ├── template.test.ts
│   ├── config-loader.ts           三层 YAML 严格加载
│   ├── config-loader.test.ts
│   ├── compiler.ts                条件与动作编译、组合校验
│   ├── compiler.test.ts
│   ├── command-executor.ts        Shell 动作
│   ├── command-executor.test.ts
│   ├── http-executor.ts           HTTP 动作
│   ├── http-executor.test.ts
│   ├── action-executor.ts         动作统一分发和决定解析
│   ├── action-executor.test.ts
│   ├── logger.ts                  脱敏 JSONL 日志
│   ├── logger.test.ts
│   ├── manager.ts                 生命周期、匹配、队列和后台任务
│   └── manager.test.ts
├── permission/
│   ├── rule-parser.ts             改用公共 matcher
│   └── rule-parser.test.ts        保持兼容并补回归
├── agent/
│   ├── loop.ts                    助手事件和提示词消费
│   ├── loop.test.ts
│   ├── tool-scheduler.ts          前后工具 Hook
│   └── tool-scheduler.test.ts
├── chat/
│   ├── manager.ts                 turn/session/user 生命周期
│   └── manager.test.ts
├── skill/
│   ├── runner.ts                  独立 Agent 复用 HookRuntime
│   └── runner.test.ts
└── index.tsx                      Hook 装配与系统生命周期

docs/hook-system/
├── spec.md
├── plan.md
├── task.md
└── checklist.md

.gitignore                         忽略本地 Hook 配置和日志
README.md                          Hook 配置、动作协议与安全边界
```

不新增运行时依赖。YAML、minimatch、fetch、spawn、AbortSignal 和稳定 JSON 均复用现有依赖或 Node.js 内置能力。

## 错误与资源边界

| 场景 | 处理 |
|---|---|
| YAML 或规则无效 | 启动失败，指出来源，不加载部分规则 |
| 条件字段在事件中缺失 | 运行时不匹配，不写错误日志 |
| 命令启动/退出/超时失败 | 写 Hook 日志；非前置事件继续，前置事件按无拒绝继续 |
| HTTP 网络/状态/解析失败 | 写 Hook 日志；按无拒绝继续 |
| 子 Agent 占位触发 | 写 `NOT_IMPLEMENTED` 日志并继续 |
| 提示词模板运行时异常 | 写日志，不入队，不影响 Agent |
| 明确前置 `deny` | 返回 `HOOK_DENIED`，模型可恢复，工具不执行 |
| Hook logger 自身失败 | 静默吞掉，不递归记录 |
| 用户取消 | 中止同步和关联后台动作，保留 Agent 原停止原因 |
| 应用关闭 | 停止新事件、发布一次系统停止、取消后台并有界等待 |

默认边界：

- 命令 stdout：64 KiB；stderr：64 KiB。
- HTTP 响应：64 KiB。
- 事件中的消息、工具输出模板值：64 KiB。
- 拒绝原因：500 字符。
- 单条日志：2 KiB。
- 默认动作超时：30 秒；最大配置超时：5 分钟。
- HookManager 关闭等待：2 秒，超时后放弃等待但保持信号已取消。

## 测试策略

### 单元测试

- 公共 matcher：权限 auto exact/glob、Hook 显式 exact/glob/regex、slash 处理、非法正则。
- 字段读取：所有事件白名单、动态参数路径、原型链键拒绝、稳定 JSON、缺失字段与 negate。
- 模板：文本嵌入、整值替换、JSON 递归、未知字段、边界标签输入。
- 配置：三层顺序、缺文件、唯一键、未知字段、环境变量、符号链接逃逸和全部非法组合。
- 命令：stdin 上下文、成功、非零退出、超时、取消、输出截断和进程组清理。
- HTTP：本地 Server 的 method/header/body、决定解析、非 2xx、超时、取消、截断和密钥脱敏。
- Manager：all/any/negate、同步顺序、首个 deny、once 状态、后台不阻塞、prompt prepare/commit 和幂等关闭。
- Logger：JSONL、有界、控制字符、密钥替换、写入失败隔离。

### 集成测试

- Agent Loop 首请求和工具后请求各只消费一次提示词，ContextManager 未 ready 时不消费。
- `pre_tool_use` deny 后权限、快照、Registry 调用次数均为零，Agent 下一轮恢复。
- `allow` 后仍受 Plan Mode、黑名单、沙箱和权限规则约束。
- 多工具调用保持前置 Hook 原顺序、只读并发、执行后事件索引顺序和工具结果配对。
- 助手中间消息每个完整响应触发一次，文本 delta 不触发。
- ChatManager 普通、计划、执行、直接 Skill、clear、resume、cancel、error、close 的 turn/session 配对。
- 独立 Skill 内工具复用当前 HookManager，不产生额外 turn/user_message。
- system/session 提示词排队后进入第一条真实 Agent Provider 请求。

### 全量回归

- `pnpm typecheck`。
- Hook 定向测试。
- Permission、Agent、Chat、Skill 定向测试。
- `pnpm test` 全量测试。
- `git diff --check`。
- 扫描本章文件中的旧系统名、占位符和新增英文源码注释。

## 技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 总体架构 | 集中式 HookManager | 配置、状态、失败和动作协议只有一个事实来源 |
| 配置层级 | 用户、项目、本地稳定追加 | 与 BetterCode 既有权限配置习惯一致，同时区分共享与个人自动化 |
| 配置错误 | 任一错误阻止启动 | 防止安全 Hook 因静默跳过而失效 |
| 运行期错误 | 失败开放并记录日志 | 满足 Hook 不破坏 Agent 主流程的要求 |
| 执行前拒绝 | 结构化 allow/deny JSON | 命令和 HTTP 使用同一协议，原因可稳定回灌模型 |
| allow 语义 | 仅表示本 Hook 不拒绝 | 保持 Plan Mode 和权限系统不可绕过 |
| 匹配实现 | 抽取公共 matcher | 满足复用要求并保持权限外部语义兼容 |
| 反向匹配 | 原子条件 `negate` | 可反向任意 exact/glob/regex，不新增混合逻辑组 |
| 轮次定义 | 一次用户任务到 Agent 停止 | 避免内部 LLM 迭代造成重复自动化 |
| Prompt 有效期 | 下一次正常 Agent Provider 请求 | 动态、一次性，不污染缓存与长期历史 |
| Prompt 消费 | prepare/commit 两阶段 | 未真正发送请求时不丢失注入 |
| once 范围 | 当前 BetterCode 进程 | 无持久化前语义清晰；重启自然重置 |
| 前置 once | 禁止 | 防止后续工具调用绕过安全检查 |
| 后台执行 | 启动有序、完成无序 | 不阻塞主流程，同时保持可解释启动顺序 |
| 工具后事件 | 实际执行后按索引发布 | 保持提示词与同步副作用确定，不破坏只读执行并发 |
| 命令上下文 | JSON stdin | 不需要脆弱的 Shell 字符串插值，可传完整结构化数据 |
| HTTP 默认 body | 完整事件上下文 | 最小配置即可使用，仍支持显式模板收窄数据 |
| Hook 日志 | 项目本地有界 JSONL | TUI 不被 stderr 打断，错误可追查且不进入版本控制 |
| 子 Agent | 解析有效、运行时报占位诊断 | 先固定配置契约，避免提前耦合未设计的 SubAgent 系统 |
| 热更新 | 本章不做 | 严格启动校验和运行状态更简单，符合范围约束 |
