# BetterCode 终端视觉与交互系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|---|---|---|
| 新建 | `src/presentation/types.ts` | 中立结构化展示类型 |
| 新建 | `src/presentation/builders.ts` | 展示模型构造与校验 |
| 新建 | `src/presentation/builders.test.ts` | 展示契约测试 |
| 新建 | `src/command/presenters.ts` | 本地命令结构化展示转换 |
| 新建 | `src/command/presenters.test.ts` | 命令面板模型测试 |
| 修改 | `src/command/types.ts` | 增加结构化展示入口 |
| 修改 | `src/command/builtins.ts` | 内置命令改用 presenter |
| 修改 | `src/command/*.test.ts` | 更新假控制器和命令行为断言 |
| 新建 | `src/ui/theme.ts` | BetterCode 官方主题与语义标记 |
| 新建 | `src/ui/capabilities.ts` | 终端能力、宽度和降级策略 |
| 新建 | `src/ui/capabilities.test.ts` | 能力与显示宽度测试 |
| 新建 | `src/ui/mascot.tsx` | 完整“小码”形象和简化标记 |
| 新建 | `src/ui/mascot.test.ts` | 品牌区稳定帧测试 |
| 新建 | `src/ui/status-bar.tsx` | 自适应双层状态栏 |
| 新建 | `src/ui/status-bar.test.ts` | 状态段优先级和宽度矩阵测试 |
| 新建 | `src/ui/presentation-view.tsx` | 对话、文档、通知和块渲染 |
| 新建 | `src/ui/presentation-view.test.ts` | 结构化内容渲染测试 |
| 新建 | `src/ui/activity-indicator.tsx` | 局部动态活动反馈 |
| 新建 | `src/ui/activity-indicator.test.ts` | 动画与计时器生命周期测试 |
| 新建 | `src/ui/interaction-panel.tsx` | 统一交互请求面板 |
| 新建 | `src/ui/interaction-panel.test.ts` | 焦点、选中和帮助行测试 |
| 修改 | `src/ui/permission-prompt.tsx` | 接入统一面板与方向键选择 |
| 修改 | `src/ui/rewind-dialog.tsx` | 接入统一面板与焦点语义 |
| 修改 | `src/ui/input-box.tsx` | 精致输入区与稳定补全区域 |
| 修改 | `src/ui/message-list.tsx` | 渲染结构化历史和流式内容 |
| 修改 | `src/ui/app.tsx` | 新展示状态、活动状态、焦点和整体布局 |
| 修改 | `src/ui/*.test.ts` | UI 行为和回归测试 |
| 修改 | `package.json`、`pnpm-lock.yaml` | 增加显示宽度和 Ink 测试依赖 |
| 修改 | `README.md` | 更新界面、降级环境变量和快捷键说明 |

## T1：安装终端显示与测试依赖

**文件：** `package.json`、`pnpm-lock.yaml`

**依赖：** 无

**步骤：**

1. 增加 `string-width` 直接运行时依赖。
2. 增加与当前 Ink 版本兼容的 `ink-testing-library` 开发依赖。
3. 不升级无关依赖，不改现有 npm scripts 的测试匹配规则。
4. 检查锁文件只包含新增依赖所需变化。

**验证：** 运行 `pnpm install --frozen-lockfile` 和 `pnpm typecheck`，期望依赖可解析且既有源码继续编译。

## T2：定义中立展示类型

**文件：** `src/presentation/types.ts`

**依赖：** 无

**步骤：**

1. 定义 tone、entry、column、block、document、conversation、notice 和联合类型。
2. 所有集合字段使用只读类型，避免渲染器修改业务数据。
3. 限定 source、role 和 block kind，禁止任意字符串扩散。
4. 不导入 React、Ink 或颜色实现。

**验证：** 运行 `pnpm typecheck`，并执行 `rg -n "from 'ink|from 'react" src/presentation/types.ts`，期望扫描无输出。

## T3：实现展示模型构造与校验

**文件：** `src/presentation/builders.ts`、`src/presentation/builders.test.ts`

**依赖：** T2

**步骤：**

