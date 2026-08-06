# BetterCode 终端视觉与交互系统 Plan

## 架构概览

本章在现有业务层和 Ink 之间增加一个与渲染框架无关的展示模型层。命令、启动诊断和运行事件先生成结构化 `PresentationItem`，Ink 组件再根据终端能力、宽度和官方主题渲染。普通模型回复仍保持文本正文，不把大段对话强行卡片化。

界面拆成六个稳定区域：

```text
启动品牌区（只出现一次）
已完成内容历史
当前流式回复
活动或交互请求区
输入与补全区
自适应双层状态栏（始终位于活动界面底部）
```

`App` 继续负责事件编排，但不再直接拼接大段展示字符串。终端能力、状态栏压缩、虚拟形象、内容面板、活动反馈和交互焦点分别由独立模块负责。业务行为继续通过现有 `ChatManager`、`CommandDispatcher` 和权限决策器执行。

## 设计原则

1. **对话优先**：普通助手正文保持无厚重边框，装饰服务于扫描，不压过内容。
2. **状态稳定**：模型、模式和权限不随消息滚动消失，任何交互阶段都能看到。
3. **键盘优先**：现有快捷键保留，交互面板补齐方向键、Enter 和 Esc。
4. **渐进披露**：默认展示摘要，错误和需要行动的信息才展开细节。
5. **语义先于颜色**：图标、标题、文字和位置共同表达状态，无颜色也能辨认。
6. **克制动态**：动画只存在于当前活动区域，完成即停止。
7. **原创品牌**：虚拟形象和文案只使用 BetterCode 自有设计。

## 核心数据结构

### 结构化展示契约

```typescript
export type PresentationTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';

export type PresentationBlock =
  | { type: 'text'; content: string; muted?: boolean }
  | { type: 'key_value'; entries: readonly PresentationEntry[]; columns?: 1 | 2 }
  | { type: 'table'; columns: readonly PresentationColumn[]; rows: readonly string[][] }
  | { type: 'list'; items: readonly string[]; ordered?: boolean }
  | { type: 'divider' };

export interface PresentationDocument {
  kind: 'document';
  source: 'command' | 'system' | 'agent' | 'team';
  title: string;
  tone: PresentationTone;
  badge?: string;
  blocks: readonly PresentationBlock[];
  footer?: string;
}

export interface ConversationPresentation {
  kind: 'conversation';
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
}

export interface NoticePresentation {
  kind: 'notice';
  tone: PresentationTone;
  title: string;
  message?: string;
  details?: readonly string[];
  source?: string;
}

export type PresentationItem =
  | ConversationPresentation
  | PresentationDocument
  | NoticePresentation;
```

`PresentationItem` 放在中立目录，不依赖 React、Ink 或终端颜色。业务层只表达“是什么”，渲染层决定“怎么画”。

### 终端能力

```typescript
export type LayoutDensity = 'full' | 'compact' | 'narrow';

export interface TerminalCapabilities {
  columns: number;
  rows?: number;
  density: LayoutDensity;
  color: boolean;
  unicode: boolean;
  motion: boolean;
}

export interface TerminalEnvironment {
  columns?: number;
  rows?: number;
  isTTY?: boolean;
  term?: string;
  noColor?: boolean;
  forceAscii?: boolean;
  reduceMotion?: boolean;
  ci?: boolean;
}
```

密度阈值固定为：100 列及以上为 `full`，64 至 99 列为 `compact`，小于 64 列为 `narrow`。测试可显式注入环境，不直接修改全局 `process.stdout`。

### 官方主题

```typescript
export interface BetterCodeTheme {
  brand: string;
  accent: string;
  text: string;
  muted: string;
  border: string;
  success: string;
  info: string;
  warning: string;
  danger: string;
  selected: string;
}
```

本章只导出 `BETTERCODE_THEME`。无颜色模式返回同一语义接口，但颜色值不传给 Ink，组件不得自行散落硬编码色名。

### 活动状态

```typescript
export type ActivityStage =
  | 'preparing'
  | 'requesting_model'
  | 'thinking'
  | 'checking_permissions'
  | 'waiting_permission'
  | 'executing_tool'
  | 'compacting_context'
  | 'backgrounding';

export interface ActivityState {
  stage: ActivityStage;
  label: string;
  iteration?: number;
  maxIterations?: number;
  toolName?: string;
  startedAt: number;
}
```

