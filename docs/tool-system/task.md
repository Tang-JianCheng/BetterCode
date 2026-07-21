# MewCode Tool System Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|---|---|---|
| 修改 | `package.json` | 添加 `ajv`、`fast-glob` 和测试脚本 |
| 新建 | `src/tool/types.ts` | 工具、调用、结果和运行时类型 |
| 新建 | `src/tool/errors.ts` | 工具错误码与错误构造 |
| 新建 | `src/tool/path-guard.ts` | 项目根目录和符号链接边界 |
| 新建 | `src/tool/output-limit.ts` | 输出截断与结果序列化 |
| 新建 | `src/tool/registry.ts` | 注册、Schema 校验、超时和错误封装 |
| 新建 | `src/tool/factory.ts` | 创建并登记六个核心工具 |
| 新建 | `src/tool/tools/read-file.ts` | 读取 UTF-8 文件 |
| 新建 | `src/tool/tools/write-file.ts` | 创建或覆盖文件 |
| 新建 | `src/tool/tools/edit-file.ts` | 原文唯一匹配替换 |
| 新建 | `src/tool/tools/run-command.ts` | 项目根目录内的命令执行 |
| 新建 | `src/tool/tools/find-files.ts` | glob 文件查找 |
| 新建 | `src/tool/tools/search-code.ts` | 文本和正则内容搜索 |
| 修改 | `src/provider/types.ts` | 支持工具消息、工具定义和工具调用事件 |
| 修改 | `src/provider/openai.ts` | OpenAI 工具请求映射和 SSE 解析 |
| 修改 | `src/provider/anthropic.ts` | Anthropic 工具请求映射和 SSE 解析 |
| 修改 | `src/chat/manager.ts` | 单工具闭环和结果回灌 |
| 修改 | `src/ui/app.tsx` | 适配工具闭环后的 ChatManager 调用 |
| 修改 | `src/index.tsx` | 创建项目根目录、Registry 和 ChatManager |
| 新建 | `src/tool/path-guard.test.ts` | 路径和符号链接边界测试 |
| 新建 | `src/tool/tools.test.ts` | 六个工具的行为测试 |
| 新建 | `src/tool/registry.test.ts` | 注册、校验、超时和结果测试 |
| 新建 | `src/provider/openai.test.ts` | OpenAI 映射和 SSE 测试 |
| 新建 | `src/provider/anthropic.test.ts` | Anthropic 映射和 SSE 测试 |
| 新建 | `src/chat/manager.test.ts` | ChatManager 闭环测试 |

## T1: 安装工具系统依赖和测试脚本

**文件：** `package.json`

**依赖：** 无

**步骤：**

1. 添加运行时依赖 `ajv` 和 `fast-glob`。
2. 添加 `test: "tsx --test src/**/*.test.ts"`。
3. 添加 `check: "pnpm typecheck && pnpm test"`。
4. 运行依赖安装，保留现有启动和类型检查脚本。

**验证：** `pnpm install` 成功；`pnpm typecheck` 保持通过。

## T2: 定义 Tool 层公共类型和错误码

**文件：** `src/tool/types.ts`, `src/tool/errors.ts`

**依赖：** T1

**步骤：**

1. 定义 `JsonObject`、`JsonSchema`、`ToolDefinition` 和 `ToolCall`。
2. 定义 `ToolResult`、`ToolContext`、`ToolRuntimeOptions` 和 `Tool` 接口。
3. 定义 `ToolErrorCode` 全部错误码。
4. 提供可携带错误码、消息和可选元数据的工具错误类型。

**验证：** `pnpm typecheck` 通过；新增类型可被其他 `src/tool` 文件导入。

## T3: 实现项目根目录 PathGuard

**文件：** `src/tool/path-guard.ts`

**依赖：** T2

**步骤：**

