# MewCode Tool System Plan

## 架构概览

工具系统在现有四层架构中新增独立 Tool 层，并让 Chat 层承担单次工具闭环编排：

```text
UI (Ink) -> ChatManager -> LLMProvider
                    |             |
                    v             v
              ToolRegistry   Anthropic / OpenAI
                    |
                    v
       File Tools / Search Tools / Exec Tool
```

- **UI** 继续负责用户输入、流式文本和 Thinking 展示，工具执行期间沿用现有“正在生成回复”状态。
- **ChatManager** 编排第一次模型请求、工具调用检查、工具执行、结果回灌和第二次最终回复请求。
- **Provider** 将统一消息和工具定义转换为 Anthropic/OpenAI 格式，解析 SSE 文本、Thinking 和完整工具调用；Provider 不执行工具。
- **ToolRegistry** 注册六个工具，校验参数，控制超时，捕获错误并限制输出。
- **Tool 实现** 共享启动时确定的项目根目录和输出限制。
- **PathGuard** 负责文件类工具的路径、真实路径和符号链接边界；命令工具只固定 `cwd`。
- **测试层** 使用临时目录、模拟 SSE 和 Fake Provider，不访问真实 LLM API 或 Ink UI。

一次用户回合最多发生两次模型请求：

```text
用户输入
  -> 第一次模型请求
  -> 无工具调用：保存文本并结束
  -> 恰好一个工具调用：执行一次并回灌
     -> 第二次模型请求（不再提供工具定义）
     -> 保存最终文本并结束
  -> 多个工具调用：全部不执行，返回限制提示
```

第二次请求不携带工具定义，从协议入口阻止连续工具调用；即使 Provider 返回异常工具调用事件，ChatManager 也拒绝执行。

| Spec 需求 | 架构归属 |
|---|---|
| F1 | PathGuard + 启动根目录 |
| F2-F4 | Tool 接口 + ToolRegistry + Provider 转换 |
| F5-F10 | 六个具体工具 |
| F11 | ToolRegistry 执行包装 |
| F12 | Anthropic/OpenAI 流式解析 |
| F13-F14 | ChatManager 单次闭环 |
| N1-N9 | 共享限制、错误模型、测试层及平台约束 |

## 核心数据结构

```typescript
type JsonObject = Record<string, unknown>;
type JsonSchema = Record<string, unknown>;

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

type ToolErrorCode =
  | 'INVALID_ARGUMENTS' | 'TOOL_NOT_FOUND' | 'PATH_OUTSIDE_ROOT'
  | 'FILE_NOT_FOUND' | 'NOT_TEXT_FILE' | 'MATCH_NOT_FOUND'
  | 'MATCH_NOT_UNIQUE' | 'TIMEOUT' | 'EXECUTION_ERROR' | 'INTERNAL_ERROR';

interface ToolResult {
  ok: boolean;
  output: string;
  error?: { code: ToolErrorCode; message: string };
  metadata: Record<string, string | number | boolean | null>;
}

interface ToolContext {
  rootDir: string;
  signal: AbortSignal;
  maxOutputBytes: number;
}

interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  execute(input: JsonObject, context: ToolContext): Promise<ToolResult>;
}

interface ToolRuntimeOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

class ToolRegistry {
  constructor(rootDir: string, options?: Partial<ToolRuntimeOptions>);
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  definitions(): ToolDefinition[];
  execute(call: ToolCall): Promise<ToolResult>;
}

function createCoreToolRegistry(
  rootDir: string,
  options?: Partial<ToolRuntimeOptions>,
): ToolRegistry;
```

`output` 承载给模型阅读的文本；`metadata` 保存路径、字节数、退出码、匹配数、耗时和截断状态。所有结果序列化为合法 JSON 后回灌。

对话消息扩展为：

```typescript
type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string; isError: boolean };

type StreamEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'thinking_delta'; content: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'error'; content: string }
  | { type: 'done'; content: '' };

interface LLMProvider {
  readonly name: string;
  readonly model: string;
  chat(
    messages: Message[],
    tools: ToolDefinition[],
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}
```

六个稳定工具名：`read_file`、`write_file`、`edit_file`、`run_command`、`find_files`、`search_code`。

## 模块设计

### ToolRegistry

使用 `Map<string, Tool>` 保证名称唯一；使用 `Ajv` 校验工具自己的 JSON Schema；为每次调用创建 `AbortController`，默认 30 秒后中止；捕获已知错误和未知异常，统一生成 `ToolResult`；对最终结果执行 64 KiB 限制并设置 `metadata.truncated`；按注册顺序返回工具定义。

### PathGuard

