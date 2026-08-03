# BetterCode 终端 Markdown 渲染 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|---|---|---|
| 新建 | `src/markdown/types.ts` | Markdown AST 与行片段类型 |
| 新建 | `src/markdown/parser.ts` | `marked` 适配到 BetterCode AST |
| 新建 | `src/markdown/parser.test.ts` | 解析覆盖 |
| 新建 | `src/markdown/renderer.ts` | 宽度感知的终端行渲染 |
| 新建 | `src/markdown/renderer.test.ts` | 渲染与降级覆盖 |
| 新建 | `src/ui/markdown-view.tsx` | Ink 渲染行片段 |
| 新建 | `src/ui/markdown-view.test.ts` | 稳定帧与语义断言 |
| 修改 | `src/presentation/types.ts` | conversation 增加可选 markdown AST |
| 修改 | `src/presentation/builders.ts` | createConversation 传递 markdown |
| 修改 | `src/presentation/builders.test.ts` | markdown 字段保留测试 |
| 修改 | `src/ui/presentation-view.tsx` | assistant markdown 路由 |
| 修改 | `src/ui/presentation-view.test.ts` | markdown 分支测试 |
| 修改 | `src/ui/app.tsx` | 最终回复、恢复、回滚接入解析 |
| 修改 | `src/ui/app.test.ts` | 最终回复渲染与恢复测试 |
| 修改 | `package.json`、`pnpm-lock.yaml` | 增加 marked 依赖 |
| 修改 | `README.md` | Markdown 渲染说明 |
| 修改 | `docs/markdown-rendering/checklist.md` | 实现后按证据勾选 |

## T1：安装 Markdown 解析依赖

**文件：** `package.json`、`pnpm-lock.yaml`

**依赖：** 无

**步骤：**

1. 增加 `marked` 运行时依赖。
2. 不升级无关依赖，不修改现有 npm scripts。
3. 运行 `pnpm install --frozen-lockfile`，确认锁文件只包含新增依赖。

**验证：** `pnpm typecheck` 通过，`marked` 可正常 import。

## T2：定义 Markdown AST

**文件：** `src/markdown/types.ts`

**依赖：** 无

**步骤：**

1. 定义 `MarkdownInline`、`MarkdownBlock`、`MarkdownListItem`、`MarkdownAst`。
2. 定义 `MarkdownSegmentStyle`、`MarkdownSegment`、`MarkdownLine`、`MarkdownRenderOptions`。
3. 全部字段只读；不导入 React、Ink、主题或 `marked` 类型。

**验证：** `pnpm typecheck` 通过；`rg -n "from 'ink|from 'react" src/markdown/types.ts` 无输出。

## T3：实现解析器

**文件：** `src/markdown/parser.ts`、`src/markdown/parser.test.ts`

**依赖：** T1、T2

**步骤：**

1. 使用 `marked` 的 GFM 解析，关闭 breaks。
2. 实现块级与行内 token 到自建 AST 的适配。
3. 原始 HTML 转为 `html` 节点，不做任何标签解释。
4. 未知 token 降级为纯文本段落；解析器内部异常回退为单段落原文。
5. 覆盖标题、段落、粗斜体、删除线、行内代码、链接、图片、代码块、嵌套列表、引用、分隔线、表格、HTML 与异常输入测试。

**验证：** `pnpm exec tsx --test src/markdown/parser.test.ts` 全部通过。

## T4：实现终端渲染器

**文件：** `src/markdown/renderer.ts`、`src/markdown/renderer.test.ts`

**依赖：** T2

**步骤：**

1. 段落按显示宽度换行，中文与组合字符不越界。
2. 标题、代码、链接、列表、引用、表格和分隔线按 Plan 样式渲染。
3. 代码块保留缩进，超长行安全处理。
4. 表格 full/compact 紧凑展示，narrow 键值行。
5. 无颜色模式使用文字标记，ASCII 模式不使用 Unicode 装饰。
6. 覆盖 120、80、55 列和无颜色、ASCII 矩阵，以及长代码、长链接、嵌套列表和窄表格。

**验证：** 渲染测试全部通过，且每行 `displayWidth <= columns`。

## T5：扩展示范契约

**文件：** `src/presentation/types.ts`、`src/presentation/builders.ts`、`src/presentation/builders.test.ts`

**依赖：** T2

**步骤：**

1. `ConversationPresentation` 增加可选 `markdown?: MarkdownAst`。
2. `createConversation` 原样传递 markdown，不修改 content。
3. 补充 markdown 字段保留测试；现有纯文本 conversation 行为不变。

**验证：** `pnpm exec tsx --test src/presentation/builders.test.ts` 通过。

## T6：实现 Markdown 视图