1. 实现 document、notice 和 conversation 构造器。
2. 校验非空标题、表格列数、键值项和详情数量上限。
3. conversation 保留用户和模型原文，不修剪正文内部空白。
4. 失败返回明确中文错误，不产生部分文档。
5. 覆盖合法文档、空标题、错列表格和超限详情测试。

**验证：** 运行 `pnpm exec tsx --test src/presentation/builders.test.ts`，期望全部通过。

## T4：建立官方主题和终端能力模型

**文件：** `src/ui/theme.ts`、`src/ui/capabilities.ts`、`src/ui/capabilities.test.ts`

**依赖：** T1

**步骤：**

1. 定义唯一 `BETTERCODE_THEME` 和语义标记映射。
2. 从可注入环境计算 full、compact、narrow 三档密度。
3. 支持 `NO_COLOR`、`TERM=dumb`、`BETTERCODE_ASCII`、`BETTERCODE_REDUCE_MOTION` 和 CI 降级。
4. 使用 `string-width` 实现显示宽度测量。
5. 实现按 grapheme 截断并追加省略标记，结果不得超过目标列数。
6. 覆盖 100/99/64/63 列边界、中文、组合字符、无颜色和低动态测试。

**验证：** 运行 `pnpm exec tsx --test src/ui/capabilities.test.ts`，期望全部通过。

## T5：实现原创“小码”虚拟形象

**文件：** `src/ui/mascot.tsx`、`src/ui/mascot.test.ts`

**依赖：** T4

**步骤：**

1. 设计 6 至 8 行 Unicode 原创蜡笔风少年形象。
2. 设计更窄的 ASCII 降级形象。
3. 实现启动品牌区，展示 BetterCode、版本和简短欢迎语。
4. 实现 info、active、warning、danger 四类简化标记。
5. 扫描源码，确认没有第三方角色名称、台词或可识别复制描述。
6. 对完整、紧凑和 ASCII 形象做稳定帧测试。

**验证：** 运行 `pnpm exec tsx --test src/ui/mascot.test.ts`，并运行版权名称静态扫描，期望测试通过且无第三方角色命中。

## T6：构建状态段与自适应布局算法

**文件：** `src/ui/status-bar.tsx`、`src/ui/status-bar.test.ts`

**依赖：** T4

**步骤：**

1. 定义 `StatusBarState`、`StatusSegment` 和核心段顺序。
2. 将 Provider、模型、模式、权限、usage、上下文、会话、Skill、后台任务和团队状态转换为段。
3. 实现缩短标签、截断值和移除非必要段的确定性流程。
4. 保证模型、模式和权限永不被移除。
5. usage 缺失时使用简洁空状态，不渲染全零明细。
6. 覆盖 full、compact、narrow 和超长模型名矩阵。

**验证：** 运行 `pnpm exec tsx --test src/ui/status-bar.test.ts`，逐行显示宽度均不得超过注入列数。

## T7：完成双层状态栏视觉组件

**文件：** `src/ui/status-bar.tsx`、`src/ui/status-bar.test.ts`

**依赖：** T6

**步骤：**

1. 使用细边界连接输入区与状态区。
2. full 模式渲染完整双层，compact 模式渲染缩写双层，narrow 模式渲染核心状态与最小补充行。
3. 使用主题语义色表达 plan、权限风险、提醒和缓存命中。
4. 无颜色模式使用文本标签和 ASCII 分隔符。
5. 覆盖团队激活、待审批、未读和后台任务状态。

**验证：** 运行状态栏组件帧测试，期望所有核心段存在且无越界。

## T8：实现命令展示 presenter

**文件：** `src/command/presenters.ts`、`src/command/presenters.test.ts`

**依赖：** T2、T3

**步骤：**

1. 实现 help 单命令和命令目录文档。
2. 实现 status、memory、permission 和 session 文档。
3. 实现 tasks、team 和命令错误通知。
4. 命令目录按命令类型或用户任务分组，保留注册顺序。
5. presenter 不读取 stdout 宽度，不拼 ANSI，不依赖 Ink。
6. 覆盖空列表、单项、多项、诊断和未知命令测试。