1. 初始化时将根目录解析为真实绝对路径。
2. 拒绝绝对输入路径和包含越界 `..` 的路径。
3. 对已有文件或目录解析真实路径，并确认结果位于根目录内。
4. 对待创建文件检查最近存在父目录的真实路径。
5. 允许项目内符号链接，拒绝解析到项目外的符号链接。
6. 返回可供工具使用的安全绝对路径和相对路径。

**验证：** 用临时目录验证普通路径、绝对路径、`..`、项目内符号链接和项目外符号链接；越界输入均返回 `PATH_OUTSIDE_ROOT`。

## T4: 实现输出限制和结果序列化

**文件：** `src/tool/output-limit.ts`

**依赖：** T2

**步骤：**

1. 定义默认 64 KiB 输出上限。
2. 对文本输出做 UTF-8 字节级限制，避免切断多字节字符。
3. 超限时保留合法文本并标记 `truncated`。
4. 将 `ToolResult` 序列化为合法 JSON，供 Provider 回灌。

**验证：** 用 ASCII 和多字节文本测试边界，确认结果不超过上限、JSON 可解析、截断状态准确。

## T5: 实现读取文件工具

**文件：** `src/tool/tools/read-file.ts`

**依赖：** T2, T3, T4

**步骤：**

1. 定义 `read_file` 名称、描述和 `{ path: string }` Schema。
2. 使用 PathGuard 解析目标。
3. 拒绝目录和非普通文件。
4. 使用严格 UTF-8 解码读取内容。
5. 返回内容、相对路径、字节数和截断元数据。

**验证：** 读取正常文件成功；不存在路径、目录、二进制内容和越界路径返回对应结构化错误。

## T6: 实现写入文件工具

**文件：** `src/tool/tools/write-file.ts`

**依赖：** T2, T3, T4

**步骤：**

1. 定义 `write_file` 名称、描述和 `{ path: string, content: string }` Schema。
2. 通过 PathGuard 解析待创建目标。
3. 创建缺失的父目录。
4. 使用 UTF-8 完整创建或覆盖文件。
5. 返回相对路径和写入字节数。

**验证：** 写入嵌套新路径并读取确认内容；再次写入确认覆盖；越界目标不产生文件。

## T7: 实现精确编辑工具

**文件：** `src/tool/tools/edit-file.ts`

**依赖：** T5, T6

**步骤：**

1. 定义 `edit_file` 名称、描述和 `{ path: string, old_text: string, new_text: string }` Schema。
2. 读取目标并统计原文出现次数。
3. 原文出现一次时执行替换并写回。
4. 出现零次返回 `MATCH_NOT_FOUND`，出现多次返回 `MATCH_NOT_UNIQUE`。
5. 两种失败都不得修改原文件。

**验证：** 分别验证零次、一次、多次匹配，确认只有一次匹配会改变文件。

## T8: 实现命令执行工具

**文件：** `src/tool/tools/run-command.ts`

**依赖：** T2, T4

**步骤：**

1. 定义 `run_command` 名称、描述和 `{ command: string }` Schema。
2. 使用 shell 子进程并固定 `cwd` 为 `context.rootDir`。
3. 收集标准输出、标准错误和退出码，并限制缓冲区大小。
4. 监听 `AbortSignal`，终止整个子进程组并标记超时。
5. 返回成功、非零退出、进程启动失败和超时的结构化结果。
6. 不接受工作目录、环境覆盖或交互输入参数。

**验证：** 在临时根目录执行成功命令、失败命令、输出命令和超时命令，确认退出码、输出、超时标记和进程终止行为。

## T9: 实现文件模式查找工具

**文件：** `src/tool/tools/find-files.ts`

**依赖：** T2, T3, T4

**步骤：**

1. 定义 `find_files` 名称、描述和 `{ pattern: string }` Schema。
2. 拒绝绝对模式和越界模式。
3. 使用 `fast-glob` 从根目录查找文件与目录。
4. 忽略 `.git`、`node_modules`、`dist`，不跟随目录符号链接。
5. 转换为相对路径并稳定排序。

