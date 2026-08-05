# BetterCode 终端 Markdown 渲染 Plan

## 架构概览

在业务层与 Ink 之间增加一个框架中立的 `src/markdown/` 模块，负责两件事：

1. 用成熟 Markdown 解析库把最终回复解析成 BetterCode 自己的 AST。
2. 根据终端宽度、Unicode 和颜色能力把 AST 渲染成带样式的行片段。

展示契约继续负责“有什么内容”，`src/ui/markdown-view.tsx` 只负责把行片段映射到 Ink 组件。流式文本不经过 Markdown 解析；`consumeAgentStream` 的 `finally` 拿到完整 `finalText` 后解析一次，再把结果放进历史。

```text
Agent stream stopped
  -> parseMarkdown(finalText)
  -> createConversation({ content, markdown: ast, thinking })
  -> MessageList / PresentationView
  -> MarkdownView(ast)
```

## 核心数据结构

### Markdown AST（框架中立）

```typescript
export type MarkdownInline =
  | { type: 'text'; content: string }
  | { type: 'strong'; children: readonly MarkdownInline[] }
  | { type: 'em'; children: readonly MarkdownInline[] }
  | { type: 'del'; children: readonly MarkdownInline[] }
  | { type: 'code'; content: string }
  | { type: 'link'; href: string; children: readonly MarkdownInline[] }
  | { type: 'image'; alt: string; src: string }
  | { type: 'br' };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inline: readonly MarkdownInline[] }
  | { type: 'paragraph'; inline: readonly MarkdownInline[] }
  | { type: 'code'; language?: string; content: string }
  | { type: 'list'; ordered: boolean; start: number; items: readonly MarkdownListItem[] }
  | { type: 'quote'; blocks: readonly MarkdownBlock[] }
  | { type: 'table'; header: readonly string[]; rows: readonly (readonly string[])[] }
  | { type: 'hr' }
  | { type: 'html'; content: string };

export interface MarkdownListItem {
  blocks: readonly MarkdownBlock[];
}

export interface MarkdownAst {
  blocks: readonly MarkdownBlock[];
}
```

### 渲染行片段

```typescript
export type MarkdownSegmentStyle =
  | 'normal'
  | 'bold'
  | 'dim'
  | 'accent'
  | 'code'
  | 'link'
  | 'heading'
  | 'muted';

export interface MarkdownSegment {
  text: string;
  style: MarkdownSegmentStyle;
}

export interface MarkdownLine {
  segments: readonly MarkdownSegment[];
  indent?: number;
}

export interface MarkdownRenderOptions {
  columns: number;
  unicode: boolean;
  color: boolean;
}
```

行片段只描述文字与语义样式，不包含 ANSI 码，也不包含 Ink 组件。

## 模块设计

### `src/markdown/types.ts`

定义 AST、行内节点、块节点、行片段和渲染选项。不依赖 React、Ink、主题或 `marked` 类型。

### `src/markdown/parser.ts`

使用成熟 Markdown 解析库（`marked`）解析输入，再把库的 token 适配成 BetterCode AST：

- 解析选项：GFM 开启、`breaks` 关闭，避免普通单换行被误当成 `<br>`。
- 块适配：heading、paragraph、code、blockquote、list、table、hr。
- 行内适配：strong、em、del、codespan、link、image、br、text。
- 原始 HTML token 适配为 `{ type: 'html', content }`，渲染层只输出文字，不解释标签。
- 未知 token 保守降级为纯文本段落。
- `parseMarkdown(source)` 不抛异常；解析器内部异常时回退为单段落纯文本。

导出：

```typescript
export function parseMarkdown(source: string): MarkdownAst;
```

### `src/markdown/renderer.ts`

把 AST 渲染为 `MarkdownLine[]`：

- 段落按显示宽度分词换行，中文与组合字符按 `string-width` 宽度计算。
- 标题使用加粗和层级前缀，h1-h3 保留 `#` 层级标记，h4-h6 加粗展示；无颜色时可辨认。
- 行内代码在无颜色模式保留反引号；有颜色模式使用强调色。
- 链接显示 `文本 (URL)`，URL 使用弱化样式。
- 代码块有上下边界和可选语言标识，内容保留缩进；超长行按宽度安全截断或续行，不横向溢出。
- 列表按层级缩进，无序使用 `•`/`-`，有序使用序号。
- 引用使用 `>` 或竖线前缀。
- 表格在 full/compact 使用紧凑表格，narrow 降级为键值行。
- HTML 块按纯文本展示，不解释标签。

导出：

```typescript
export function renderMarkdown(
  ast: MarkdownAst,
  options: MarkdownRenderOptions,
): MarkdownLine[];
```

### `src/presentation/types.ts`（增量）

`ConversationPresentation` 增加可选字段：

```typescript
export interface ConversationPresentation {
  kind: 'conversation';
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  markdown?: MarkdownAst;
}
```

`markdown` 只由“流结束后的助手最终回复”和“恢复出的助手消息”携带；用户消息、命令消息和流式临时消息不携带。

### `src/presentation/builders.ts`（增量）

`createConversation` 保留并传递 `markdown` 字段，不修改原始 `content`。

### `src/ui/markdown-view.tsx`

把 `MarkdownLine[]` 渲染为 Ink 组件：

- 使用 `BETTERCODE_THEME` 映射 segment style，不散落硬编码颜色。
- 无颜色模式不传颜色，靠文字标记表达语义。
- 代码行和表格行使用稳定宽度，不随内容变化挤压状态栏。
- thinking 沿用现有弱化展示，正文使用 Markdown 渲染。

### `src/ui/presentation-view.tsx`（增量）