**验证：** 运行 `pnpm exec tsx --test src/command/presenters.test.ts`，并扫描运行时 UI 依赖，期望全部通过。

## T9：扩展命令 UI 控制契约

**文件：** `src/command/types.ts`、`src/command/*.test.ts`

**依赖：** T2、T8

**步骤：**

1. 给 `CommandUIController` 增加 `showPresentation`。
2. 保留短文本兼容入口，明确仅用于非结构化简短通知。
3. 更新所有测试假控制器，分别记录文本和结构化项。
4. 保持 command 包不依赖 React 或 Ink。

**验证：** 运行 `pnpm exec tsx --test src/command/*.test.ts` 和依赖扫描，期望全部通过。

## T10：迁移内置命令到结构化输出

**文件：** `src/command/builtins.ts`、`src/command/builtins.test.ts`

**依赖：** T8、T9

**步骤：**

1. `/help` 改用 help document。
2. `/status`、`/memory`、`/permission`、`/session`、`/tasks` 和 `/team` 使用对应 presenter。
3. 未知命令、非法参数和 handler 异常使用 command error notice。
4. `/plan`、`/do`、`/compact`、`/clear` 等简短终态使用 notice。
5. 不改变命令名称、别名、参数、权限和 Agent 分流行为。
6. 更新 builtins 与 dispatcher 断言，确认 Provider 调用次数不变。

**验证：** 运行 `pnpm exec tsx --test src/command/*.test.ts`，期望命令行为与结构断言全部通过。

## T11：实现结构化内容渲染器

**文件：** `src/ui/presentation-view.tsx`、`src/ui/presentation-view.test.ts`

**依赖：** T3、T4

**步骤：**

1. 实现 conversation、document 和 notice 分发。
2. 实现 text、key-value、table、list 和 divider 块。
3. full 模式表格按列显示，compact 模式收缩，narrow 模式转逐项布局。
4. 用户、助手、通知和命令文档使用不同但克制的视觉层级。
5. 普通助手正文不添加厚重外框。
6. 渲染异常时回退标题加纯文本摘要。

**验证：** 运行 `pnpm exec tsx --test src/ui/presentation-view.test.ts`，覆盖三档宽度和无颜色输出。

## T12：迁移消息列表展示模型

**文件：** `src/ui/message-list.tsx`、相关测试

**依赖：** T11

**步骤：**

1. 将历史输入改为 `PresentationItem[]`。
2. 使用稳定 ID 或生成时序 ID 作为 key，不再使用数组下标。
3. 历史、current thinking 和 current streaming 分区渲染。
4. 保留模型原始文本，不把正文解析成命令面板。
5. 验证插入通知、恢复会话和清空历史时没有组件错配。

**验证：** 运行消息列表测试与 `pnpm typecheck`，期望全部通过。

## T13：实现局部动态活动反馈

**文件：** `src/ui/activity-indicator.tsx`、`src/ui/activity-indicator.test.ts`

**依赖：** T4、T5

**步骤：**

1. 定义 Agent 和上下文事件到 `ActivityStage` 的映射。
2. 实现 Unicode 与 ASCII 动画帧。
3. 低动态和 CI 环境输出静态标记。
4. 动态组件只维护一个局部计时器。
5. 完成、取消、失败和 unmount 时清理计时器。
6. 工具名和阶段文案按宽度安全截断。

**验证：** 使用假计时器运行活动组件测试，期望帧会变化且终态后不再变化。

## T14：建立统一交互面板

**文件：** `src/ui/interaction-panel.tsx`、`src/ui/interaction-panel.test.ts`

**依赖：** T4

**步骤：**

1. 实现标题、tone、详情、选项和帮助行布局。
2. 选中项同时使用前缀、强调和可选颜色表达。
3. 支持 full、compact、narrow 与 ASCII 边框。
4. 定义 Enter、Esc 和方向键的公共状态转换辅助函数。
5. 覆盖长目标、窄屏、无颜色和空详情测试。

**验证：** 运行交互面板测试，期望选中项明确且每行不越界。

## T15：升级权限请求交互

**文件：** `src/ui/permission-prompt.tsx`、相关测试

**依赖：** T14

**步骤：**