动画帧不进入状态对象和对话历史，只由 `ActivityIndicator` 的局部计时器生成。

### 底栏状态

```typescript
export interface StatusBarState {
  providerName: string;
  model: string;
  agentMode: AgentMode;
  permissionMode: PermissionMode;
  usage?: TokenUsage;
  contextWindow?: number;
  sessionId: string;
  activeSkills: readonly string[];
  backgroundTasks: number;
  team?: {
    name: string;
    coordinator: boolean;
    pendingApprovals: number;
    unreadMessages: number;
  };
}

export interface StatusSegment {
  id: string;
  label: string;
  value: string;
  priority: number;
  minimumDensity: LayoutDensity;
  tone?: PresentationTone;
  required?: boolean;
}
```

模型、模式和权限段设置 `required: true`，布局器不得删除。模型值超长时按终端显示宽度截断，而不是按 JavaScript 字符数量截断。

### 交互焦点

```typescript
export type InteractionState =
  | { type: 'none' }
  | { type: 'permission'; request: PermissionRequest; selectedIndex: number }
  | { type: 'rewind'; phase: 'snapshot' | 'action'; selectedIndex: number }
  | { type: 'completion'; selectedIndex: number; itemCount: number };
```

`App` 保持单一顶层交互状态。输入框、权限面板和回滚面板根据该状态决定 `useInput` 是否激活。

## 模块设计

### `src/presentation/types.ts`

定义展示文档、块、表格列、键值项、通知和对话项。该模块不依赖 UI 框架，供命令系统、启动装配和 UI 共同使用。

### `src/presentation/builders.ts`

提供小型构造器和运行时校验：

- `createDocument(input)` 校验标题、块和表格列数。
- `createNotice(input)` 规范空正文和详情。
- `createConversation(input)` 保留模型原文。
- 拒绝空标题、表格列数不一致和无界详情数组。

构造器只保证结构合法，不负责终端宽度和颜色。

### `src/ui/theme.ts`

集中定义 BetterCode 官方主题和语义标记。建议视觉语义：

| 语义 | 表现 |
|---|---|
| 品牌 | 洋红与青色的少量组合，仅用于名称、形象细节和活动标记 |
| 正文 | 终端默认前景色 |
| 弱化 | 灰色或 dim，用于补充信息 |
| 成功 | 绿色与 `OK`/勾号 |
| 提示 | 青色与 `INFO`/圆点 |
| 警告 | 黄色与 `WARN`/感叹号 |
| 危险 | 红色与 `DENY`/叉号 |
| 选中 | 反色或高亮前缀，不只依赖颜色 |

无颜色和 ASCII 模式通过标记保留语义。

### `src/ui/capabilities.ts`

- 从 Ink stdout、环境变量和可注入测试环境计算 `TerminalCapabilities`。
- `NO_COLOR` 或非 TTY 禁用颜色。
- `TERM=dumb` 禁用颜色、Unicode 和动态效果。
- `BETTERCODE_ASCII=1` 强制 ASCII。
- `BETTERCODE_REDUCE_MOTION=1` 或 CI 禁用动画。
- 提供显示宽度、截断和安全拼接函数，按可见列数处理中文和组合字符。

显示宽度使用直接依赖 `string-width`，不依赖传递性安装。

### `src/ui/mascot.tsx`

- `StartupBrand` 渲染一次完整“小码”形象、BetterCode 名称、版本和欢迎语。
- `MascotMark` 根据活动、提示、警告和危险状态输出简化标记。
- Unicode 完整形象控制在 6 至 8 行，ASCII 版本保持相似轮廓和更窄宽度。
- 形象文本作为 BetterCode 原创资产进入源码，禁止引用第三方角色名称或台词。

### `src/ui/status-bar.tsx`

- `buildStatusSegments(state, capabilities)` 生成确定性段列表。
- `fitStatusSegments(segments, columns)` 先缩短标签、再截断值、最后移除非必要段。
- 第一层固定顺序：模型、模式、权限、可选团队。
- 第二层优先顺序：上下文/Token、缓存、会话、Skill、后台任务、团队提醒。
- 使用顶部细边界而非整块厚边框，与输入区形成连续工作区。
- `narrow` 模式允许两行核心状态，但每行宽度不得超过终端列数。

### `src/ui/presentation-view.tsx`

按 `PresentationItem.kind` 分发：