`ConversationView` 在 `item.markdown` 存在且角色为 assistant 时渲染 `MarkdownView`；否则保持现有纯文本路径。

### `src/ui/app.tsx`（增量）

- `consumeAgentStream` 的 `finally` 中，对 `finalText` 调用 `parseMarkdown`，并传入 `createConversation`。
- `resumeSession` 和 `handleRewind` 恢复的助手消息同样解析一次。
- `appendAssistant` 保持纯文本路径，供本地命令与受控消息使用；只有 Agent 最终回复和历史恢复走 Markdown。

## 模块交互

1. `App.consumeAgentStream` 流结束后得到完整 `finalText`。
2. `parseMarkdown(finalText)` 生成 AST。
3. `createConversation({ role: 'assistant', content: finalText, markdown: ast, thinking })` 把 AST 放进历史。
4. `MessageList` 把历史项交给 `PresentationView`。
5. `PresentationView` 检测 `markdown` 后交给 `MarkdownView`。
6. `MarkdownView` 调用 `renderMarkdown(ast, options)` 得到行片段，再用 Ink 输出。
7. 用户消息、流式文本、命令面板和通知不进入此链路。

## 文件组织

```text
docs/markdown-rendering/
├── spec.md
├── plan.md
├── task.md
└── checklist.md

src/markdown/
├── types.ts
├── parser.ts
├── renderer.ts
├── parser.test.ts
└── renderer.test.ts

src/ui/
├── markdown-view.tsx
├── markdown-view.test.ts
├── presentation-view.tsx    （增量）
└── app.tsx                  （增量）

src/presentation/
├── types.ts                 （增量）
└── builders.ts              （增量）

package.json / pnpm-lock.yaml（增加 marked）
README.md                     （增量说明）
```

## 技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| Markdown 解析 | 使用 `marked` | 成熟、支持 GFM、自带类型；符合“不重写解析器”约束 |
| AST 形态 | 自建 BetterCode AST | 与 `marked` 类型解耦，渲染层不依赖具体库版本 |
| 渲染时机 | 流结束后解析一次 | 满足“输出一次之后渲染一次”，避免每帧重解析 |
| 历史保存 | 原文 + AST 一起保存 | 渲染只影响展示，不改变持久化和上下文格式 |
| 原始 HTML | 按纯文本展示 | 安全优先，不执行脚本，不触发外部资源 |
| 宽度处理 | `string-width` 统一度量 | 中文与组合字符不越界 |
| 表格窄屏 | 降级为键值行 | 避免 55 列下重叠 |

## 边界与风险

- 长代码块不会横向溢出，但过宽行可能被截断；原文仍完整保存在历史中，不影响上下文与回滚。
- Markdown 解析结果随历史恢复；旧会话记录没有 AST 时会在恢复时补解析一次。
- `marked` 的新版本若改变 token 结构，由 adapter 隔离，UI 无需感知。

## 增量设计：渲染体验第二轮（2026-08-03）

### 表格解析

- 不再依赖 marked 的 table cell 文本（其会把代码内 `|` 拆列甚至丢内容），改为从 `token.raw` 逐行按代码区内外重新切分单元格。
- 切分时剥离首尾列分隔符、过滤空行，单元格文本再交给 marked 行内解析，保证 `SET key [NX|XX]` 这类内容保持单列且 code 完整。

### 表格渲染

- 列宽取 header 与全部 rows 的自然宽度最大值；总宽超过可用宽度时按比例收缩并回补余量。
- 行内内容超列宽时截断加省略号，尾部不再补空格。
- 分隔线宽度等于各列宽度之和加分隔符宽度，并受 88 列上限约束。
- 命令面板 `formatTable` 使用同一套自然列宽策略。

### 标题与间距

- 标题始终输出纯文本，不再拼 `#` 标记，由 segment style 负责强调；无颜色模式仍保留文字内容。
- 块间统一插入一个空行；`hr` 最多 28 列。

## 增量设计：统一来源渲染（2026-08-03）

### 展示到 Markdown 的桥接

- 新增 `src/presentation/markdown.ts`：
  - `presentationBlocksToMarkdown(blocks)`：把 text/heading、key_value、table、list、divider 转换为 `MarkdownBlock[]`。
  - `presentationDocumentMarkdown(input)`：文档标题生成二级标题，badge 并入标题，footer 成段落。
  - `presentationNoticeMarkdown(input)`：message 成段落、details 成无序列表；无内容返回 `undefined`。
- `src/markdown/parser.ts` 新增 `parseInlineMarkdown(source)`，把短文本解析为行内节点，供桥接层复用。

### 展示契约增量

- `PresentationBlock.text` 增加可选 `heading?: boolean`，命令分组标题转成 Markdown 标题。
- `PresentationDocument` 与 `NoticePresentation` 增加可选 `markdown?: MarkdownAst`，构造时一次解析、重绘复用。

### 展示路由统一

- `DocumentView` 优先使用 `item.markdown`，否则调用 `presentationDocumentMarkdown(item)`，统一交给 `MarkdownView`。
- `NoticeView` 保留首行 `MascotMark + 语气标签 · 标题`，正文用 `item.markdown ?? presentationNoticeMarkdown(item)`。
- 删除旧 `dividerLine`、`formatKeyValues`、`formatTable` 和所有面板边框样式；`/help` 分组标题改用 heading 块。

## 增量：移除思考展示

- `MarkdownView` 删除 `thinking` prop 与思考行渲染；`PresentationView` 不再向 `MarkdownView` 传思考内容。
- `ConversationPresentation` 删除 `thinking` 字段，`createConversation` 不再携带思考文本。
- 相关“长 thinking 越界”与“Apple Terminal 思考破折号”测试改为只覆盖正文。