**文件：** `src/ui/markdown-view.tsx`、`src/ui/markdown-view.test.ts`

**依赖：** T4、T5

**步骤：**

1. 用 `BETTERCODE_THEME` 映射 segment style，不使用散落硬编码颜色。
2. 无颜色模式不传颜色；代码、链接、标题和引用保留文字语义。
3. 行片段按行渲染，indent 稳定，不与状态栏重叠。
4. thinking 使用现有弱化样式。
5. 覆盖 120、80、55 列、无颜色和 ASCII 稳定帧。

**验证：** `pnpm exec tsx --test src/ui/markdown-view.test.ts` 全部通过。

## T7：接入展示路由

**文件：** `src/ui/presentation-view.tsx`、`src/ui/presentation-view.test.ts`

**依赖：** T5、T6

**步骤：**

1. assistant conversation 携带 markdown 时渲染 `MarkdownView`。
2. 无 markdown 或用户消息保持原纯文本路径。
3. 补充 markdown 与纯文本共存测试，确认命令面板和通知不受影响。

**验证：** `pnpm exec tsx --test src/ui/presentation-view.test.ts` 通过。

## T8：接入最终回复与恢复

**文件：** `src/ui/app.tsx`、`src/ui/app.test.ts`

**依赖：** T3、T7

**步骤：**

1. `consumeAgentStream` 的 `finally` 对 `finalText` 解析一次并写入 conversation。
2. `resumeSession` 与 `handleRewind` 恢复的助手消息解析一次。
3. 流式文本和用户消息不进入 Markdown 路径。
4. 解析失败时保留原文并显示受控 notice。
5. 补充最终回复、恢复会话、回滚和解析失败测试。

**验证：** `pnpm exec tsx --test src/ui/app.test.ts src/ui/message-list.test.ts` 通过。

## T9：更新使用说明

**文件：** `README.md`

**依赖：** T8

**步骤：**

1. 说明助手最终回复会渲染 Markdown，流式期间保持纯文本。
2. 说明支持标题、代码块、列表、链接和表格。
3. 保留现有界面、降级和快捷键说明。

**验证：** README 与实现中的功能描述一致。

## T10：全量验收与中文提交

**文件：** 本 Plan 涉及的全部文件

**依赖：** T1-T9

**步骤：**

1. 运行 `pnpm check`。
2. 运行 UI 与 Markdown 专项矩阵，确认宽度、无颜色、ASCII、低动态和恢复路径。
3. 扫描旧产品名、占位符、冲突标记、散落颜色和敏感信息。
4. 运行 `git diff --check`，确认不提交 `.bettercode/` 和 `node_modules/`。
5. 按 `docs/markdown-rendering/checklist.md` 记录证据并勾选。
6. 使用中文 Git 提交信息创建本大型 Plan 的阶段检查点。

**验证：** `pnpm check`、UI 专项矩阵、静态扫描和 `git diff --check` 均以退出码 0 完成。

## 执行顺序

```text
T1 -> T2 -> T3
       |
       -> T4 -> T6
T5 -> T7 -> T8 -> T9 -> T10
```

T1 与 T5 无代码依赖但 T5 依赖 T2 的类型定义；T6 依赖 T4 和 T5；T8 依赖 T3 和 T7。T8 集中修改 App，必须单独串行执行。

## 增量任务：渲染体验第二轮（2026-08-03）

### T11：表格解析健壮化

**文件：** `src/markdown/parser.ts`、`src/markdown/parser.test.ts`

**步骤：**

1. 增加按代码区识别拆分表格行的 `splitTableCells`，剥离首尾 `|` 并过滤空行。
2. 行内代码里的 `|` 不再拆列，单元格内行内语法正常解析。

**验证：** parser 专项测试通过；`SET key [NX|XX]` 保持单列且 code 内容完整。

### T12：表格与面板自适应列宽

**文件：** `src/markdown/renderer.ts`、`src/ui/presentation-view.tsx` 及对应测试

**步骤：**

1. 宽屏表格按内容自然列宽渲染，去掉外侧边框和尾部空白，分隔线跟随表宽。
2. 命令面板表格同步自然列宽。

**验证：** renderer、markdown-view、presentation-view 专项测试通过。

### T13：标题与间距打磨

**文件：** `src/markdown/renderer.ts` 及对应测试

**步骤：**

1. 标题不再输出 `#`。
2. 块间空行稳定，`hr` 缩短为最多 28 列。

**验证：** renderer 与 app 集成测试通过，无 `# 标题` 残留。

### T14：全量验收

1. `pnpm typecheck`。
2. `pnpm test`（464 项）。
3. `git diff --check`。
4. 更新四份文档并创建中文提交。