启动时将项目根目录转换为真实绝对路径。已有目标拒绝绝对路径和越过根目录的 `..`，解析真实路径后确认仍在根目录内。待创建目标检查最近存在父目录的真实路径，避免父目录符号链接把写入引到根目录外。允许指向项目内目标的符号链接，拒绝指向项目外的符号链接。

### 六个工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `read_file` | `path: string` | 读取普通 UTF-8 文件，严格解码检测非文本 |
| `write_file` | `path: string`, `content: string` | 创建父目录并完整覆盖文件 |
| `edit_file` | `path: string`, `old_text: string`, `new_text: string` | 原文非空且恰好一次才写回 |
| `run_command` | `command: string` | 非交互 shell，固定项目根目录 `cwd` |
| `find_files` | `pattern: string` | glob 查找文件和目录，返回稳定排序相对路径 |
| `search_code` | `query: string`, `glob?: string`, `regex?: boolean`, `case_sensitive?: boolean` | 搜索文本或正则，返回 `path:line:content` |

`search_code` 默认 `glob: "**/*"`、`regex: false`、`case_sensitive: true`。两个搜索工具默认忽略 `.git`、`node_modules`、`dist`，包含普通隐藏文件且不跟随目录符号链接。非法正则返回 `INVALID_ARGUMENTS`。

### 命令进程管理

使用 shell 子进程收集 `stdout`、`stderr` 和退出码。退出码 `0` 为成功；非零退出码返回 `EXECUTION_ERROR` 并保留输出；超时后终止整个子进程组，必要时强制终止。输出读取过程保持有界，不接受 `cwd`、环境变量覆盖或交互式输入参数。

### OpenAI Provider

**请求转换：** 工具定义转换为 `tools[].function`，Schema 放入 `parameters`；assistant 工具调用转换为 `tool_calls`；工具结果转换为 `role: "tool"` 并用 `tool_call_id` 关联；第二次请求不发送 `tools` 字段。

**流式解析：** 按 `choices[0].delta.tool_calls[].index` 聚合调用；首片记录 ID 和函数名，后续片段拼接 `function.arguments`；流结束解析 JSON 并发出一个 `tool_call`；非法 JSON 或非对象参数只发出 `error`。

### Anthropic Provider

**请求转换：** 工具定义转换为 `tools[]` 并将 Schema 放入 `input_schema`；assistant 工具调用转换为 `tool_use` 内容块；相邻工具结果合并为一个 user 消息中的多个 `tool_result` 内容块；`isError` 映射为 `tool_result.is_error`。

**流式解析：** `content_block_start` 记录 tool-use 索引、ID 和名称；`input_json_delta` 按索引拼接 `partial_json`；`content_block_stop` 完成解析并发出 `tool_call`。文本和 Thinking 继续使用现有增量事件。两个 Provider 都允许注入测试用 `fetch`，生产环境默认使用全局 `fetch`。

### ChatManager

构造函数接收 `ToolRegistry`，`send()` 内部拆成可测试的单轮请求辅助逻辑：

1. 将用户消息加入历史。
2. 使用完整工具定义发起第一次模型请求。
3. 无工具调用时保存 assistant 文本并结束。
4. 恰好一个调用时保存带 `toolCalls` 的 assistant 消息，执行工具，保存 tool 消息，再不携带工具定义发起第二次请求并保存最终文本。
5. 首次响应包含多个调用时不写入未完成的协议调用、不执行任何工具，写入限制提示。
6. 第二次响应异常地产生工具调用时不执行，写入限制提示。

工具执行失败仍正常回灌：失败的 `ToolResult` 使用 `isError: true`，让模型解释失败并给出最终回复。

### UI 与启动

入口使用 `process.cwd()` 作为项目根目录：

```typescript
const registry = createCoreToolRegistry(process.cwd());
const chatManager = new ChatManager(registry);
```

UI 不新增工具专用状态。第一次请求、工具执行和第二次请求期间输入框保持禁用；所有文本增量继续进入当前回复区域。

### 测试模块

使用 Node.js 内置 `node:test` 和 `assert`，通过现有 `tsx` 执行，不新增测试框架。

- **Tool 测试**：临时目录、正常输入、参数错误、路径穿越、符号链接、UTF-8、写入、唯一编辑、命令退出/超时、glob、搜索和输出截断。
- **Registry 测试**：工具定义、重名、未知工具、Schema 校验、异常、超时和结果序列化。
- **Provider 测试**：注入假 `fetch` 和人工 `ReadableStream`，验证两种协议的消息映射、工具定义、SSE 参数碎片、非法 JSON、HTTP 错误和流中断。
- **ChatManager 测试**：Fake Provider 验证纯文本一次请求、单工具两次请求、成功/失败结果、多工具拒绝、第二次工具拒绝和历史清理。