- `ConversationView`：用户提示符、助手正文和弱化思考区。
- `DocumentView`：标题行、可选 badge、块列表和 footer。
- `NoticeView`：短标题、有限详情和语义标记。
- `TableBlock`：完整模式按列对齐，紧凑模式转为逐项布局，窄屏转为名称加说明两行。
- `KeyValueBlock`：完整模式可双列，其他模式单列。

组件不解析正文中的伪标签，也不对模型输出进行命令识别。

### `src/ui/activity-indicator.tsx`

- 动态模式使用 Braille 帧，ASCII 模式使用 `|/-\\`。
- 默认约 100 毫秒更新一帧，只挂载一个计时器。
- 低动态模式显示静态圆点或 `...`。
- 展示简化形象标记、阶段、轮次和工具名；工具名按宽度截断。
- 卸载、取消、完成和错误时清理计时器。

### `src/ui/interaction-panel.tsx`

提供统一外框、标题、风险标记、选项列表和帮助行。`PermissionPrompt` 与 `RewindDialog` 复用该组件：

- 方向键循环或边界移动由各场景明确选择。
- Enter 提交当前项，Esc 返回或拒绝由场景定义。
- 单键权限快捷方式继续支持 `d/o/s/p`。
- 提交锁保证同一交互只回调一次。

### `src/ui/input-box.tsx`

- 增加官方主题、终端能力和焦点状态参数。
- 输入区使用稳定的顶部边界、品牌提示符和单行状态提示。
- disabled 状态显示活动提示，不创建第二个输入光标。
- 补全列表改用统一选中样式，并限制可见候选数。
- 候选区域预留稳定高度或使用上方区域，切换选中项不得推动底栏位置。

### `src/ui/message-list.tsx`

- 接收 `PresentationItem[]`，不再接收只有 role/content 的二元类型。
- 已完成历史、当前 thinking 和当前 streaming 分开渲染。
- 用稳定 key 替代数组下标，避免插入通知时组件错配。
- 动画状态不进入历史列表，避免每帧创建新历史对象。

### `src/command/types.ts`

在 `CommandUIController` 增加中立展示入口：

```typescript
showPresentation(item: PresentationItem): void;
```

保留 `showMessage` 作为普通短文本兼容入口，但内置状态类命令迁移到结构化入口。命令层只依赖 `src/presentation/types.ts`。

### `src/command/presenters.ts`

把本地命令数据转换为展示文档：

- `buildHelpDocument(registry, command?)`
- `buildStatusDocument(status)`
- `buildMemoryDocument(status)`
- `buildPermissionDocument(status)`
- `buildSessionDocument(current, sessions)`
- `buildTaskDocument(tasks, selected?)`
- `buildTeamDocument(result)`
- `buildCommandErrorNotice(command, message)`

`builtins.ts` 负责调用业务动作并交给 presenter，不再维护面向终端的列宽与空格。

### `src/ui/app.tsx`

- 启动时构造一次 `StartupBrand`，并把启动诊断转换为通知项。
- 将 `DisplayMessage[]` 替换为 `PresentationItem[]`。
- 将字符串 `progress` 替换为 `ActivityState`。
- 统一维护 `InteractionState`，确保只有活动面板消费按键。
- 收集 `StatusBarState` 并在所有状态分支之后始终渲染 `StatusBar`。
- Agent 事件转换为 activity 或 notice；普通最终文本转换为 conversation。
- `clear` 清除历史和活动状态但不重新创建启动品牌；恢复会话把消息转换为 conversation 项。
- 业务行为、取消控制器、权限 resolver 和命令 dispatcher 调用顺序保持不变。

### `src/ui/render-harness.test.ts`

建立受控终端渲染工具：

- 用可注入 stdout 列数和环境渲染组件。
- 捕获最后稳定帧并去除 ANSI 后检查显示宽度。
- 支持输入按键测试权限、补全和回滚焦点。
- 测试结束统一 unmount，检查没有残留计时器和句柄。

测试使用 `ink-testing-library` 作为开发依赖，文件保持 `.test.ts` 并通过 `React.createElement` 构造组件，继续匹配现有测试脚本。

## 模块交互

### 启动

```text
bootstrap application
  -> 收集 Provider/MCP/Skill/Agent/权限状态
  -> App 初始化 TerminalCapabilities
  -> StartupBrand
  -> startup diagnostics -> NoticePresentation[]
  -> InputBox
  -> StatusBar
```

