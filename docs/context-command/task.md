# /context 命令 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/context/types.ts` | `ContextUsageSnapshot` 与输入类型 |
| 修改 | `src/context/manager.ts` | `estimateUsageBreakdown` |
| 修改 | `src/agent/loop.ts` | `estimateContextUsage` |
| 修改 | `src/chat/manager.ts` | `getContextUsage` |
| 修改 | `src/command/types.ts` | `showContextUsage` |
| 修改 | `src/command/builtins.ts` | 注册 `/context` |
| 修改 | `src/command/presenters.ts` | 上下文使用展示 |
| 修改 | `src/ui/app.tsx` | 接入命令 |
| 修改 | `src/command/builtins.test.ts`、`dispatcher.test.ts` | 控制器桩补字段 |
| 修改 | `src/command/presenters.test.ts` | 展示渲染测试 |
| 修改 | `src/context/manager.test.ts` | 估算分类测试 |
| 修改 | `src/agent/loop.test.ts` | AgentLoop 估算测试 |
| 修改 | `src/chat/manager.test.ts` | ChatManager 转发测试 |
| 修改 | `README.md` | 命令表 |
| 新建 | `docs/context-command/*.md` | 本套文档 |

## 状态

- [x] T1: 估算层完成，`estimateUsageBreakdown` 输出五类 Token。
- [x] T2: AgentLoop 完成，`estimateContextUsage` 生成完整快照。
- [x] T3: ChatManager 完成，`getContextUsage` 转发历史与模式。
- [x] T4: 命令与 UI 完成，`/context` 打开展示面板。
- [x] T5: 测试、README 与文档完成。
- [x] T6: 增量完成分类明细嵌套展示。
- [x] T7: 增量完成树形展开与 token 数值弱化。

## T1: 上下文估算

**文件：** `src/context/types.ts`、`src/context/manager.ts`

1. 定义 `ContextUsageBreakdownInput`、`ContextUsageBreakdown`、`ContextUsageSnapshot`。
2. `estimateUsageBreakdown` 估算 system prompt / system tools / mcp tools / skills / messages。
3. 返回 `usedTokens` 为五类之和。

**验证：** `pnpm test src/context/manager.test.ts`。

## T2: AgentLoop 快照

**文件：** `src/agent/loop.ts`

1. `estimateContextUsage(provider, history, mode)` 计算可见工具集合。
2. 按 `isMcpToolName` 拆分 MCP 与系统工具。
3. 用完整 / base reminder 计算 skills 段，组装快照。

**验证：** `pnpm test src/agent/loop.test.ts`。

## T3: ChatManager 转发

**文件：** `src/chat/manager.ts`

1. 新增 `getContextUsage(provider, mode)`，转发当前 `history`。

**验证：** `pnpm test src/chat/manager.test.ts`。

## T4: 命令与展示

**文件：** `src/command/types.ts`、`src/command/builtins.ts`、`src/command/presenters.ts`、`src/ui/app.tsx`

1. `CommandUIController` 增加 `showContextUsage`。
2. 注册 `/context`（别名 `/ctx`）。
3. `buildContextUsagePresentation` 渲染动态格子、模型、总占用、五类明细与 MCP 明细。
4. `App` 接入 `showContextUsage`，传入当前 Provider、模式与终端能力。

**验证：** `pnpm test src/command/builtins.test.ts src/command/dispatcher.test.ts src/command/presenters.test.ts`。

## T6: 增量：分类明细嵌套展示

**文件：** `src/context/types.ts`、`src/context/manager.ts`、`src/agent/loop.ts`、`src/command/presenters.ts`

1. `ContextUsageBreakdown` 增加 `systemToolEntries`、`skillEntries`、`messageCount`，输入增加 `skillEntries`。
2. `estimateUsageBreakdown` 计算系统工具逐项、MCP 逐项、Skill 逐项估算与消息条数。
3. `estimateContextUsage` 把 `activeSkills`（名称 + 正文）传入估算层。
4. `buildContextUsagePresentation` 把 System tools / MCP tools / Skills 明细缩进挂在对应分类行下方，Messages 行带消息条数，移除 `MCP tools 明细` 独立块。

**验证：** `pnpm test src/context/manager.test.ts src/agent/loop.test.ts src/command/presenters.test.ts src/ui/app.test.ts`。

## T7: 增量：树形展开与弱化 Token 数值

**文件：** `src/markdown/types.ts`、`src/presentation/types.ts`、`src/presentation/markdown.ts`、`src/markdown/renderer.ts`、`src/command/presenters.ts`

1. `MarkdownBlock` 与 `PresentationBlock` 增加 `tree` 类型，行字段为 `content`、`indent`、`branch`。
2. `presentationBlocksToMarkdown` 转换 `tree` 块并逐行解析行内 Markdown。
3. `renderMarkdown` 新增 `renderTree`，分支行渲染 `├ `（ASCII `|- `）并按 `indent` 缩进，`muted` 样式处理 `├` 与 `~~...~~`。
4. `/context` 分类明细改为单个 `tree` 块，token 数值用 `~~...~~` 弱化。
5. `presentationToPlainText` 支持 `tree` 块并去掉 `~~` 标记。

**验证：** `pnpm test src/markdown/renderer.test.ts src/presentation/markdown.test.ts src/command/presenters.test.ts src/ui/presentation-view.test.ts`。

## T5: 文档与收尾

**文件：** `README.md`、`docs/context-command/*.md`

1. README 命令表增加 `/context`。
2. 四份文档按最终实现同步。
3. 全量 `pnpm check` 与 `git diff --check` 通过。
