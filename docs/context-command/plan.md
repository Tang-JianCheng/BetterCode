# /context 命令 Plan

## 架构概览

`/context` 是一条纯本地命令，数据链路与 Agent 请求共用同一套估算逻辑：

```
用户输入 /context
  → CommandDispatcher → CommandUIController.showContextUsage()
  → App.showContextUsage()
  → ChatManager.getContextUsage(provider, mode)
  → AgentLoop.estimateContextUsage(provider, history, mode)
  → ContextManager.estimateUsageBreakdown(...)
  → buildContextUsagePresentation(snapshot, capabilities)
  → 渲染为命令文档
```

## 核心数据结构

```ts
interface ContextUsageBreakdown {
  systemPromptTokens: number;
  systemToolsTokens: number;
  mcpToolsTokens: number;
  skillsTokens: number;
  messagesTokens: number;
  systemToolCount: number;
  mcpToolCount: number;
  systemToolEntries: ReadonlyArray<{ name: string; tokens: number }>;
  mcpToolEntries: ReadonlyArray<{ name: string; tokens: number }>;
  skillEntries: ReadonlyArray<{ name: string; tokens: number }>;
  messageCount: number;
  usedTokens: number;
}

interface ContextUsageSnapshot extends ContextUsageBreakdown {
  providerName: string;
  model: string;
  contextWindow: number;
}
```

## 模块设计

### context/types.ts 与 context/manager.ts

- 新增 `ContextUsageBreakdownInput` 与 `ContextUsageSnapshot` 类型。
- `ContextManager.estimateUsageBreakdown(input)` 使用私有 `TokenEstimator` 估算五类 Token：
  - system prompt：`estimateText(systemPrompt) + 4`
  - 工具：`estimateText(stableStringifyJson(tools)) + tools.length * 8`，按系统工具 / MCP 工具分组
  - skills：完整 reminder 与去掉 Skill 段的 base reminder 的 Token 差
  - messages：历史消息 + base reminder + 固定开销
- 返回 `usedTokens = 五类之和`。
- 增量：`estimateUsageBreakdown` 额外输出 `systemToolEntries`、`skillEntries` 与 `messageCount`；每个工具条目按单个工具定义估算，Skill 条目按 Skill 正文估算。

### agent/loop.ts

- 新增 `estimateContextUsage(provider, history, mode)`：
  - 按当前模式计算可见工具集合，与真实请求一致
  - 用 `isMcpToolName` 区分 MCP 工具与系统工具
  - 用 `currentSupplemental()` 与 `buildSystemReminder` 生成完整 / base reminder
  - 调用 ContextManager 估算后拼装 `ContextUsageSnapshot`

### chat/manager.ts

- 新增 `getContextUsage(provider, mode)`，转发给 `AgentLoop.estimateContextUsage`。

### command/types.ts、command/builtins.ts

- `CommandUIController` 增加 `showContextUsage()`。
- 注册 `/context`（别名 `/ctx`），类型 `local`，无参数。

### command/presenters.ts 与 ui/app.tsx

- 新增 `buildContextUsagePresentation(snapshot, options?)`：
  - 格子数量 = `min(round(contextWindow / 5_000), 按终端列宽计算的上限)`，其中上限为 `max(12, floor((columns - 48) / 2))`，默认 60
  - 占用格子 = `round(used / contextWindow * 格子数)`
  - Unicode 模式用 `⛁` / `⛶`，ASCII 模式用 `#` / `.`
  - 展示模型（含 `[1M]` 等上下文后缀）、总占用、剩余空间和五类明细
  - System tools / MCP tools / Skills 的逐项明细直接缩进挂在自己的分类行下方（各最多 10 项），Messages 行附带消息条数
- `App` 增加 `showContextUsage` 回调并接入 `CommandUIController`，把终端列宽通过 `capabilities.columns` 传入。

## 增量：嵌套明细渲染

- 数据源：`AgentLoop.estimateContextUsage` 把 `currentSupplemental().activeSkills`（`name` + `content`）传给 `estimateUsageBreakdown`，系统工具与 MCP 工具沿用可见工具集合。
- 渲染：`buildContextUsagePresentation` 把分类行与明细放在同一个文本块，明细缩进挂在对应分类行下方；旧的独立 `MCP tools 明细` 标题与 list block 删除。
- 截断：每个分类明细最多展示前 10 项，超出部分不展示，避免长工具列表撑爆面板。

