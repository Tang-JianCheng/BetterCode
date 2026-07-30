# BetterCode

BetterCode 是一个用于学习和交流的终端代码 Agent。它支持流式对话、内置工具、Agent Loop、Plan Mode、权限控制、MCP 工具发现、Skill、长会话上下文管理和跨会话记忆。

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