### 普通对话与工具活动

```text
用户提交
  -> ConversationPresentation(user)
  -> AgentEvent progress/tool/permission
     -> ActivityState（仅活动区）
     -> Permission interaction（需要时）
  -> AgentEvent text/thinking
     -> 当前流式区域
  -> stopped
     -> ConversationPresentation(assistant)
     -> 清除 activity
  -> StatusBar usage 同步刷新
```

### 本地命令

```text
CommandDispatcher
  -> built-in handler 获取结构化业务数据
  -> command presenter
  -> PresentationDocument / NoticePresentation
  -> App.showPresentation
  -> PresentationView
```

### 响应式状态栏

```text
StatusBarState + TerminalCapabilities
  -> buildStatusSegments
  -> fitStatusSegments
     -> full: 双层完整
     -> compact: 双层缩写
     -> narrow: 核心状态 + 最小第二层或省略
  -> StatusBar render
```

## 文件组织

```text
src/
├── presentation/
│   ├── types.ts
│   ├── builders.ts
│   └── builders.test.ts
├── command/
│   ├── types.ts
│   ├── presenters.ts
│   ├── presenters.test.ts
│   └── builtins.ts
└── ui/
    ├── theme.ts
    ├── capabilities.ts
    ├── capabilities.test.ts
    ├── mascot.tsx
    ├── mascot.test.ts
    ├── status-bar.tsx
    ├── status-bar.test.ts
    ├── presentation-view.tsx
    ├── presentation-view.test.ts
    ├── activity-indicator.tsx
    ├── activity-indicator.test.ts
    ├── interaction-panel.tsx
    ├── interaction-panel.test.ts
    ├── input-box.tsx
    ├── input-box.test.ts
    ├── message-list.tsx
    ├── app.tsx
    ├── app.test.ts
    └── render-harness.test.ts
```

`package.json` 与锁文件增加 `string-width` 运行时依赖和 `ink-testing-library` 开发依赖。

## 测试设计

### 纯函数测试

- 终端能力识别、密度阈值和环境降级。
- Unicode/中文显示宽度与安全截断。
- 状态段优先级、必需段保留和行宽上限。
- 展示文档校验和命令 presenter 输出。
- 活动事件到阶段文案映射。

### 组件渲染测试

- 启动品牌 Unicode 与 ASCII 两种形态。
- 120、80、55 列的 help/status/permission/input/status bar 稳定帧。
- 无颜色帧去除 ANSI 后仍含必要语义。
- 普通回复不被卡片包裹，命令文档具有明确标题和边界。
- 完成或取消后活动指示不再变化。

### 交互测试

- 权限单键、方向键、Enter 和重复提交锁。
- 补全与回滚面板焦点独占。
- Ctrl+C、Ctrl+B 和输入历史回归。
- 模式、权限和 usage 更新后底栏立即变化。

### 集成与手工验收

- 使用受控 Provider 跑一次文本流、thinking、工具调用、权限请求和终态。
- 使用真实 TUI 运行 `/help`、`/status`、`/memory` 和未知命令。
- 分别在 120、80、55 列终端观察布局。
- 使用 `NO_COLOR=1` 与 `TERM=dumb` 启动并执行同一流程。
- 退出后确认光标、颜色和输入模式恢复。

## 技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 改造范围 | 组件化 TUI 工作台 | 从数据模型解决普通字符串无法精致展示的问题 |
| 品牌形象 | 原创蜡笔风“小码” | 满足亲和力与辨识度，同时规避第三方角色复制 |
| 主题数量 | 一套官方主题 | 集中打磨质量，避免本章演变成主题引擎 |
| 内容模型 | 中立结构化联合类型 | 命令和业务层不依赖 Ink，也不解析格式化字符串 |
| 普通回复 | 无厚重卡片 | 保持长文本阅读舒适和对话优先 |
| 状态栏 | 自适应双层、核心段必需 | 满足核心状态始终可见并兼容窄终端 |
| 宽度计算 | `string-width` 直接依赖 | 正确处理中文、全角字符和组合字符 |
| 动画 | 单局部计时器、约 100ms | 提供动态感并控制重绘和 CPU 占用 |
| 低动态 | 环境变量和 CI 自动关闭 | 便于无障碍、录制和稳定测试 |
| UI 测试 | 受控终端帧加交互测试 | 验证真实 Ink 输出而不只测试字符串 formatter |
| 兼容策略 | 保留业务调用顺序与快捷键 | 把风险限制在展示和焦点管理范围 |