**验证：** 在固定临时目录中验证模式匹配、隐藏文件、忽略目录、符号链接和排序结果。

## T10: 实现代码内容搜索工具

**文件：** `src/tool/tools/search-code.ts`

**依赖：** T2, T3, T4, T9

**步骤：**

1. 定义 `search_code` 名称、描述和查询 Schema。
2. 使用 `fast-glob` 枚举候选文本文件并复用相同忽略规则。
3. 支持普通文本和正则查询，以及大小写开关。
4. 严格按 UTF-8 读取，跳过或报告非文本文件而不修改文件。
5. 返回相对路径、行号和匹配行，按路径和行号稳定排序。
6. 无匹配返回成功的空结果，非法正则返回参数错误。

**验证：** 验证文本、正则、大小写、行号、无匹配、非法正则和大结果截断。

## T11: 实现 ToolRegistry 执行封装

**文件：** `src/tool/registry.ts`

**依赖：** T2, T3, T4, T5-T10

**步骤：**

1. 使用 `Map` 实现注册、按名查找和定义列表。
2. 拒绝重复名称，未知名称返回 `TOOL_NOT_FOUND`。
3. 使用 Ajv 校验调用参数，失败时不执行工具。
4. 为每次调用创建 AbortController 和默认 30 秒计时器。
5. 捕获已知工具错误、超时和未知异常。
6. 对结果统一补充耗时、截断和错误元数据。

**验证：** 使用假工具验证重名、未知工具、Schema 错误、正常执行、异常和超时；确认异常不逃逸到主进程。

## T12: 创建核心工具注册工厂

**文件：** `src/tool/factory.ts`

**依赖：** T11

**步骤：**

1. 接收根目录和运行时选项。
2. 创建六个核心工具实例并按固定顺序注册。
3. 返回准备好的 `ToolRegistry`。

**验证：** 工厂返回的定义恰好包含六个唯一工具名，且每个定义的 Schema 可被 Ajv 编译。

## T13: 扩展 Provider 公共消息和流事件类型

**文件：** `src/provider/types.ts`

**依赖：** T2

**步骤：**

1. 将 `Message` 扩展为 user、assistant、tool 三种消息。
2. 添加 `ToolDefinition`、`ToolCall` 和 `tool_call` 流事件。
3. 修改 `LLMProvider.chat()` 接收工具列表。
4. 保留现有文本、Thinking、错误和完成事件语义。

**验证：** `pnpm typecheck` 通过；现有 Provider 和 ChatManager 的错误会被编译器完整暴露。

## T14: 实现 OpenAI 请求消息和工具定义映射

**文件：** `src/provider/openai.ts`

**依赖：** T13

**步骤：**

1. 将统一工具定义转换为 OpenAI `tools[].function`。
2. 将 user、assistant 文本、assistant tool calls 和 tool 结果映射为 OpenAI 消息。
3. 工具列表为空时不发送 `tools` 字段。
4. 保持原有认证、URL、Thinking 不相关字段和错误处理行为。
5. 为测试保留可注入的 fetch 实现。

**验证：** 用假 fetch 捕获请求 JSON，确认工具 Schema、工具调用和 `tool_call_id` 映射正确。

## T15: 实现 OpenAI 流式工具调用聚合

**文件：** `src/provider/openai.ts`

**依赖：** T14

**步骤：**

1. 按工具调用 index 聚合 ID、函数名和参数碎片。
2. 继续发出文本增量和完成事件。
3. 流结束时解析完整参数对象并发出一次 `tool_call`。
4. 对非法 JSON、非对象参数、HTTP 错误和流中断发出明确错误。
5. 防止同一调用重复发出。

**验证：** 用拆分的 OpenAI SSE 数据验证参数拼接、调用 ID、工具名、错误事件和文本回调。

## T16: 实现 Anthropic 请求消息和工具定义映射

**文件：** `src/provider/anthropic.ts`

**依赖：** T13

