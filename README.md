# BetterCode

BetterCode 是一个用于学习和交流的终端代码 Agent。它支持流式对话、内置工具、Agent Loop、Plan Mode、权限控制、MCP 工具发现、长会话上下文管理和跨会话记忆。

## 记忆系统

- 启动时按层级加载 `BETTERCODE.md`、`AGENTS.md`、`.bettercode/INSTRUCTIONS.md` 和 `BETTERCODE.local.md`，并通过运行期指令消息注入，不改变可缓存的系统提示与工具定义。
- 项目指令支持单行 `@./path`、`@../path`、`@~/path` 和 `@/absolute/path` 引用；代码块内引用、循环引用和超过五层的引用会安全跳过。
- 会话实时追加到 `.bettercode/sessions/<id>.jsonl`；使用 `/resume` 查看最近会话，使用 `/resume <id>` 恢复并继续写入原存档。
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