新增脚本：

```json
{
  "test": "tsx --test src/**/*.test.ts",
  "check": "pnpm typecheck && pnpm test"
}
```

## 模块交互

### 纯聊天流程

```text
UI -> ChatManager.send(userInput)
   -> history 追加 user
   -> Provider.chat(history, toolDefinitions)
   -> text_delta / thinking_delta -> UI
   -> history 追加 assistant -> 结束
```

### 单工具闭环

```text
UI -> ChatManager.send
   -> Provider.chat(history, toolDefinitions)
   -> Provider 聚合 SSE -> tool_call
   -> ChatManager 确认只有一个调用
   -> ToolRegistry.execute
      -> 查找 -> Ajv 校验 -> 超时控制 -> Tool.execute
      -> 错误归一化 -> 输出截断
   -> history 追加 tool + ToolResult JSON
   -> Provider.chat(history, [])
   -> 最终文本流式渲染并写入 history
```

### 多工具拒绝

Provider 首次返回两个或更多调用时，ChatManager 不调用 Registry，丢弃未执行调用，不写入协议历史，写入并显示限制提示后结束。

### 工具失败

参数错误、路径越界、执行失败或超时会生成 `ok: false` 的 `ToolResult`；ChatManager 仍写入匹配 `toolCallId` 的 tool 消息，第二次模型请求读取错误结果并生成最终说明。

### 清空历史

`ChatManager.clear()` 清空 user、assistant、tool 三类消息；ToolRegistry 和项目根目录保持不变，因此 `/clear` 后仍可使用工具。

## 文件组织

```text
project/
├── package.json                         — 新增 ajv、fast-glob、test/check 脚本
├── src/
│   ├── tool/
│   │   ├── types.ts                     — Tool、ToolCall、ToolResult、Schema
│   │   ├── errors.ts                    — ToolErrorCode 和已知错误
│   │   ├── path-guard.ts                — 项目根目录和符号链接边界
│   │   ├── output-limit.ts              — 输出截断与序列化
│   │   ├── registry.ts                  — 注册、Schema、超时、执行封装
│   │   ├── factory.ts                   — 创建并登记六个工具
│   │   └── tools/
│   │       ├── read-file.ts
│   │       ├── write-file.ts
│   │       ├── edit-file.ts
│   │       ├── run-command.ts
│   │       ├── find-files.ts
│   │       └── search-code.ts
│   ├── provider/
│   │   ├── types.ts                     — Message、StreamEvent、LLMProvider
│   │   ├── openai.ts                    — OpenAI 消息映射和工具 SSE
│   │   ├── anthropic.ts                 — Anthropic 消息映射和工具 SSE
│   │   └── factory.ts                   — 保持现有 Provider 工厂
│   ├── chat/manager.ts                  — 单工具闭环和历史回灌
│   ├── ui/app.tsx                       — 适配新 ChatManager
│   └── index.tsx                        — 创建根目录、Registry 和 ChatManager
└── src/**/*.test.ts                     — Tool、Provider、ChatManager 测试
```

## 技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| HTTP/SSE | Node 内置 `fetch` 和 `ReadableStream` | 延续现有实现，不增加网络层依赖 |
| 参数校验 | `ajv` | 工具 Schema 同时用于模型描述和运行时校验 |
| 文件模式查找 | `fast-glob` | 跨 macOS/Linux，避免依赖系统 `find` 或 `rg` |
| 测试框架 | Node 内置 `node:test` + `tsx` | 不增加测试框架，支持临时目录和流模拟 |
| 根目录来源 | 启动时的 `process.cwd()` | 与用户启动命令的项目上下文一致 |
| 路径安全 | 真实路径 + 最近存在父目录检查 | 覆盖路径穿越和符号链接越界 |
| 工具超时 | Registry 创建 `AbortController`，默认 30 秒 | 统一控制所有工具，命令响应终止信号 |
| 输出上限 | Registry 统一限制 64 KiB | 避免各工具行为不一致 |
| 工具调用轮次 | 首次带工具，第二次不带工具 | 完成一次闭环并阻止 Agent Loop |
| 消息模型 | 内部统一消息，Provider 各自映射 | 保持 Chat 层协议无关，适配两种 API |
| 命令隔离 | 只固定 `cwd`，不实现 OS 沙箱 | 符合已批准的工作目录约束，控制范围 |
| 工具错误 | 结构化 `ToolResult`，错误结果也回灌 | 让模型理解失败并调整最终回答 |

本阶段不改动现有配置格式和 Provider 选择逻辑，只扩展 Provider 请求消息和 ChatManager 初始化链路。
