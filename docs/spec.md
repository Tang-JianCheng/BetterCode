# BetterCode Spec

## 背景

从零开始构建一个终端 AI 编程助手 BetterCode，类似 Claude Code。当前是第一步里程碑：实现一个可交互的 TUI 对话界面，接入大模型 API，支持流式对话。

## 目标

- 用户在终端启动 BetterCode 后，进入交互式对话界面
- 可以输入问题，BetterCode 调用大模型 API，流式逐字打印回复
- 支持多轮对话，AI 能记住上下文（纯内存，退出即丢弃）
- 通过 YAML 配置文件管理多个 LLM 供应商，启动时选择

## 功能需求

- **F1: 交互式对话界面 (TUI)** — 启动 BetterCode 后进入终端对话界面，用户可以输入问题并查看 AI 回复。基于 Ink 框架构建。
- **F2: 流式逐字输出** — AI 回复通过 SSE 流式返回，逐 token 渲染到终端，不等全部生成完再显示。
- **F3: 多轮对话** — 对话上下文在会话内保留，AI 能引用之前说过的话。上下文存于进程内存，退出即丢弃。
- **F4: YAML 配置文件** — 通过 YAML 文件管理 LLM 供应商，支持配置多个。六个配置字段：`name`（供应商标识名）、`protocol`（协议类型，如 `anthropic` / `openai`）、`model`（模型名）、`base_url`（API 地址）、`api_key`（认证密钥）、`thinking`（boolean, 可选，默认 false）。支持三种切换方式：命令行 `--provider <name>` 指定、启动后交互式列表选择、配置文件中 `default: true` 标记默认项。优先级：命令行 > default 标记 > 交互式选择。
- **F5: 双后端支持** — 支持 Anthropic Claude API 和 OpenAI API 两种协议，通过配置的 `protocol` 字段切换。
- **F6: Extended Thinking** — 当使用 Anthropic 协议且 `thinking: true` 时，在请求中启用 Claude extended thinking 功能。`budget_tokens` 使用内部默认值（如 4000），暂不暴露给配置文件。
- **F7: Provider 抽象层** — LLM 调用封装为统一接口，不同后端（Anthropic、OpenAI）实现同一个接口，未来新增后端无需修改上层调用逻辑。

## 非功能需求

- **N1: 流式延迟** — 首个 token 出现的时间不应超过 API 响应延迟 + 100ms 渲染开销。
- **N2: 终端兼容** — 支持 macOS/Linux 主流终端（iTerm2、Terminal.app、kitty、GNOME Terminal 等），最低终端宽度 80 列。
- **N3: 错误处理** — API 调用失败、网络超时、YAML 配置格式错误等场景需给出明确的中文错误提示，而非直接 crash。
- **N4: 代码可扩展** — Provider 接口设计清晰，新增一个协议后端不超过 100 行代码（不含 API 请求细节）。

## 不做的事

- 不做 tool use / function calling
- 不做文件操作和代码编辑
- 不做会话持久化（纯内存，退出即丢）
- 不做流式中断/重新生成/编辑上一条消息
- 不做多会话管理
- 不做 Markdown 富文本渲染（这一步纯文本输出即可）
- 不做对话历史搜索和导出

## 验收标准

- **AC1: 启动与对话** — 运行 `pnpm start`，终端出现对话界面。输入 "你好"，AI 流式返回回复，每个 token 逐个出现。
- **AC2: 多轮对话** — 在同一会话中连续输入 "我叫小明"，再输入 "我叫什么名字？"，AI 能回答出 "小明"。
- **AC3: YAML 配置切换** — 修改 `config.yaml`，将 `protocol` 从 `anthropic` 改为 `openai`（或反过来），重启后能正常调用对应的 API 后端。
- **AC4: Extended Thinking** — 使用 Anthropic 协议且 `thinking: true` 时，API 请求中包含 extended thinking 参数，返回中可见 thinking 内容或标记。
- **AC5: 错误提示** — 配置 `api_key` 为无效值，启动后输入问题，终端显示明确的中文错误信息（如"API 认证失败，请检查 api_key 配置"），而非堆栈 trace。
- **AC6: tmux 端到端** — 按照 CLAUDE.md 验收流程，在 tmux 中完成一次完整对话（启动 → 提问 → 流式回复 → 追问 → 退出），行为符合预期。
- **AC7: 多供应商切换** — 配置文件中配置两个供应商，一个标记 `default: true`。分别验证：不传参时使用默认供应商、`--provider <name>` 指定其他供应商、无 default 标记且不传参时交互式选择。