## 增量：树形块渲染

- 新增展示块类型 `tree`：每行带 `content`、`indent`、`branch`，`branch` 行渲染 `├ `（ASCII 模式 `|- `）前缀。
- `presentationBlocksToMarkdown` 把 `tree` 块转为 Markdown AST 的 `tree` 块，逐行解析行内 Markdown，支持 `~~...~~` 弱化标记。
- `renderMarkdown` 新增 `renderTree`：分支行按 `indent` 设置行缩进，换行续行保持分支缩进；`├` 前缀与 `~~...~~` 内容都使用 `muted` 样式。
- `/context` 的分类明细改为单个 `tree` 块：分类行 `indent=0`，明细行 `indent=5`、`branch=true`，token 数值包在 `~~...~~` 内。
- `presentationToPlainText` 支持 `tree` 块，按缩进输出 `├` 并去掉 `~~` 标记。

## 增量：分类占用网格与分类着色

- 新增 `MarkdownColor` 联合类型（`accent/brand/danger/info/muted/success/text/warning`），`MarkdownTreeLine` 与 `MarkdownSegment` 增加 `color` 字段，`MarkdownTreeLine` 另增 `prefix` 字段；`presentation/types.ts` 的 `PresentationTreeLine` 同步支持。
- `presentationBlocksToMarkdown` 转换 `tree` 块时透传 `prefix` 与 `color`；`renderMarkdown.renderTree` 先渲染 `prefix` 段再渲染 `├` 分支段，前缀宽度计入换行缩进，行级 `color` 只应用到 content 中的 `normal` 段，空 content 行也保留前缀（用于空格子行）。
- `MarkdownView` 新增 `COLOR_MAP` 把 `MarkdownColor` 映射到主题色，`segmentColor` 优先使用行级颜色，`muted` 颜色同时触发 `dimColor`。
- `contextGridCells(contextWindow, columns)`：目标格数 = `max(12, round(contextWindow / 5_000))`，再与按列宽计算的 `fit` 取小，保证 1M 窗口在 120 列终端约 36 格、100 列约 26 格、80 列约 16 格，不会撑爆单行。
- `contextGridPrefix` 生成空格分隔的 `⛁/⛶` 格子串并后接 3 个空格；`/context` 整体改为单个 `tree` 块：模型行、总用量行、空格子空行、`*Estimated usage by category*`、六个分类行都带格子前缀。
- 分类行颜色：System prompt `info`、System tools `success`、MCP tools `warning`、Skills `brand`、Messages `danger`、Free space `muted`；明细行使用与所属分类相同的颜色，`~~xx tokens~~` 弱化保持。

## 文件组织

```
src/context/types.ts          — ContextUsageSnapshot 类型
src/context/manager.ts        — estimateUsageBreakdown
src/agent/loop.ts             — estimateContextUsage
src/chat/manager.ts           — getContextUsage
src/command/types.ts          — showContextUsage
src/command/builtins.ts       — /context 注册
src/command/presenters.ts     — 展示构建
src/ui/app.tsx                — 命令接入
docs/context-command/*.md     — 本套文档
README.md                     — 命令表
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 估算位置 | ContextManager 私有 TokenEstimator | 与上下文管理使用同一近似口径 |
| Skills 分类 | full reminder 与 base reminder 的 Token 差 | 不重复计算环境/模式等公共段 |
| MCP 识别 | `isMcpToolName` 名称规则 | MCP 工具命名带 `mcp_..._hash`，无需维护 owner |
| 格子数量 | `contextWindow / 5_000` 后取整，并受终端列宽限制 | 与 Claude 的 5k/格口径一致，避免 1M 目标 200 格撑爆单行 |
| 渲染 | 复用命令文档 + text/list block | 保持现有 Markdown 渲染链路 |
| 分类着色 | `tree` 行级 `color` + `MarkdownColor` 映射 | 不同分类用不同颜色，同时兼容无颜色/ASCII 模式 |