## Spec 覆盖

| Spec | 设计归属 |
|---|---|
| F1 | `mascot.tsx`、启动装配 |
| F2、F3、F10 | `capabilities.ts`、`status-bar.tsx`、App 状态收集 |
| F4、F5、F6 | `presentation/types.ts`、presenters、presentation views |
| F7 | `ActivityState`、`activity-indicator.tsx` |
| F8 | `InteractionState`、`interaction-panel.tsx` |
| F9 | `input-box.tsx`、焦点管理 |
| F11 | `theme.ts`、所有语义组件 |
| F12 | 启动通知转换、fallback 渲染和 App 错误边界 |

所有功能需求均有明确模块归属，不存在未覆盖项。

## 增量：移除底栏与统一文字色

- 删除 `status-bar.tsx` 和 `status-bar.test.ts`；`App` 不再构造 `StatusBarState`，不再渲染 `StatusBar`。
- 移除仅用于底栏刷新的 `statusVersion`、本地 `agentMode` 与 `permissionMode` 展示状态；`agentModeRef` 和 `ChatManager` 的权限状态仍作为唯一业务事实源。
- `theme.ts` 将 `muted` 调整为白色，弱化层级由组件叠加 `dimColor` 实现，保证黑底终端下正文为白/灰白。
- `/status` 展示器继续提供分组运行信息，作为按需查询入口。

## 增量：输入光标

`InputBox` 在 `focused && !disabled` 时于输入文本末尾追加 `█`（Unicode）或 `_`（ASCII）作为可见光标；等待状态和权限面板期间不渲染，保持输入焦点语义清晰。

## 增量：命令面板聚焦展开与更白文字

- 命令面板聚焦行改为描述同行内联展开：右对齐到面板右缘，可容纳时完整展示，超长时 `truncateStart` 从左侧截断并保留省略号。
- 移除聚焦行下方的完整描述补充行，候选行统一单行渲染。
- 未聚焦候选行颜色改为纯白并去掉 `dimColor`，聚焦行保留 `inverse` 整行反色高亮。

## 增量：像素文字启动横幅

- 删除 `UNICODE_MASCOT` / `ASCII_MASCOT` 两套虚拟形象，新增 `PIXEL_FONT`（5 列 × 7 行）与 `PIXEL_FONT_NARROW`（3 列 × 5 行）两张像素字表。
- `bannerLines(capabilities)` 按 BETTERCODE 逐行拼装：Unicode 用 `█`，ASCII 用 `#`；窄屏用紧凑字表。
- `StartupBrand` 改渲染 `bannerLines`，版本与欢迎语保持原结构。
- `theme.ts` 品牌色改为 `#FFA500`，并允许 ThemeColor 携带该十六进制值。

## 增量：立体横幅

- 新增 `BEVELED_BANNER` 常量：按 ANSI Shadow 字表固定 6 行，完整渲染「BETTERCODE」。
- `bannerLines(capabilities)` 在 `unicode && !narrow && columns >= 84` 时直接返回 `BEVELED_BANNER`；其余环境继续走 `PIXEL_FONT`/`PIXEL_FONT_NARROW` 平面像素字降级。
- 立体横幅行宽约 83 列，84 列及以上终端均可完整容纳；80 列及以下终端与 55 列 ASCII 环境不受影响。

## 增量：FIGfont 连贯字标组件

- 新增 `wordmark.tsx`，把字标生成、宽度选择、降级与 Ink 绘制从 `mascot.tsx` 拆出，启动品牌不再维护手写宽屏字模。
- 引入 `figlet`，使用 Slant 字体和 controlled smushing 在模块加载时生成并缓存 BETTERCODE；渲染阶段只消费稳定行数组，不重复计算。
- 64 列以上非窄屏终端使用 5 行纯 ASCII 字标；窄屏复用原像素字体；FIGfont 异常回退预生成的同款 Slant 快照。
- 测试锁定字体行数、最大宽度、关键斜面、纯 ASCII、窄屏降级和启动帧，避免再次用装饰线或硬删间距伪造连接。

## 增量：整体连通的立体字标

