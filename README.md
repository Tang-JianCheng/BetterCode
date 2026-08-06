# BetterCode

BetterCode 是一个用于学习和交流的终端代码 Agent。它支持流式对话、内置工具、Agent Loop、Plan Mode、权限控制、MCP 工具发现、Skill、生命周期 Hook、长会话上下文管理和跨会话记忆。

## 快速开始

### 环境要求

- Node.js 18+（推荐 20 及以上）
- [pnpm](https://pnpm.io/zh/) 包管理器
- 一个可用的 LLM 供应商 API Key（如 DeepSeek / Anthropic / OpenAI）

### 安装依赖

```bash
pnpm install
```

### 启动

```bash
pnpm start
```

直接启动会进入供应商选择（若 `config.yaml` 未标记唯一默认供应商）。常用方式：

```bash
# 指定供应商启动（名称需与 config.yaml 中 providers 一致）
pnpm start --provider deepseek-v4

# 指定配置文件
pnpm start --config ./config.yaml

# 启动时指定权限模式
pnpm start --permission-mode strict
```

### 配置供应商

编辑项目根 `config.yaml`，用 `${ENV}` 引用环境变量，禁止硬编码 API Key：

```yaml
providers:
  - name: deepseek-v4
    protocol: openai
    model: deepseek-v4-flash
    context_window: 128000
    base_url: https://api.deepseek.com
    api_key: ${DEEPSEEK_API_KEY}
    default: true
```

`--provider` > cc-switch 当前激活供应商 > `config.yaml` 的 `default: true` > 交互选择。若使用 [cc-switch](https://github.com/farion1231/cc-switch) 桌面版，启动时会自动导入其 Claude 供应商（见下文「cc-switch 适配」）。

### 首次使用建议

- 输入 `/help` 查看全部命令，`/status` 查看当前运行状态。
- 输入 `/context` 查看上下文占用网格与分类明细。
- 历史会话用 `/session` 查看与恢复；输入框支持粘贴、Shift+Enter 换行、左右/Home/End 移动光标。
- 整体运行链路可参考 `docs/architecture-overview.md`。

## 终端界面

BetterCode 启动时展示一次 BETTERCODE 像素横幅，运行期间用轻量标记反馈模型请求、工具执行、权限等待和上下文压缩状态。界面底部保持干净的输入工作区；模型、模式、权限、Token 和会话等运行信息通过 `/status` 按需查询，也可用 `/statusline` 让一行极简状态行常驻输入区底部（默认开启，显示当前上下文占用与窗口容量）。

`/help`、`/status`、`/memory`、`/permission`、`/session`、`/model`、`/tasks` 和 `/team` 使用结构化本地面板展示，不会伪装成模型回复。权限与回滚面板支持方向键、Enter 和 Esc；权限选择同时保留 `d/o/s/p` 快捷键，输入框聚焦时按 `Shift+Tab` 可在 strict / default / allow 间循环切换权限模式。

工具执行过程以渐进披露的方式展示：流式期间在活动指示器下方实时列出进行中的工具轨迹，一轮结束后折叠为「工具调用 × N」摘要，输入为空时按 Enter 展开/收起明细。

界面默认面向现代 UTF-8 终端，并提供以下降级开关：

| 环境变量 | 作用 |
|---|---|
| `NO_COLOR=1` | 关闭颜色，保留文字和符号语义 |
| `BETTERCODE_ASCII=1` | 使用 ASCII 边界、形象和活动标记 |
| `BETTERCODE_REDUCE_MOTION=1` | 关闭计时动画，使用静态活动提示 |
| `BETTERCODE_THEME` | 主题预设：`dark`、`light`、`high-contrast`，缺省 `dark` |

`TERM=dumb` 会自动启用 ASCII、无颜色和低动态模式；CI 环境默认关闭动画。主题也可在 `config.yaml` 通过 `ui.theme` 配置，环境变量优先级更高。

## Markdown 渲染

助手完整输出一次后，最终回复会按 Markdown 渲染，避免把 `**`、`#`、`` ` `` 等原始标记直接暴露在终端里。流式输出期间仍保持纯文本，等 Agent 停止后才解析一次，并把解析结果与原文一起保存在历史中。

支持的语法：

- 标题、段落、粗体、斜体、删除线、行内代码和段落内换行。
- 围栏代码块与缩进代码块，代码块保留缩进并显示可选语言标识。
- 无序列表、有序列表和嵌套列表，以及引用块和分隔线。
- GFM 表格；55 列以下自动降级为逐项键值行。
- 链接展示为“文本 (URL)”，图片展示为 `[alt](url)` 文本占位。

渲染安全边界：HTML 只作为普通文字展示，不执行脚本、不解释标签、不加载图片或外部资源；模型内容中的 ANSI 控制序列会被清除。恢复历史会话或回滚对话时，助手消息同样按 Markdown 渲染，用户消息始终按纯文本展示。

## 命令系统

斜杠命令在本地注册中心中解析和分发，不经过普通对话分支。输入 `/help` 可查看完整主命令列表，输入命令前缀后按 Tab 可补全或打开候选菜单。

| 命令 | 作用 |
|------|------|
| `/help [命令]` | 查看全部命令或单条命令详情 |
| `/compact` | 手动压缩较早上下文 |
| `/clear` | 清空当前会话与界面 |
| `/plan` | 切换到 `[PLAN]` 只读计划模式 |
| `/do` | 切换回 `[DEFAULT]` 执行模式 |
| `/session [ID]` | 查看近期会话或恢复指定会话 |
| `/model` | 切换模型：cc-switch Provider 显示档位（Sonnet/Opus/Haiku/Fable），其他 Provider 显示列表 |
| `/memory` | 查看用户级/项目级记忆与治理状态 |
| `/permission [模式]` | 查看或切换权限模式 |
| `/tasks [任务 ID]` | 查看当前会话的子 Agent 任务或单项详情 |
| `/status` | 查看 Provider、模式、Token、会话和记忆状态 |
| `/context` | 查看上下文占用、格子视图与分类明细 |
| `/statusline` | 切换输入区底部常驻状态行（默认开启） |
| `/review [范围]` | 使用内置 review Skill 独立审查代码 |

旧命令 `/resume`、`/r` 和 `/permissions` 继续作为别名可用；`/rewind`、`/exit`、`/quit` 保持兼容。

## Skill 系统

Skill 用 Markdown 保存可复用 SOP。BetterCode 启动时只向模型提供名称和说明，模型调用 `load_skill` 或用户输入同名斜杠命令后，才加载完整指令与白名单工具。

Skill 按项目级、用户级、内置级依次覆盖：

```text
<project>/.bettercode/skills
~/.bettercode/skills
<bettercode>/skills
```

支持根目录单文件 `review.md`，也支持目录入口 `review/SKILL.md`。基础格式：

```markdown
---
name: review
description: 审查代码并按严重程度报告问题
tools: [read_file, find_files, search_code, run_command]
mode: isolated
history: 10
---

审查范围：{{args}}
优先报告 bug、行为回归、安全风险和缺失测试。
```

- `shared` 模式复用主对话并持续激活；多个 Skill 的工具白名单取并集，`/clear` 会清除激活状态。
- `isolated` 模式在临时 Agent 中运行，只向主历史回流最终摘要；`history` 表示携带最近多少条完整消息，默认 `0`。
- 独立模式可用 `model` 指定 `config.yaml` 中的 Provider 配置名；共享模式始终沿用当前 Provider。
- BetterCode 内置 `commit`、`review`、`test` 三个样板，均自动出现在 `/help` 和 Tab 补全中。
- Plan Mode 仍会移除副作用工具，Skill 白名单不能放宽原有权限或安全边界。

目录型 Skill 可在 `tools/` 中携带专属 Node.js 工具：

```text
review/
  SKILL.md
  tools/
    inspect.tool.yaml
    inspect.schema.json
    inspect.mjs
```

`.tool.yaml` 声明工具名称、说明、Schema、脚本、读写效果和权限画像。`.mjs` 从 stdin 读取一次 JSON 参数，并向 stdout 输出结构化 ToolResult JSON。脚本由 Node.js 直接启动，不经过 Shell；它仍继承 BetterCode 进程权限，本章不提供操作系统级沙箱或网络隔离。

## 子 Agent 系统

BetterCode 通过一个稳定的 `agent` 工具委派独立子任务。角色变化不会改变 Provider 看到的工具 Schema，模型使用 `type` 在两种路径间选择：

- `defined` 从空消息历史和固定角色提示启动，可选择前台或后台执行。角色可指定工具白名单、黑名单、后台工具、模型档位、最大轮次和权限模式。
- `fork` 继承父 Agent 最近一次实际 Provider 请求的 System Prompt、合法消息前缀、工具顺序、模式和权限模式，始终在后台执行。Fork 适合并行分析已有上下文。

子 Agent 配置放在 `config.yaml` 顶层。模型档位映射到已有 Provider 名称；字段均可省略：

```yaml
agent_models:
  haiku: fast-model
  sonnet: default-model
  opus: strong-model

subagents:
  foreground_timeout_ms: 120000
  fork_max_iterations: 10
  retained_tasks: 100
  denied_tools: [custom_dangerous_tool]
```

角色按项目、用户、内置、插件贡献的优先级覆盖：

```text
<project>/.bettercode/agents
~/.bettercode/agents
<bettercode>/agents
<plugin>/agents
```

目录支持 `reviewer.md` 或 `reviewer/AGENT.md`。高优先级定义损坏时会禁用同名角色并显示诊断，不会回退到低优先级版本，也不会阻止其他合法角色启动。

```markdown
---
name: reviewer
description: 审查代码并报告可验证问题
tools: [read_file, find_files, search_code]
disallowed_tools: []
background_tools: [read_file, find_files, search_code]
model: inherit
max_iterations: 10
permission_mode: default
---

先读取相关实现与测试，再按严重程度输出问题和证据。
```

前台任务有三种进入后台的方式：调用时设置 `background: true`、运行超过默认 120 秒自动转后台、在 TUI 中按 `Ctrl+B` 手动转后台。转后台不会重启或取消任务，但之后尚未执行的工具会按 `background_tools` 重新收窄。使用 `/tasks` 查看列表，使用 `/tasks <任务 ID>` 查看状态、停止原因、迭代和 Token/cache 用量。

后台完成只通知界面，不会主动发起新的模型请求。结果会在主 Agent 下一次自然 Provider 请求时以 `subagent_result` 指令注入一次，随后进入主历史并写入会话存档。恢复会话时，压缩边界之后的结果会继续作为内部指令恢复，不会伪装成用户或模型消息。

安全与生命周期边界：

- 子 Agent 使用独立消息、上下文管理器、权限状态、文件读取缓存、Token 统计和取消信号，但共享 Provider、Hook、MCP 连接和项目文件系统。
- 子 Agent 非交互运行，不弹权限确认；未明确放行的 default/strict 工具会返回拒绝，模型可调整方案继续。
- `agent` 和 `load_skill` 在所有子 Agent 中永久禁用，防止直接或间接递归委派；独立 Skill 同样看不到 `agent`。
- 后台任务只存在于当前 BetterCode 进程，不跨重启恢复。`/clear`、恢复其他会话和退出会取消旧任务并丢弃未消费结果。
- 本功能不创建 Worktree，不隔离文件系统。多个子 Agent 并发修改同一文件时不会自动合并，调用方应通过角色工具和任务拆分避免写入冲突。

## Hook 系统

Hook 用声明式 YAML 在固定生命周期事件上执行自动化动作。三个配置文件按用户、项目共享、项目本地顺序追加加载；任一存在的文件无效时 BetterCode 会拒绝启动，避免安全规则被静默跳过。

```text
~/.bettercode/hooks.yaml
<project>/.bettercode/hooks.yaml
<project>/.bettercode/hooks.local.yaml
```

基础格式：

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
          value: '(^|\s)git\s+push($|\s)'
    action:
      type: command
      command: node .bettercode/hooks/check-push.mjs
    timeout_ms: 5000
```

支持十个事件：

| 层级 | 事件 |
|---|---|
| 系统 | `system_start`、`system_stop` |
| 会话 | `session_start`、`session_end` |
| 用户任务 | `turn_start`、`turn_end` |
| 消息 | `user_message`、`assistant_message` |
| 工具 | `pre_tool_use`、`post_tool_use` |

一次 turn 是一条用户输入到 Agent 停止的完整过程，不随内部模型迭代重复。条件使用 `all` 或 `any` 组合，原子匹配支持 `exact`、`glob`、`regex` 和 `negate: true`；工具事件可读取 `tool.name`、`tool.arguments.<字段>`，执行后还可读取 `tool.result`。

四种动作：

- `command`：在项目根通过系统 Shell 执行，完整事件 JSON 从 stdin 传入。
- `prompt`：把 `{{field.path}}` 模板渲染为下一次模型请求的 runtime instruction，只消费一次，不进入稳定 System Prompt 或真实历史。
- `http`：向 HTTP/HTTPS 地址发送事件 JSON，支持 method、headers、body、事件模板和 `${VAR}` 环境变量。
- `agent`：启动真实定义式子 Agent；可用 `role` 选择角色，缺省使用 `general`，并可通过规则级 `background: true` 进入统一后台任务系统。

`pre_tool_use` 命令 stdout 或 HTTP 2xx 响应可返回统一决定：

```json
{ "decision": "allow" }
```

```json
{ "decision": "deny", "reason": "禁止直接推送受保护分支" }
```

只有合法的明确 `deny` 会阻止工具，并把原因作为 `HOOK_DENIED` 工具结果交给模型。`allow` 只表示当前 Hook 不拒绝，工具仍需通过 Plan Mode、危险命令黑名单、路径沙箱、权限规则和人工确认。Hook 超时、网络错误、非零退出或非法决定只写日志，不中断 Agent 主流程。

- `once: true` 表示当前 BetterCode 进程内成功执行一次；失败后可以重试，重启后重置。
- `background: true` 表示后台执行，Agent 不等待结果。
- `pre_tool_use` 禁止 `once`、后台执行和 agent 动作；prompt 动作也禁止后台执行。
- 子 Agent scoped Hook 可读取 `agent.id`、`agent.kind` 和 `agent.role`；子 Agent 内再次命中 agent 动作会记录 `NESTED_AGENT_FORBIDDEN`，不会递归运行。
- 命令和 HTTP 默认超时 30 秒，可通过 `timeout_ms` 设置为 1 毫秒到 5 分钟。
- 修改 Hook YAML 后需要重启 BetterCode，本章不支持热更新。
- 运行期失败日志写入 `.bettercode/logs/hooks.jsonl`，本地配置和日志默认不提交。

Hook 命令与 HTTP 是用户主动安装的本地自动化代码，不经过 Agent 工具权限系统，并继承 BetterCode 进程可见的环境和操作系统权限。只应加载可信 Hook 配置；本章不提供操作系统沙箱、网络白名单或日志轮转。

## cc-switch 适配

BetterCode 启动时读取 cc-switch 桌面版维护的 `~/.cc-switch/cc-switch.db`（仅 Claude Code 线），把所有 Claude 供应商导入为可用 Provider，当前激活项标为默认；当前激活供应商的档位映射（Sonnet/Opus/Haiku/Fable，含 `[1M]` 上下文标记）也会一并导入。`/model` 在 cc-switch Provider 上显示档位模型与上下文并允许会话内切换，在其他 Provider 上显示供应商列表。数据库或 Node 内置 SQLite 不可用时，回退读取 `~/.claude/settings.json` 的当前激活 `env` 块（`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`）。`ANTHROPIC_AUTH_TOKEN` 存在时走 Bearer 认证，否则走 `x-api-key`，`base_url` 已含 `/v1` 时会自动归一化。

在 `config.yaml` 启用：

```yaml
cc_switch:
  enabled: true
  claude:
    # name 只在数据库不可用的回退路径生效，正常时展示 cc-switch 原名
    name: cc-switch.claude
    model: claude-sonnet-5-20251001
    thinking: false
    context_window: 200000
```

供应商选择优先级：`--provider` 命令行 > cc-switch 当前激活的默认供应商 > `config.yaml` 原 `default: true` > 交互选择。只读取 Claude Code 线，不读取 Codex、Gemini 等其他 cc-switch 来源，也不写回 cc-switch 文件。文件缺失、解析失败或 key/model 缺失时启动不崩溃，会在界面显示诊断并回退到原配置；诊断不会包含 API key。cc-switch 中新增或删除供应商后需要重启 BetterCode 生效，已导入的供应商可随时用 `/model` 切换。

## 记忆系统

- 启动时按层级加载 `BETTERCODE.md`、`AGENTS.md`、`.bettercode/INSTRUCTIONS.md` 和 `BETTERCODE.local.md`，并通过运行期指令消息注入，不改变可缓存的系统提示与工具定义。
- 项目指令支持单行 `@./path`、`@../path`、`@~/path` 和 `@/absolute/path` 引用；代码块内引用、循环引用和超过五层的引用会安全跳过。
- 会话实时追加到 `.bettercode/sessions/<id>.jsonl`；使用 `/session` 查看最近会话，使用 `/session <id>` 恢复并继续写入原存档。
- Agent 自然完成后在后台提取长期记忆。项目知识写入 `.bettercode/memory/`，用户偏好写入 `~/.bettercode/memory/`，项目索引位于 `.bettercode/memory/MEMORY.md`。
- 记忆库由后台治理器（`MemoryGovernor`）定期整理：距上次整理超 24 小时、会话存档 ≥5 个且拿到治理锁后，一次 LLM 调用按「定位 → 收集信号 → 整理 → 修剪索引」四阶段识别去重合并、错误删除、矛盾解决与过期整理；被删/覆盖的原文会先归档到 `.bettercode/memory/.archive/`，索引超出 200 行 / 25KB 时会给出截断提示。
- 使用 `/memory` 查看两级记忆数量、目录与治理状态（上次整理时间、整理次数、索引是否截断）；使用 `/rewind` 将 Agent 修改的文件、对话或两者一起恢复到检查点。
- 输入记录保存在 `.bettercode/prompt_history.jsonl`，输入框可用上下方向键回看最近 200 条记录。

## 上下文管理

- 每次模型请求前估算完整上下文；接近窗口上限时自动摘要较早历史。
- 单个大型工具结果会保存到项目内 `.bettercode/context/`，对话中保留预览和相对路径。
- 用户原始消息保持原文，摘要只替换较早的模型回复、工具交互和内部指令。
- 使用 `/compact` 可手动压缩较早历史；使用 `/clear` 会同时清理本会话上下文文件和状态。
- 摘要连续失败三次后自动熔断，可通过 `/compact` 手动重试，或使用 `/clear` 重置。

Provider 可显式配置模型窗口：

```yaml
providers:
  - name: deepseek
    protocol: openai
    model: deepseek-chat
    context_window: 128000
    base_url: https://api.deepseek.com
    api_key: ${DEEPSEEK_API_KEY}
```

缺少 `context_window` 时 BetterCode 使用 128K 兼容默认值，并在启动界面提示一次。窗口值必须是正整数。
