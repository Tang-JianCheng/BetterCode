# /model 命令 Checklist

- [x] `/model` 出现在 `/help` 命令目录，无参数也能直接打开面板
- [x] 面板列出全部 Provider：左侧名称、右侧模型与 base_url
- [x] 方向键上下选择，Enter 切换，Esc 退出
- [x] 当前 Provider 带 `[当前]` 标记，选中整行高亮，超一页可滚动
- [x] 切换后 `/status` 显示新 Provider 与模型
- [x] 切换后下一次对话使用新 Provider（通过测试断言）
- [x] 只有一个 Provider 时提示而不是打开面板
- [x] 切换失败显示结构化诊断，不崩溃
- [x] 面板与通知不出现 API key
- [x] cc-switch Provider 带档位映射时展示 Sonnet/Opus/Fable/Haiku 与上下文窗口（含 `[1M]`）
- [x] 档位行右侧为 `模型 · 上下文`，当前档位带 `[当前]` 标记
- [x] 档位切换后 `/status` 与后续请求使用新档位模型
- [x] 当前 Provider 未配置档位时保持原 Provider 列表模式
- [x] 未配置的档位切换失败显示结构化错误，不崩溃
- [x] `AGENTS.md` 已写入动态命令约束
- [x] `pnpm typecheck`、`pnpm test`、`git diff --check` 通过