- 保留独立 `Wordmark` 组件，但把生成策略从整词 Slant smushing 改为逐字渲染 ANSI Shadow；组合器保留每个字形的固定画布和完整轮廓。
- 为九个字间边界配置错开的连接行。组合阶段先校验边界两侧均有实体，再将相邻边缘转换为局部 `██` 亮面桥；任一字形高度、宽度或边界不符合预期即使用静态快照。
- `Wordmark` 按连续字符段渲染颜色：块面和连接使用 `brand`，箱线斜面使用新增的 `brandShadow`，以同一几何图形形成双明暗层次。
- 宽屏阈值按实际 83 列决定；Unicode 关闭或宽度不足时走现有像素字体，不让立体字符挤压或换行。
- 测试从字体外观特征升级为结构验证：九个连接坐标均为实体、所有非空字符只有一个四向连通分量、无纯横梁行、快照与动态生成一致。

## 风险与约束

- Ink 是流式终端渲染器，不是浏览器布局引擎；必须以稳定文本宽度和有限层级设计，不能依赖像素级定位。
- 长历史与活动动画共存时可能产生重绘压力，需确保动画状态局部化并通过稳定帧测试观察终端抖动。
- Unicode 虚拟形象在不同字体下宽度可能不同，必须提供 ASCII 版本并使用显示宽度测试。
- 底栏“常驻”指当前活动界面的最后区域，不承诺覆盖终端模拟器自身的滚动历史或系统状态栏。
- 结构化命令输出会改变 UI 控制器契约，必须同步更新所有假控制器和命令测试，避免业务行为回归。
- 对其他终端 Agent 只采纳可独立验证的通用交互原则，不复刻或声称复刻 Claude、Codex 的具体实现与视觉资产。

## 增量：原创单体像素 Logo 与启动动画

本增量以 `startup-banner.tsx` 取代 `wordmark.tsx` 和 FIGfont 路径，前文 T33/T34 的通用字体引擎方案只保留为历史记录，不再代表当前实现。

### 字形与连接算法

- 字形使用 5×7 二值矩阵；字符起点按 4 列递进，使相邻字符共享一个逻辑像素列，横向双倍渲染后完整内容为 80 列。
- 九个边界分别配置连接行。组合器从左右原始字形行中定位最近实体笔画并填充中间路径，避免从合并画布反推时把共享像素误判为单侧笔画。
- 共享列固定渲染为 `▒░`，形成连续但可辨认的字间明暗接缝；其余像素根据上、下、右侧暴露状态选择 `▓`、`▒`、`░` 或 `█`。
- 首行与末行只在整个 Logo 的最外侧替换四个圆角字符，不给每个字母单独套边框。

### 动画与 Ink 装配

- `LogoRenderer.animationFrames()` 生成空白帧、每行暗部帧和每行完整帧，共 15 帧；`ansiFrames()` 为独立终端调用方生成隐藏光标、清行、上移和恢复光标控制序列。
- `PixelLogo` 在 Ink 内保持固定画布逐帧替换，不直接向 stdout 追加内容。
- 动画计时 effect 只推进帧；独立完成 effect 观察末帧并通过 `useRef` 保证回调只触发一次，禁止在 React 状态更新函数内部更新父组件。
- `StartupBrand` 等 Logo 完成后再展示四行状态；关闭动画时立即展示最终 Logo 和状态。

### 兼容与验证

- Unicode 宽屏使用双倍横向像素；空间不足或 ASCII 环境自动使用单倍宽度和 `#`，仍保持 7 行和单体连接结构。
- 结构测试验证九个共享边界、单连通分量、无纯横梁、固定帧高、ANSI 光标控制、居中和降级。
- 受控 Ink 测试捕获 React 警告并验证完成通知仅一次；真实 120 列终端检查动画、颜色、状态和退出后的光标恢复。

## 增量：启动 Logo 可读性修正

本增量保留 `LogoRenderer`、动画 API 与 Ink 装配，只替换字形布局和连接拓扑。

### 可读字形布局

- 字模由重叠的 5×7 布局改为 4×7 字形加一个逻辑列字距，宽屏横向双倍渲染为 98 列。
- 字形画布与字间负空间分离：主笔画只由字模生成，连接器只能修改两个终端列宽的边界区域。
- 主笔画右侧暴露边使用 `▒`，减少稀疏 `░` 对字母轮廓的削弱；字间连接继续使用最暗的 `brandGhost`。