**步骤：**

1. 将统一工具定义转换为 Anthropic `tools[]` 和 `input_schema`。
2. 将 assistant tool calls 转换为 `tool_use` 内容块。
3. 将相邻 tool 消息合并为 user 消息中的 `tool_result` 内容块。
4. 映射 `isError` 为 `is_error`。
5. 保持现有 Thinking 参数和文本消息行为。
6. 为测试保留可注入的 fetch 实现。

**验证：** 用假 fetch 捕获请求 JSON，确认工具定义、tool-use、tool-result 和 Thinking 字段正确。

## T17: 实现 Anthropic 流式工具调用聚合

**文件：** `src/provider/anthropic.ts`

**依赖：** T16

**步骤：**

1. 在 `content_block_start` 记录 tool-use 索引、ID 和名称。
2. 按索引拼接 `input_json_delta.partial_json`。
3. 在 `content_block_stop` 解析参数并发出一次 `tool_call`。
4. 保持文本和 Thinking 增量事件。
5. 对非法 JSON、HTTP 错误和流中断发出明确错误。

**验证：** 用拆分的 Anthropic SSE 数据验证参数聚合、调用 ID、工具名、文本/Thinking 事件和错误处理。

## T18: 适配 ChatManager 的纯文本路径

**文件：** `src/chat/manager.ts`

**依赖：** T13

**步骤：**

1. 构造函数接收 `ToolRegistry`。
2. 将现有纯文本发送逻辑拆成可复用的单轮请求辅助逻辑。
3. 纯文本响应时继续追加 assistant 历史并转发 UI 回调。
4. 保持 `getHistory()` 和 `clear()` 的已有行为。

**验证：** 使用 Fake Provider 验证无工具时只调用一次，历史内容和现有回调行为不变。

## T19: 实现 ChatManager 的单工具闭环

**文件：** `src/chat/manager.ts`

**依赖：** T11, T15, T17, T18

**步骤：**

1. 第一次请求传入 Registry 的完整工具定义。
2. 收集工具调用并在恰好一个时写入 assistant tool-call 消息。
3. 调用 Registry 并将序列化结果写入匹配的 tool 消息。
4. 第二次请求传入空工具列表。
5. 收集最终文本并追加 assistant 消息。
6. 工具失败仍执行回灌和第二次请求。

**验证：** Fake Provider 返回一次工具调用时，确认模型请求两次、工具执行一次、历史顺序正确，成功和失败结果均可回灌。

## T20: 实现多工具和异常工具调用拒绝

**文件：** `src/chat/manager.ts`

**依赖：** T19

**步骤：**

1. 首次响应包含多个工具调用时不执行任何工具。
2. 不写入未完成的协议工具消息，写入清晰的限制提示。
3. 第二次请求即使出现工具调用也不执行。
4. 保持对话可继续进行，不让异常工具调用破坏历史。

**验证：** Fake Provider 分别返回多工具和第二次工具调用，确认 Registry 调用次数为零且可继续发送下一条消息。

## T21: 接入启动入口和现有 UI

**文件：** `src/index.tsx`, `src/ui/app.tsx`

**依赖：** T12, T20

**步骤：**

1. 在入口用 `process.cwd()` 创建核心 Registry。
2. 将 Registry 注入 ChatManager，再注入 App。
3. 适配 ChatManager 的新调用签名和消息类型。
4. 保持输入禁用、流式文本、Thinking、`/help`、`/clear`、`/exit` 行为。

**验证：** `pnpm typecheck` 通过；`pnpm start` 能启动并显示现有 TUI。

## T22: 编写路径和文件工具测试

**文件：** `src/tool/path-guard.test.ts`, `src/tool/tools.test.ts`

**依赖：** T3-T7, T9-T10

**步骤：**

1. 使用临时目录建立普通文件、嵌套目录和符号链接 fixture。
2. 覆盖路径边界、读取、写入和唯一编辑行为。
3. 覆盖 glob、稳定排序、忽略目录、文本搜索和正则搜索。
4. 验证无匹配、非法正则、非 UTF-8 和输出截断。

