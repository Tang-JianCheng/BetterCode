# BetterCode

BetterCode 是一个用于学习和交流的终端代码 Agent。它支持流式对话、内置工具、Agent Loop、Plan Mode、权限控制、MCP 工具发现、Skill、生命周期 Hook、长会话上下文管理和跨会话记忆。

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
| `/memory` | 查看用户级和项目级记忆状态 |
| `/permission [模式]` | 查看或切换权限模式 |
| `/tasks [任务 ID]` | 查看当前会话的子 Agent 任务或单项详情 |
| `/status` | 查看 Provider、模式、Token、会话和记忆状态 |
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

## 记忆系统

- 启动时按层级加载 `BETTERCODE.md`、`AGENTS.md`、`.bettercode/INSTRUCTIONS.md` 和 `BETTERCODE.local.md`，并通过运行期指令消息注入，不改变可缓存的系统提示与工具定义。
- 项目指令支持单行 `@./path`、`@../path`、`@~/path` 和 `@/absolute/path` 引用；代码块内引用、循环引用和超过五层的引用会安全跳过。
- 会话实时追加到 `.bettercode/sessions/<id>.jsonl`；使用 `/session` 查看最近会话，使用 `/session <id>` 恢复并继续写入原存档。
- Agent 自然完成后在后台提取长期记忆。项目知识写入 `.bettercode/memory/`，用户偏好写入 `~/.bettercode/memory/`，项目索引位于 `.bettercode/memory/MEMORY.md`。
- 使用 `/memory` 查看两级记忆数量和目录；使用 `/rewind` 将 Agent 修改的文件、对话或两者一起恢复到检查点。
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