### 连通算法

- 先绘制所有字形，再扫描相邻行的一格错位；发现只有对角接触的圆角时，在上行补一个 `▒` 倒角单元。
- 倒角完成后按九个指定高度连接相邻字形，记录所有新增连接单元并单独着色。
- 结构测试同时验证 98 列宽度、九处边界负空间、其他行不被污染、单一四向连通分量和无纯横梁。

### 验证

- 运行 mascot、App 与受控终端共 19 项 UI 专项测试。
- 在 120 列真彩 TTY 中检查最终字样、逐行动画、颜色层次、状态出现时机和退出后的光标恢复。
- 运行 `pnpm check` 与 `git diff --check` 完成回归。

## 增量：整体连通横幅回归

本增量在保留 `LogoRenderer`、动画 API 与 Ink 装配的前提下，撤销可读性修正引入的过宽负空间，恢复重叠共享像素的整体连通方案。

### 字形与连接算法

- 字模恢复 5×7 二值矩阵，字符起点按 4 个逻辑列递进，相邻字形共享一个逻辑像素列；横向双倍渲染后完整内容为 80 列。
- 九个边界使用错开的连接行，从左右原始字形定位最近实体笔画并填充路径；共享列渲染为 `▒░` 明暗接缝，其余像素按上、下、右暴露方向输出 `▓`、`▒`、`░` 或 `█`。
- 首行与末行只在整体外轮廓替换四个圆角字符，不给每个字母单独套边框，也不新增贯穿整词的横梁。

### 装配与验证

- `PixelLogo`、逐行动画、ANSI 差量帧和完成通知逻辑保持不变；`bannerLines` 在 Unicode 宽屏继续使用双倍横向像素，窄屏与 ASCII 继续单倍和 `#` 降级。
- 结构测试锁定 80 列宽度、九处边界共享列、单连通分量、无纯横梁、固定 7 行与居中位置。
- 在 120 列真彩 TTY 中确认最终字样为 `BETTERCODE`、颜色为橘黄四档、字母整体连通且动画与光标恢复正常。
- 运行 `pnpm check` 与 `git diff --check` 完成回归。

## 增量：终端崩溃加固与 Apple Terminal 安全渲染

### 渲染频率与运行时保护

- `App` 内维护 `textRef`/`thinkingRef` 与 `STREAMING_FLUSH_INTERVAL_MS=60` 的合帧定时器：增量事件只写 ref，定时器到点才统一 `setState`；一轮结束与重启时清空定时器，保证最终帧不丢。
- `thinking_delta` 只触发一次“正在整理思路”活动态切换，避免每个 thinking token 都更新活动面板。
- `ActivityIndicator` 帧间隔 100ms 改为 250ms，低动态与 CI 保持静态标记。
- `src/index.tsx` 注册 `unhandledRejection`（记录后继续）与 `uncaughtException`（记录后退出），日志写入 `.bettercode/logs/runtime-errors.log`。

### 能力检测与显示安全

- `detectTerminalCapabilities` 读取 `TERM_PROGRAM`，仅在 `Apple_Terminal` 时返回 `appleTerminal: true`；普通终端不返回该字段，避免既有能力断言变化。
- `terminalSafeText` 是纯函数：非 Apple 终端原样返回，Apple 终端替换 `—`（U+2014）为 `--`、`–`（U+2013）为 `-`。
- 在 `MarkdownView`、`PresentationView`、`InputBox`、`InteractionPanel` 的显示文本出口统一调用；所有替换发生在渲染层，`renderMarkdown` 的 AST、会话 JSONL 与工具结果保持不变。

### 验证

- 能力检测测试覆盖 Apple Terminal 识别、非 Apple 终端不返回字段以及安全替换的正反向断言。
- Markdown、对话、输入框与交互面板专项测试验证破折号替换只发生在 Apple Terminal 能力下。
- 运行 UI 专项测试、`pnpm check` 与 `git diff --check`；在真实 Apple Terminal 中复跑此前触发崩溃的“你好”等回复，观察连续多轮不再关闭终端。

## 增量：Apple Terminal 再次加固

### 长行硬换行

