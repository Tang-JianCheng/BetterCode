# BetterCode 终端 Markdown 渲染 Checklist

> 每一项必须以自动化输出或实际终端观察为证据。实现前保持未勾选，验收通过后再更新。

## 解析与渲染

- [x] **C1：使用成熟 Markdown 解析库**
  `src/markdown/parser.ts` 使用 `marked`，不手写完整解析器。（验证：依赖清单与源码审阅；覆盖 N4）

- [x] **C2：AST 与渲染框架解耦**
  `src/markdown/types.ts` 不导入 React、Ink、主题或 `marked` 类型。（验证：静态扫描；覆盖 N3）

- [x] **C3：块级语法完整**
  标题、段落、代码块、列表、引用、分隔线和表格均能解析为正确 AST。（验证：parser 单测；覆盖 G4）

- [x] **C4：行内语法完整**
  粗体、斜体、删除线、行内代码、链接、图片和换行均能解析。（验证：parser 单测；覆盖 G4）

- [x] **C5：原始 HTML 安全**
  `<script>`、`<img onerror>` 等内容只作为纯文本展示，不执行、不解释标签。（验证：parser 与渲染安全测试；覆盖 AC5、N5）

- [x] **C6：解析失败兜底**
  异常输入回退为单段落原文，不抛错、不崩溃、不阻塞输入。（验证：异常输入测试；覆盖 AC6）

## 终端展示

- [x] **C7：宽屏渲染正确**
  120 列下标题、列表、代码块、链接和表格层级清晰，行不越界。（验证：renderer/markdown-view 矩阵；覆盖 AC3）

- [x] **C8：紧凑渲染正确**
  80 列下表格与代码块正常收缩，正文仍可读。（验证：compact 矩阵；覆盖 AC3）

- [x] **C9：窄屏渲染正确**
  55 列下表格降级为键值行，所有行显示宽度不超过 55。（验证：narrow 矩阵；覆盖 AC3）

- [x] **C10：无颜色语义保留**
  `NO_COLOR` 下粗体、代码、链接和标题仍由文字或符号区分。（验证：无颜色帧；覆盖 AC4）

- [x] **C11：ASCII 无 Unicode 装饰**
  `BETTERCODE_ASCII=1` 下不输出 Unicode 边框、项目符号和引用装饰。（验证：ASCII 帧扫描；覆盖 AC4）

- [x] **C12：长内容安全**
  长代码行、长链接和长单词不横向溢出，不破坏输入区与底栏。（验证：宽度断言；覆盖 AC3）

## 历史与恢复

- [x] **C13：最终回复只解析一次**
  同一历史项重绘时解析次数不增加；AST 与原文一起保存在展示模型中。（验证：App 集成测试与解析计数；覆盖 AC2、N1）

- [x] **C14：流式期间保持纯文本**
  流式输出阶段不出现 Markdown 渲染，流结束后才渲染。（验证：MessageList 流式帧；覆盖 AC1）

- [x] **C15：恢复会话按 Markdown 渲染**
  `/session` 恢复的助手消息渲染 Markdown，用户消息保持纯文本。（验证：resume 集成测试；覆盖 AC7）

- [x] **C16：回滚对话按 Markdown 渲染**
  回滚恢复的助手消息渲染 Markdown，不丢失原文。（验证：rewind 集成测试；覆盖 AC7）

## 回归与交付

- [x] **C17：命令面板与通知不受影响**
  `/help`、`/status`、权限面板和通知仍走结构化展示，不进入 Markdown 自由解析。（验证：命令专项测试；覆盖 G7）

- [x] **C18：类型检查通过**
  `pnpm typecheck` 退出码为 0，新增 AST 联合分支完整。（验证：TypeScript 输出）

- [x] **C19：全量测试通过**
  `pnpm check` 退出码为 0，无失败、跳过增加、未处理 Promise 或挂起句柄。（验证：记录实际测试总数与耗时）

- [x] **C20：静态规范扫描通过**
  没有旧产品名、占位符、冲突标记、散落硬编码主题色和敏感信息。（验证：`rg` 规则逐项审阅）

- [x] **C21：差异与提交边界正确**

## 验收记录