1. 将风险、工具、目标、建议规则和命令警告映射到统一面板。
2. 保留 `d/o/s/p` 快捷键。
3. 增加方向键移动和 Enter 提交。
4. Esc 按拒绝处理或调用明确取消路径，行为在测试中固定。
5. 保留提交锁，快捷键与 Enter 混用也只回调一次。
6. 等待权限时底栏继续显示模型、模式和权限。

**验证：** 运行权限交互测试，覆盖四种单键、方向键、Enter、Esc、重复按键和取消。

## T16：升级回滚与补全焦点交互

**文件：** `src/ui/rewind-dialog.tsx`、`src/ui/input-box.tsx`、相关测试

**依赖：** T14

**步骤：**

1. 回滚选择和动作选择复用交互面板样式。
2. 修正动作索引边界，确保取消项可选且不会越界。
3. 输入补全菜单复用统一选中样式和帮助语义。
4. 限制可见候选数量，保持稳定区域高度。
5. 明确交互面板开启时输入框 `useInput` 失活。

**验证：** 运行 input、rewind 和 interaction 测试，覆盖完整键盘路径。

## T17：升级输入工作区

**文件：** `src/ui/input-box.tsx`、`src/ui/input-box.test.ts`

**依赖：** T4、T16

**步骤：**

1. 接入主题、终端能力和焦点状态。
2. 增加稳定顶部边界和 BetterCode 提示符。
3. disabled 状态不显示可编辑光标，只显示活动或等待提示。
4. 窄屏时缩短帮助，不让补全和提示覆盖状态栏。
5. 保留历史草稿恢复、Tab、Enter、Esc 和编辑行为。

**验证：** 运行 `pnpm exec tsx --test src/ui/input-box.test.ts` 和输入区帧测试。

## T18：重构 App 展示状态

**文件：** `src/ui/app.tsx`、`src/ui/app.test.ts`

**依赖：** T9、T12、T13

**步骤：**

1. 将 `DisplayMessage[]` 迁移为带稳定 ID 的 `PresentationItem[]`。
2. 将字符串 progress 迁移为 `ActivityState`。
3. 把启动诊断、记忆保存、子 Agent 和团队事件转换为 notice。
4. 把用户与助手最终文本转换为 conversation。
5. `showPresentation` 直接追加结构化项，禁止转回格式化字符串。
6. clear 不重复启动品牌，resume 正确恢复对话项。

**验证：** 运行 App 格式与状态转换测试，期望所有事件得到正确 item kind。

## T19：接入统一交互焦点

**文件：** `src/ui/app.tsx`、权限/回滚/输入测试

**依赖：** T15、T16、T18

**步骤：**

1. 建立顶层 `InteractionState`。
2. 权限、回滚和补全只有一个可处于活动状态。
3. 根据活动交互切换 InputBox、PermissionPrompt 和 RewindDialog 的输入激活状态。
4. 取消、完成和异常路径清理 interaction 与 resolver。
5. 保留 Ctrl+C 取消和 Ctrl+B 转后台的全局行为。

**验证：** 运行焦点竞争测试，确认一次按键只被一个组件消费。

## T20：组装启动品牌、活动区、输入区和底栏

**文件：** `src/ui/app.tsx`、`src/ui/app.test.ts`

**依赖：** T5、T7、T13、T17、T19

**步骤：**

1. 将 StartupBrand 放在初始界面顶部并保证生命周期只创建一次。
2. 按“历史、流式、活动/交互、输入、状态栏”顺序组装。
3. 流式、权限、补全和回滚分支之后都渲染同一个 StatusBar。
4. 统一状态收集，模式、权限、usage、Skill、任务和团队变更立即刷新。
5. 删除当前全宽 `'-'.repeat(columns)` 和独立 Token 文本行。
6. 保持根组件在窄终端中不产生不可控横向溢出。

**验证：** 运行 App 渲染矩阵，所有状态下模型、模式和权限均可见。

## T21：建立受控终端渲染测试工具

**文件：** `src/ui/render-harness.test.ts`

**依赖：** T1、T4

**步骤：**