**验证：** `pnpm test -- src/tool/path-guard.test.ts src/tool/tools.test.ts` 全部通过，失败操作不改变 fixture。

## T23: 编写命令和 Registry 测试

**文件：** `src/tool/tools.test.ts`, `src/tool/registry.test.ts`

**依赖：** T8, T11

**步骤：**

1. 验证命令成功、非零退出、标准错误、大输出和超时。
2. 验证工具注册、重名、未知名称和完整定义。
3. 验证 Ajv 参数错误不调用工具执行方法。
4. 验证异常、超时和结果序列化均为结构化结果。

**验证：** `pnpm test -- src/tool/registry.test.ts` 及命令相关测试通过，超时测试不会遗留子进程。

## T24: 编写 OpenAI Provider 测试

**文件：** `src/provider/openai.test.ts`

**依赖：** T14-T15

**步骤：**

1. 注入假 fetch 和可控 SSE ReadableStream。
2. 验证工具定义、assistant tool calls、tool result 的请求映射。
3. 验证拆分的函数名、参数碎片和完成事件。
4. 验证非法 JSON、HTTP 错误和流中断。

**验证：** `pnpm test -- src/provider/openai.test.ts` 通过且不发出真实网络请求。

## T25: 编写 Anthropic Provider 测试

**文件：** `src/provider/anthropic.test.ts`

**依赖：** T16-T17

**步骤：**

1. 注入假 fetch 和可控 Anthropic SSE 流。
2. 验证 `tools`、`tool_use`、合并后的 `tool_result` 和 Thinking 映射。
3. 验证拆分 `partial_json` 的聚合和唯一 `tool_call` 事件。
4. 验证非法 JSON、HTTP 错误、流中断和现有文本事件。

**验证：** `pnpm test -- src/provider/anthropic.test.ts` 通过且不发出真实网络请求。

## T26: 编写 ChatManager 闭环测试

**文件：** `src/chat/manager.test.ts`

**依赖：** T18-T20

**步骤：**

1. 创建按调用次数返回预设事件的 Fake Provider 和假 ToolRegistry。
2. 验证纯文本一次请求、单工具两次请求和工具失败回灌。
3. 验证第二次请求工具列表为空。
4. 验证首次多工具和第二次工具调用都不执行。
5. 验证历史顺序和 `clear()` 行为。

**验证：** `pnpm test -- src/chat/manager.test.ts` 全部通过。

## T27: 回归与集成验证

**文件：** `package.json`, `src/**/*.test.ts`, `src/index.tsx`, `src/ui/app.tsx`

**依赖：** T21-T26

**步骤：**

1. 运行完整类型检查和测试套件。
2. 启动 TUI，确认不调用工具时的纯聊天行为不回归。
3. 用 Fake Provider 或本地测试入口验证工具定义、执行和单次回灌链路。
4. 确认现有供应商选择和配置加载代码未被改变。

**验证：** `pnpm check` 通过；`pnpm start` 启动后出现对话界面或明确配置错误，而不是未捕获堆栈。

## 执行顺序

```text
T1
 |
 +-> T2 -> T3 -> T5 -> T7
 |       |      T6 ----/
 |       +-> T4 -> T8
 |              \-> T9 -> T10
 |                    \-> T11 -> T12
 |
 +-> T13 -> T14 -> T15 --\
 |       \-> T16 -> T17 ---+-> T19 -> T20 -> T21
 |                          /
 +-> T18 ------------------/

T3-T10 -> T22
T8,T11 -> T23
T14,T15 -> T24
T16,T17 -> T25
T18-T20 -> T26
T21-T26 -> T27
```

T5-T10 可以在公共类型和 PathGuard 完成后并行；T14/T15 与 T16/T17 可以并行；测试任务在对应实现完成后并行。
