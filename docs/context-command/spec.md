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

## 增量：分类占用网格与分类着色

- F14：顶部改为 Claude 风格占用网格：第一行是占用格子 + 模型名（含 `[1M]` 等上下文窗口后缀），第二行是空格子 + `总占用 / 窗口 tokens (占比)`，下方再补一行空格子，然后进入 `*Estimated usage by category*`。
- F15：每格代表约 5k Token（`contextWindow / 5_000` 取整），格子数量同时受终端列宽限制自适应，1M 窗口明显多于 128K，窄终端不撑爆单行。
- F16：分类区每行同样带格子前缀，System prompt / System tools / MCP tools / Skills / Messages 使用占用图标 `⛁`，Free space 使用空闲图标 `⛶`（ASCII 模式回退 `#` / `.`）。
- F17：分类行按类型着色：System prompt 信息蓝、System tools 成功绿、MCP tools 警示黄、Skills 品牌橙、Messages 危险红、Free space 弱化灰，模型与总占用行用正文白。
- F18：方格区只保留分类汇总行，不再夹带树状明细。
- F22：占用格子按右侧图例分类着色：占用格按五类 Token 占比分配图例颜色（System prompt `info`、System tools `success`、MCP tools `warning`、Skills `brand`、Messages `danger`），相邻同色格子合并成段；空格子与格子间分隔统一用弱化灰 `muted`。

## 增量：明细区独立列在方格下方

- F19：System tools / MCP tools / Skills 的逐项明细从方格区移出，统一在方格下方按分类重新列出；每个分类先输出粗体标题（如 `**MCP tools**`），再输出 `├` 树状明细。
- F20：明细标题使用与分类一致的颜色，明细行颜色与所属分类一致，`xx tokens` 数值继续用 `~~...~~` 弱化淡色。
- F21：没有明细的分类不出现独立小节，明细仍最多展示前 10 项，长内容换行保持在分支行缩进内。

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
- AC9：顶部两行分别为占用格子 + 模型名、空格子 + 总占用与占比，网格行数量随窗口与列宽自适应。
- AC10：各分类行带格子前缀并按类型着色，树形明细行颜色与所属分类一致。
- AC11：方格区没有任何 `├` 分支行，明细区在 Free space 行之后按分类独立列出。
- AC12：明细小节先显示粗体标题（如 `**MCP tools**`）再显示 `├` 明细，`xx tokens` 数值保持淡色。
- AC13：占用格子颜色与右侧图例分类一致，空格子与格子间分隔统一弱化灰，占用与空闲可区分。
