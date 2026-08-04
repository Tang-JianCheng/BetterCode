# /context 命令 Spec

## 背景

BetterCode 目前只能通过 `/status` 看到累计 Token 用量，用户无法直观了解当前会话在模型上下文窗口里的占用情况。Claude Code 的 `/context` 用格子、模型名、总占用和分类明细展示上下文使用，BetterCode 需要同类的实时视图。

## 目标

- F1：注册 `/context` 本地命令，无参数，别名 `/ctx`。
- F2：数据全部来自当前运行时：Provider、模型、上下文窗口、会话历史、可见工具、MCP 工具、Skill 注入与系统提示。
- F3：格子数量随上下文窗口动态变化，1M 上下文的格子明显多于 128K；占用格子按 `used / context_window` 计算。
- F4：展示总占用、剩余空间，以及 System prompt / System tools / MCP tools / Skills / Messages 五类明细与占比。
- F5：MCP 工具非空时展示每个 MCP 工具的估算 Token（最多 10 个），名称来自实际注册的工具。
- F6：命令是纯本地展示，不调用模型、不执行工具、不修改会话状态。

## 增量：分类明细挂载到对应分类下方

- F7：MCP 工具明细不再单独成块，而是直接挂在 `MCP tools` 分类行下方，缩进展示为 `工具名: 估算 Token`（最多 10 个）。
- F8：System tools 与 Skills 同样展示逐项明细并挂在自己的分类行下方；Skills 明细按已激活 Skill 逐项估算。
- F9：Messages 分类行展示消息条数（`· N 条消息`），不逐条展示避免面板过长。
- F10：明细与分类行保持同一文本块，渲染顺序稳定，不再出现单独的 `MCP tools 明细` 标题。

## 增量：树形展开与弱化 Token 数值

- F11：分类明细改用树形展开样式，分支行以 `├ ` 前缀并缩进 5 格挂在分类行下方，Unicode 模式用 `├`、ASCII 模式用 `|-`。
- F12：每条明细的 `xx tokens` 数值使用弱化标记（`~~...~~`），终端彩色模式下渲染为淡色；非彩色模式保留 Markdown 删除线标记。
- F13：明细仍最多展示前 10 项，长内容换行时继续保持在分支行缩进内。

## 非功能需求

- N1：估算复用现有 `TokenEstimator`，不做网络请求。
- N2：API key 等敏感值不进入展示内容。
- N3：终端不支持 Unicode 时格子与标记回退为 ASCII。
- N4：格子数量有上下限，窄终端不出现超宽单行。
- N5：Worker 与普通模式都可用，展示当前 Provider 的上下文窗口。

## 不做的事

- 不做精确 tokenizer，仍使用现有字符近似估算。
- 不做按 API usage 的逐请求分类回填。
- 不做上下文实时刷新，每次输入 `/context` 重新计算。

## 验收标准

- AC1：`/context` 出现在 `/help` 命令目录，执行后展示模型、上下文窗口、格子和分类。
- AC2：`contextWindow=1_000_000` 时格子数大于 `128_000` 时的格子数。
- AC3：五类 Token 之和等于总占用，剩余空间等于 `context_window - usedTokens`。
- AC4：注册 MCP 工具后，MCP tools 分类与工具明细随之出现。
- AC5：展示内容中不出现任何 API key。
- AC6：MCP / System tools / Skills 明细分别出现在对应分类行下方，且不再出现 `MCP tools 明细` 独立标题。
- AC7：Messages 分类行带消息条数，多类明细并存时顺序为 System tools → MCP tools → Skills → Messages。
- AC8：明细以 `├` 树形缩进展示，`xx tokens` 数值在彩色终端下呈淡色。
