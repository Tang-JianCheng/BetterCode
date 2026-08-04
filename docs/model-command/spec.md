# /model 命令 Spec

## 背景

BetterCode 的 Provider 目前只在启动时确定，运行中想换模型只能退出重启或改 `config.yaml`。`/session` 已经验证了动态交互选择器的体验，`/model` 复用同一套交互模式，让用户在会话内直接切换模型。

面板来源为启动时合并完成的 `appConfig.providers`，包含 `config.yaml` 配置与 cc-switch 数据库导入的全部 Claude 供应商，因此 `/model` 会跟随 cc-switch 的供应商列表。

## 目标

- F1：输入 `/model` 打开动态选择面板，列出所有可用 Provider（名称、模型、base_url）。
- F2：方向键上下选择，Enter 切换，Esc 退出，体验与 `/session` 一致。
- F3：切换后当前会话的后续请求使用新 Provider，`/status` 显示新 Provider 与模型，无需重启。
- F4：只有一个 Provider 时不打开面板，给出明确提示。
- F5：面板样式遵循动态命令规范：左侧名称、右侧模型说明、当前项带 `[当前]` 标记、选中整行高亮、超一页可滚动。
- F6：切换是本次进程的内存态，不影响 `config.yaml` 与 cc-switch 下次启动的默认选择。
- F7：当前 Provider 来自 cc-switch 且带档位映射（Sonnet/Opus/Fable/Haiku）时，面板改为展示档位模型与上下文窗口（如 `[1M]`），切换档位后后续请求使用对应模型，无需重启。

## 非功能需求

- N1：切换失败（如找不到 Provider）显示结构化诊断，不崩溃。
- N2：API key 不进入面板、日志与通知文本。
- N3：Worker 模式不开放 `/model`，团队成员的 Provider 保持由定义决定。

## 不做的事

- 不做 Provider 热插拔（新增/删除 Provider 仍需改配置重启）。
- 普通 Provider 不做模型级拆分；cc-switch 供应商自带档位映射时按档位切换，未配置档位时仍按供应商列表切换。
- 不做持久化最近选择。

## 增量：cc-switch 档位模型切换

cc-switch 的 Claude 供应商 env 里可声明 `ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL`、`ANTHROPIC_DEFAULT_HAIKU_MODEL`、`ANTHROPIC_DEFAULT_FABLE_MODEL`（以及对应的 `_NAME`），值可带 `[1M]` 上下文标记。数据库导入时把这些档位解析进 Provider，`/model` 对这类 Provider 展示档位面板而不是供应商列表。

- 档位行左侧显示档位名，右侧显示 `模型 · 上下文`，当前档位带 `[当前]` 标记。
- 切换档位使用 `switchModelTier(tier)`，基于档位模型与上下文窗口重建 Provider，仅影响本次进程。
- 当前供应商没有档位映射时，`/model` 行为保持原 Provider 列表模式不变。
