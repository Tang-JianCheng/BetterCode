# cc-switch 适配 Spec

## 背景

BetterCode 当前通过 `config.yaml` 的 `providers` 列表决定 LLM 供应商，切换供应商需要手动改配置或每次用 `--provider` 指定。用户使用 cc-switch 桌面版统一管理 Claude Code 等工具的供应商，希望在 cc-switch 里切换 Claude 供应商后，BetterCode 启动时自动跟随当前激活的配置。

cc-switch 桌面版（farion1231/cc-switch）把全部 Claude 供应商保存在 `~/.cc-switch/cc-switch.db`，切换供应商时改写 `~/.claude/settings.json` 的 `env` 块：

- `ANTHROPIC_API_KEY`：API key 认证。
- `ANTHROPIC_AUTH_TOKEN`：可选，Bearer 认证。
- `ANTHROPIC_BASE_URL`：可选，自定义端点。
- `ANTHROPIC_MODEL`：可选，部分版本写入。

## 目标

- F1：BetterCode 启动时读取 cc-switch 桌面版管理的 Claude Code 供应商配置，转换为 BetterCode 的 Provider，当前激活项自动成为默认供应商。
- F2：来源为 `~/.cc-switch/cc-switch.db` 的 Claude Code 线，数据库或 Node 内置 SQLite 不可用时回退 `~/.claude/settings.json` 的 `env` 块；不读取 Codex 等其他 cc-switch 来源。
- F3：`config.yaml` 增加可选 `cc_switch` 配置块，可开关整条链路，并为 Claude 线提供名称、模型、thinking、context_window 覆盖。
- F4：供应商选择优先级为 `--provider` 命令行 > cc-switch 导入的默认供应商 > config.yaml 原 `default: true` > 交互选择。
- F5：文件缺失、解析失败、API key 或模型缺失等都以结构化诊断呈现，不阻断启动，回退到原配置的供应商选择逻辑。
- F6：Anthropic 协议支持 `ANTHROPIC_AUTH_TOKEN`（Bearer）与 `ANTHROPIC_API_KEY`（x-api-key）两种认证，并对 `base_url` 是否已含 `/v1` 做归一化。
- F7：只读适配：只读 cc-switch 数据库，不写回 cc-switch 文件，不影响 Claude Code 自身配置。
- F8：全部 Claude 供应商导入后进入 `/model` 面板，可在会话内直接切换；切换只影响本次进程。

## 非功能需求

- N1：启动阶段不发起任何网络请求，只读本地文件与环境变量。
- N2：API key 等敏感值不进入诊断、日志或启动提示，展示时统一脱敏。
- N3：用户目录与环境变量可注入，便于单元测试与多机复现。
- N4：不新增第三方解析依赖，`settings.json` 使用标准 JSON 解析，`cc-switch.db` 使用 Node 内置 SQLite；解析失败按诊断降级。
- N5：`cc_switch` 未配置或关闭时，BetterCode 行为与现状完全一致。

## 不做的事

- 不做 cc-switch 切换后的热生效：cc-switch 切换后需要重启 BetterCode。
- 不读取 Codex、Gemini CLI、Claude Desktop、OpenCode、OpenClaw、Hermes 等其他 cc-switch 来源。
- 不做写回、同步 cc-switch 的 MCP / Skills / Prompts。
- 不引入 cc-switch 进程内通信或系统托盘集成。

## 验收标准

- AC1：配置 `cc_switch.enabled: true` 且 cc-switch 数据库存在时，启动导入全部 Claude 供应商并使用当前激活项，`/status` 显示导入的 base_url 与模型。
- AC2：`ANTHROPIC_API_KEY` 与 `ANTHROPIC_AUTH_TOKEN` 都能生成可用 Provider；`ANTHROPIC_MODEL` 存在时优先作为模型，否则使用 `cc_switch.claude.model`，两者都没有则诊断并跳过导入。
- AC3：`--provider <导入的 cc-switch 供应商名>` 能显式选择；数据库回退路径仍支持 `cc-switch.claude`；cc-switch 关闭或不可用时回退到 config.yaml 原逻辑。
- AC4：任一来源文件缺失或 key 缺失时启动不崩溃，诊断可见，并按原逻辑回退选择供应商。
- AC5：Anthropic `base_url` 以 `/v1` 结尾时不会拼成 `/v1/v1/messages`；Bearer 认证发送 `Authorization: Bearer`。
- AC6：诊断文本中不出现任何 API key 明文。
- AC7：数据库导入多个同名供应商时名称自动去重；`/model` 面板可见全部供应商，当前激活项带 `[当前]` 标记。
