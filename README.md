# BetterCode

BetterCode 是一个用于学习和交流的终端代码 Agent。它支持流式对话、内置工具、Agent Loop、Plan Mode、权限控制、MCP 工具发现和长会话上下文管理。

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