- 解析与渲染专项：`pnpm exec tsx --test src/markdown/parser.test.ts src/markdown/renderer.test.ts` 7/7 通过；`src/markdown/types.ts` 静态扫描无 React/Ink/主题/marked 依赖。
- UI 专项：`markdown-view.test.ts` 覆盖 120/80/55、无颜色、ASCII；`presentation-view.test.ts` 覆盖 markdown 路由与纯文本共存；App 集成测试覆盖最终回复、流式纯文本、恢复会话、回滚和解析失败提示。
- 全量验收：`pnpm check` 退出码 0，共 455 项测试通过（新增 15 项），无失败、跳过或挂起句柄。
- 静态扫描：`rg -n "MewCode|BetteerCode|TODO|TBD|<<<<<<<|=======|>>>>>>>" src docs/markdown-rendering README.md` 仅命中 `src/subagent/prompts.test.ts` 中既有的“不得出现 MewCode”负向断言；`markdown-view.tsx` 颜色全部来自 `BETTERCODE_THEME`。
- 交付边界：`pnpm install --frozen-lockfile`、`/usr/bin/git diff --check` 均通过；提交仅包含本 Plan 文件，不包含 `.bettercode/` 与 `node_modules/`。
  `git diff --check` 通过，只提交本 Plan 文件，不包含 `.bettercode/` 或用户无关改动。（验证：Git 状态与提交内容检查）

## Spec 覆盖索引

| Spec 验收标准 | Checklist 覆盖位置 |
|---|---|
| AC1 | C13、C14 |
| AC2 | C13 |
| AC3 | C7-C9、C12 |
| AC4 | C10-C11 |
| AC5 | C5 |
| AC6 | C6 |
| AC7 | C15-C16 |
| AC8 | C18-C21 |

## 增量验收（渲染体验第二轮）

- [x] **D1：表格代码内 `|` 不拆列**
  parser 测试 `SET key [NX|XX]` 保持单列且 code 完整。（验证：`src/markdown/parser.test.ts`；覆盖 AC9）

- [x] **D2：表格自适应列宽**
  宽屏表格无外侧竖线、无尾随空白，分隔线长度跟随内容并受 88 列约束。（验证：renderer、markdown-view、presentation-view 测试；覆盖 AC9）

- [x] **D3：标题不输出 `#`**
  彩色、无颜色与 ASCII 模式下均不显示 `# 标题`，正文文字完整。（验证：renderer、markdown-view、presentation-view、app 测试；覆盖 AC10）

- [x] **D4：块间距与分隔线**
  块间空行稳定，`hr` 不超过 28 列。（验证：renderer 测试；覆盖 F12）

- [x] **D5：全量回归**
  `pnpm typecheck` 通过；`pnpm test` 464/464 通过；`git diff --check` 通过。（验证：本次验收记录；覆盖 AC11）

**验收记录：**

- Markdown/UI 专项：23 项通过。
- 全量：464 项通过。为修复既有 macOS 临时目录清理 ENOTEMPTY 抖动，测试清理调用增加 `maxRetries`/`retryDelay`。

## 增量验收（统一来源渲染）

- [x] **E1：展示块可转换为 Markdown AST**
  text/heading、key_value、table、list、divider 均能转换为对应 Markdown 块。（验证：`src/presentation/markdown.test.ts`；覆盖 F14-F16）

- [x] **E2：文档与通知统一渲染**
  `DocumentView`、`NoticeView` 统一交给 `MarkdownView`，构造时一次解析、重绘复用。（验证：builders、presentation-view 测试；覆盖 F14、F17）

- [x] **E3：/help 不再输出面板边框**
  120/80/55 列下均无 `╭`、`╰` 或旧式 `│` 边框，分组标题为 Markdown 标题。（验证：`src/ui/presentation-view.test.ts`；覆盖 AC12）

- [x] **E4：降级约束保持**
  ASCII 模式不输出 `•`/`╭╰`，窄屏表格降级为键值行，超宽表格限制 88 列。（验证：presentation-view/markdown-view 测试；覆盖 AC13）

- [x] **E5：全量回归与提交**
  `pnpm typecheck` 通过，`pnpm test` 466/466 通过，`git diff --check` 通过，创建中文提交。（验证：本次验收记录；覆盖 AC14）

**验收记录：**

- Markdown/UI 专项：27 项通过。
- 全量：`pnpm check` 退出码 0，共 466 项测试通过，无失败、跳过或挂起句柄。