1. 用 `ink-testing-library` 创建可控制列数、环境和输入的测试工具。
2. 提供获取最后稳定帧、去 ANSI、计算每行显示宽度的辅助函数。
3. 测试结束自动 unmount 并恢复计时器。
4. 避免读取用户真实配置、Provider API Key 或终端环境。

**验证：** 运行 harness 自测，分别渲染静态文本和输入组件并正常退出。

## T22：覆盖宽度、颜色与动画矩阵

**文件：** `src/ui/*test.ts`

**依赖：** T11、T13、T14、T20、T21

**步骤：**

1. 对 120、80、55 列渲染启动、help、status、permission、input 和 status bar。
2. 对 `NO_COLOR=1`、`TERM=dumb`、ASCII 和低动态环境重复关键场景。
3. 检查每行显示宽度不超过列数。
4. 检查模型、模式、权限、风险和选中项文本始终存在。
5. 检查动画终态后帧稳定且测试进程无残留句柄。

**验证：** 运行 `pnpm exec tsx --test src/ui/*.test.ts`，期望矩阵全部通过。

## T23：执行业务与快捷键回归

**文件：** `src/command/*.test.ts`、`src/ui/*.test.ts`、既有 Agent/Chat/Permission 测试

**依赖：** T10、T19、T20

**步骤：**

1. 验证 `/help`、`/status` 等命令仍绕过 Provider。
2. 验证 `/plan`、`/do` 和 `/permission` 更新底栏且行为不变。
3. 验证 Ctrl+C、Ctrl+B、输入历史、补全、回滚和会话恢复。
4. 验证权限只提交一次并继续回灌 Agent Loop。
5. 验证无 MCP、Skill、团队或 usage 时都有无噪声空状态。

**验证：** 运行 `pnpm exec tsx --test src/command/*.test.ts src/ui/*.test.ts src/agent/*.test.ts src/chat/*.test.ts src/permission/*.test.ts`。

## T24：更新使用说明

**文件：** `README.md`

**依赖：** T20、T22

**步骤：**

1. 更新启动界面、底栏状态和结构化命令说明。
2. 说明 `NO_COLOR`、`BETTERCODE_ASCII` 和 `BETTERCODE_REDUCE_MOTION`。
3. 保留现有命令、快捷键和模式说明。
4. 不加入未实现的主题自定义或图片终端承诺。

**验证：** 扫描 README 与实现中的环境变量名称，期望完全一致。

## T25：全量验收与中文阶段提交

**文件：** 本 Plan 涉及的全部文件

**依赖：** T1-T24

**步骤：**

1. 运行 TypeScript 类型检查和全部测试。
2. 运行 UI 宽度、无颜色、ASCII、低动态和焦点矩阵。
3. 启动 BetterCode，手工走完品牌区、help、对话、工具、权限和退出流程。
4. 扫描旧产品名、第三方角色名、硬编码散落颜色、占位符和敏感信息。
5. 运行 `git diff --check` 并确认不提交 `.bettercode/`。
6. 按 `checklist.md` 记录证据并标记结果。
7. 使用中文 Git 提交信息创建本大型 Plan 的阶段检查点。

**验证：** `pnpm check`、UI 专项矩阵、静态扫描和 `git diff --check` 均以退出码 0 完成，手工场景无终端残留状态。

## T26：移除底部状态栏

**文件：** `src/ui/status-bar.tsx`、`src/ui/status-bar.test.ts`、`src/ui/app.tsx`、`src/ui/app.test.ts`、`src/ui/render-harness.test.ts`

**依赖：** T19

**步骤：**

1. 删除 `status-bar.tsx` 与 `status-bar.test.ts`。
2. 删除 `App` 中的 `StatusBar` 渲染、`StatusBarState` 收集及仅用于底栏刷新的本地状态。
3. 更新 App 与受控终端测试，断言启动帧不再包含模型/模式/权限/会话状态文本。

**验证：** `pnpm exec tsx --test src/ui/app.test.ts src/ui/render-harness.test.ts`。

## T27：统一黑底文字色

**文件：** `src/ui/theme.ts`

**依赖：** T26

**步骤：**