- `capabilities.ts` 新增 `wrapDisplay(value, width)`：按 `Intl.Segmenter` 字素与 `string-width` 显示宽度做贪心换行，保留原换行语义，超宽单字素单独成行。
- `PresentationView` 的纯文本对话与 thinking、`MarkdownView` 的 thinking 都先经 `wrapDisplay` 拆成多行再渲染，行宽分别为 `columns - 2` 与 `columns - 4`（给前缀留边）。
- 硬换行只影响显示层，消息内容、会话存档与 Markdown AST 均不写入换行。

### 破折号族替换

- `terminalSafeText` 改为按 `DASH_LIKE_PATTERN` 统一处理：U+2014/U+2015/U+2E3A/U+2E3B 输出 `--`，U+2012/U+2013/U+2212/U+FE58/U+FE63 输出 `-`。
- 替换仍只在 `appleTerminal` 为真时发生，覆盖既有全部显示出口。

### 频率分级

- `App` 的合帧间隔改为按终端分级：Apple Terminal 120ms，其他终端 60ms；通过 `streamingFlushIntervalRef` 固定首帧读取，避免每次渲染重建定时器。
- `ActivityIndicator` 帧间隔按 `capabilities.appleTerminal` 分级：500ms / 250ms，低动态与 CI 仍为静态标记。

### 验证

- 新增 `wrapDisplay` 边界测试（ASCII、CJK、保留换行、超宽与空输入）与破折号族替换测试。
- PresentationView / MarkdownView 新增“长文本与长 thinking 每行不越界”测试，并断言内容不丢失。
- 运行 UI 专项测试、`pnpm check` 与 `git diff --check`；真实 Apple Terminal 复跑流式长回复与 `/session` 交互。

## 增量：不再展示思考过程内容

- `StreamCollector` 遇到 `thinking_delta` 直接丢弃，`CollectedTurn` 删除 `thinking` 字段，`AgentEvent` 删除 `thinking_delta` 变体。
- `App` 删除 `thinkingRef`、`currentThinking`、`isThinking` 与“正在整理思路”活动态；流式合帧只刷新正文。
- `MessageList`、`PresentationView`、`MarkdownView` 删除思考分区渲染，`ConversationPresentation` 删除 `thinking` 字段。
- Provider 协议层保留 `thinking_delta` 解析能力，但 Agent 层不再对外透传，避免 DeepSeek 等兼容接口的思考内容进入终端。

## 增量：Apple Terminal 系统级崩溃提示

- 启动诊断新增 `formatAppleTerminalStabilityNotice`：仅 Apple Terminal 返回提示，说明崩溃来自系统 Terminal/AppKit 菜单快捷键更新（切换输入法触发），并非 BetterCode 渲染，并给出 iTerm2 / VS Code 终端 / Warp 建议。

## 增量：终端 resize、工具折叠、状态行与主题

### resize 自适应

- `App` 监听 `stdout` 的 `resize` 事件触发重渲染，`capabilities` 每次渲染用 `stdout.columns` 重算；不改动检测逻辑，只补触发时机。

### 工具调用折叠视图

- 新增 `ToolTracePresentation` 与 `ToolTraceView`：折叠一行摘要、展开逐条明细，`live` 模式流式实时展示。
- `App` 在事件流中按 `callId` 累积工具轨迹，停止后折叠保留到消息列表；`InputBox` 增加 `onEmptyEnter`（空输入 Enter 切换轨迹），`toggleSignal` 自增信号穿透到消息列表。
- 拒绝类结果单独标记（`denied`），避免误导。

### 可开关状态行

- 新增 `/statusline` 命令与 `StatusLine` 组件，默认开启，切换显示在输入区底部（流式期间也常驻）；`/status` 一次性展示保留。
- 状态行展示当前上下文的真实占用与窗口容量（`上下文 <占用>/<容量>`，来自 `chatManager.getContextUsage` 的 `usedTokens` / `contextWindow`，紧凑 `k`/`m` 格式），消息或模式变化时刷新。

### 主题预设

- `theme.ts` 三套预设（dark/light/high-contrast），`BETTERCODE_THEME` 改 getter 转发；`config.yaml` 新增 `ui.theme` 校验；启动按 环境变量 `BETTERCODE_THEME` > `ui.theme` > `dark` 应用。

### 权限模式快捷键

- `RawInputParser` 将 Shift+Tab（`\x1b[Z`）拆分为独立 `shifttab` 事件；`InputBox` 新增 `onShiftTab`，`App` 循环切换权限模式 strict → default → allow。
