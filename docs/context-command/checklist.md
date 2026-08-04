# /context 命令 Checklist

- [x] `/context` 出现在 `/help` 命令目录，别名 `/ctx` 可用
- [x] 展示当前 Provider、模型、上下文窗口与总占用
- [x] 格子数量随上下文窗口动态变化，1M 多于 128K
- [x] 占用格子数按 `used / context_window` 计算
- [x] 五类明细之和等于总占用，剩余空间等于窗口减占用
- [x] System prompt / System tools / MCP tools / Skills / Messages 均有真实来源
- [x] MCP 工具非空时展示前 10 个工具明细
- [x] Unicode 不可用时回退 ASCII 格子
- [x] 展示内容不包含 API key
- [x] `pnpm typecheck`、`pnpm test`、`git diff --check` 通过