1. `muted` 改为白色，弱化层级由 `dimColor` 叠加实现。
2. 保留品牌色、提示符与语义色的少量使用，不用于普通正文。

**验证：** `pnpm typecheck` 与 UI 专项测试。

## T28：增量验收与中文提交

**文件：** 本次增量涉及的全部文件

**依赖：** T26、T27

**步骤：**

1. 运行 `pnpm check`。
2. 检查启动帧无底栏状态文本，彩色终端普通文字为白/灰白。
3. 更新 `checklist.md` 增量条目并记录证据。
4. 使用中文 Git 提交信息创建检查点。

**验证：** `pnpm check` 退出码 0，`git diff --check` 通过。

## T29：输入光标指示

**文件：** `src/ui/input-box.tsx`、`src/ui/input-box.test.ts`

**依赖：** T26

**步骤：**

1. 聚焦且可用时在输入文本末尾渲染 `█`（Unicode）或 `_`（ASCII）。
2. 禁用或失焦时不渲染光标。

**验证：** InputBox 专项测试。

## T30：命令面板聚焦展开与更白文字

**文件：** `src/ui/input-box.tsx`、`src/ui/capabilities.ts`、`src/ui/capabilities.test.ts`、`src/ui/input-box.test.ts`

**依赖：** T29

**步骤：**

1. 新增 `truncateStart`：保留右缘并从左侧截断，超长时前缀省略号，可容纳时原样返回。
2. 聚焦候选行改用 `truncateStart` 展开完整描述，删除聚焦行下方补充行。
3. 未聚焦候选行颜色改为 `BETTERCODE_THEME.text` 并去掉 `dimColor`。
4. 新增测试：聚焦行同行包含完整描述、超长描述 55 列不越界、`truncateStart` 单测。

**验证：** InputBox 专项测试与全量 `pnpm check`。

## T31：像素文字启动横幅

**文件：** `src/ui/mascot.tsx`、`src/ui/mascot.test.ts`、`src/ui/theme.ts`

**依赖：** 无

**步骤：**

1. 删除虚拟形象字表，新增 5×7 与 3×5 两套像素字表。
2. 新增 `bannerLines(capabilities)`：按 BETTERCODE 逐行拼装，Unicode 用 `█`、ASCII 用 `#`，窄屏用紧凑字表。
3. `StartupBrand` 改渲染 `bannerLines`，品牌色改为 `#FFA500`。
4. 更新测试：横幅行数、宽度不越界、ASCII 无 Unicode、帧内包含 `█████` 且不再包含旧形象字符。

**验证：** mascot 专项测试、render-harness 55 列测试与全量 `pnpm check`。

## T32：立体横幅

**文件：** `src/ui/mascot.tsx`、`src/ui/mascot.test.ts`

**依赖：** T31

**步骤：**

1. 新增 `BEVELED_BANNER` 六行常量，按 ANSI Shadow 字表以 `█╗╔╚╝═║` 立体版式完整渲染 BETTERCODE。
2. `bannerLines` 在 Unicode 且宽度不小于 84 列时返回 `BEVELED_BANNER`，其余环境保留平面像素字降级。
3. 更新测试：立体横幅 6 行、每行不超过 120 列、包含 `█╗╔╚╝═` 字符且首行确为 BETTERCODE 字表；ASCII/窄屏断言不变。

**验证：** mascot 专项测试、render-harness 55 列测试与全量 `pnpm check`。

## T33：FIGfont 连贯字标组件

**文件：** `src/ui/wordmark.tsx`、`src/ui/mascot.tsx`、`src/ui/mascot.test.ts`、`package.json`

**依赖：** T32

**步骤：**

1. 引入 `figlet`，新增独立 `Wordmark` 组件并用 Slant controlled smushing 生成 BETTERCODE。
2. 将宽屏字标的生成、缓存、宽度判断和回退逻辑迁出 `mascot.tsx`。
3. 64 列以上非窄屏使用 5 行 ASCII 斜体字标，窄屏保持原紧凑像素字，FIGfont 失败回退预生成的同款 Slant 快照。
4. 更新字体特征、宽度、ASCII 兼容、窄屏、字体异常回退和启动帧测试。

