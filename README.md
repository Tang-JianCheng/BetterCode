# BetterCode

BetterCode 是一个用于学习和交流的终端代码 Agent。它支持流式对话、内置工具、Agent Loop、Plan Mode、权限控制、MCP 工具发现、长会话上下文管理和跨会话记忆。

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
| `/review [范围]` | 发送预设代码审查任务给 Agent |

旧命令 `/resume`、`/r` 和 `/permissions` 继续作为别名可用；`/rewind`、`/exit`、`/quit` 保持兼容。

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