**验证：** mascot 专项测试、render-harness 55 列测试、全量 `pnpm check` 与 `git diff --check`。

## T34：整体连通的立体字标

**文件：** `src/ui/wordmark.tsx`、`src/ui/theme.ts`、`src/ui/mascot.test.ts`

**依赖：** T33

**步骤：**

1. 将 Slant 整词渲染替换为 ANSI Shadow 逐字形渲染，保留每个字形的固定宽度和六行立体轮廓。
2. 在九个边界的错开行建立局部双单元亮面连接；连接前校验两侧实体，异常时回退同款静态快照。
3. 为主题增加深橘阴影色，`Wordmark` 将块面与箱线斜面分段着色。
4. 调整宽屏、80 列、ASCII 和窄屏选择策略，保证最大 83 列不换行。
5. 更新测试，验证九处连接、单连通分量、立体字符、无纯横梁、字体异常回退与三档终端降级。

**验证：** `pnpm typecheck`、全量 `pnpm test`、`pnpm check` 与 `git diff --check`。

## 执行顺序

```text
T1 -> T4 -> T5
 |     |    \
 |     |     -> T13
 |     -> T6 -> T7
 -> T2 -> T3 -> T8 -> T9 -> T10
                
T3 + T4 -> T11 -> T12
T4 -> T14 -> T15
          \-> T16 -> T17

T9 + T12 + T13 -> T18
T15 + T16 + T18 -> T19
T5 + T7 + T13 + T17 + T19 -> T20
T1 + T4 -> T21
T11 + T13 + T14 + T20 + T21 -> T22
T10 + T19 + T20 -> T23
T20 + T22 -> T24
T22 + T23 + T24 -> T25
```

T5、T6 和 T8 在各自依赖满足后可并行；T15 与 T17 共享交互和输入文件，应按编号串行；T18-T20 集中修改 `App`，必须串行执行，避免覆盖状态迁移。

## T35：原创单体像素 Logo 与启动动画

**文件：** `src/ui/startup-banner.tsx`、`src/ui/mascot.tsx`、`src/ui/theme.ts`、`src/ui/mascot.test.ts`、`package.json`、`pnpm-lock.yaml`

**依赖：** T34

**步骤：**

1. 删除 `wordmark.tsx`，移除 `figlet` 与 `@types/figlet`，新增不依赖字体引擎的 `LogoRenderer`。
2. 定义圆角 5×7 字模，以 4 列步长重叠相邻字符，并按九个错开高度计算真实连接路径。
3. 按像素暴露方向渲染 `█▓▒░` 浮雕层次，共享列渲染明暗接缝，整个 Logo 外轮廓只使用四个圆角收边。
4. 实现居中、动画开关、动画时长、Unicode/ASCII、横向缩放、逐行帧和 ANSI 差量帧 API。
5. `StartupBrand` 在动画完成后显示 BetterCode Agent、AI Coding Assistant、DeepSeek 与 Ready 四行状态。
6. 修复完成回调在状态更新函数中触发导致的 React 跨组件更新警告，并保证每轮动画只通知一次。
7. 更新结构、动画、受控终端和降级测试，运行全量验证与真实 120 列启动检查。

**验证：** mascot 专项测试、`pnpm check`、`git diff --check`、依赖残留扫描和真实 TUI 启动。

## T36：修正启动 Logo 可读性

**文件：** `src/ui/startup-banner.tsx`、`src/ui/mascot.test.ts`、`docs/ui-system/spec.md`、`docs/ui-system/plan.md`、`docs/ui-system/task.md`、`docs/ui-system/checklist.md`

**依赖：** T35

**步骤：**

1. 将重叠字模改为带独立字间负空间的 4×7 字模，宽屏输出固定为 98 列。
2. 限制连接器只写入字间空隙，并把连接层降为 `░`，避免覆盖主笔画和字腔。
3. 对圆角行间错位补低亮 `▒` 倒角，保证字形自身及完整 Logo 都是四向连通图。
4. 更新结构测试，锁定连接行、非连接行空白、整体宽度、居中位置和单连通分量。
5. 运行 UI 专项测试、全量检查和 120 列真彩终端手工验收。

**验证：** 19 项 UI 专项测试、`pnpm check`、`git diff --check` 与真实 TUI 启动。

## T39：Apple Terminal 再次加固

**文件：** `src/ui/capabilities.ts`、`src/ui/presentation-view.tsx`、`src/ui/markdown-view.tsx`、`src/ui/app.tsx`、`src/ui/activity-indicator.tsx`、对应测试、`docs/ui-system/spec.md`、`docs/ui-system/plan.md`、`docs/ui-system/task.md`、`docs/ui-system/checklist.md`

**依赖：** T38

**步骤：**

1. 在 `capabilities.ts` 新增 `wrapDisplay`，按显示宽度硬换行并保留原换行；扩展 `terminalSafeText` 覆盖全部破折号族字符。
2. `PresentationView` 与 `MarkdownView` 的纯文本/thinking 显示出口接入 `wrapDisplay`，保证流式长文本不形成超长单行。
3. `App` 流式合帧间隔按 Apple Terminal 分级为 120ms（其他终端 60ms）；`ActivityIndicator` 动画间隔分级为 500ms / 250ms。
4. 补充 `wrapDisplay` 边界、破折号族替换、长文本与长 thinking 不越界的专项测试。
5. 运行全量检查，并在真实 Apple Terminal 中复跑流式长回复与 `/session` 交互。

**验证：** UI 专项测试、`pnpm check`、`git diff --check` 与真实 Apple Terminal 回归。

## T38：终端崩溃加固与 Apple Terminal 安全渲染

**文件：** `src/index.tsx`、`src/ui/app.tsx`、`src/ui/activity-indicator.tsx`、`src/ui/capabilities.ts`、`src/ui/markdown-view.tsx`、`src/ui/presentation-view.tsx`、`src/ui/input-box.tsx`、`src/ui/interaction-panel.tsx` 及对应测试、`docs/ui-system/spec.md`、`docs/ui-system/plan.md`、`docs/ui-system/task.md`、`docs/ui-system/checklist.md`

**依赖：** T37

**步骤：**

1. 流式文本与 thinking 改为 60ms 合帧刷新，活动指示器动画频率降为 250ms。
2. `detectTerminalCapabilities` 增加 `TERM_PROGRAM` 检测与可选 `appleTerminal` 字段。
3. 新增 `terminalSafeText`，在 Apple Terminal 下把 U+2014/U+2013 替换为 ASCII。
4. 在 Markdown、对话、通知、输入框、命令候选与交互面板的显示出口接入安全替换，保持会话与 AST 原始数据不变。
5. `src/index.tsx` 注册未处理 Promise 拒绝与未捕获异常日志，写入 `.bettercode/logs/runtime-errors.log`。
6. 为能力检测、Markdown、对话、输入框与交互面板补充 Apple Terminal 安全渲染测试。
7. 运行全量检查，并在真实 Apple Terminal 中连续多轮复跑此前崩溃场景。

**验证：** UI 专项测试、`pnpm check`、`git diff --check` 与真实 Apple Terminal 多轮回归。

## T37：恢复整体连通横幅

**文件：** `src/ui/startup-banner.tsx`、`src/ui/mascot.test.ts`、`docs/ui-system/spec.md`、`docs/ui-system/plan.md`、`docs/ui-system/task.md`、`docs/ui-system/checklist.md`

**依赖：** T36

**步骤：**

1. 将字模恢复为 5×7 重叠布局，字符起点按 4 列递进，宽屏内容宽度回到 80 列。
2. 恢复九个错开高度的真实共享连接，连接列渲染为 `▒░` 明暗接缝，主笔画继续按暴露方向输出 `█▓▒░`。
3. 移除逐字母 `▄▀` 圆角替换，只保留整体外轮廓的 `╭╮╰╯` 圆角，保证没有贯穿整词的辅助横梁。
4. 更新结构测试，锁定 80 列宽度、共享连接列、单连通分量、居中位置与既有降级矩阵。
5. 运行 UI 专项测试、全量检查和 120 列真彩终端手工验收。

**验证：** 19 项 UI 专项测试、`pnpm check`、`git diff --check` 与真实 TUI 启动。
