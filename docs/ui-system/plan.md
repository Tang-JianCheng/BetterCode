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

## 风险与约束

- Ink 是流式终端渲染器，不是浏览器布局引擎；必须以稳定文本宽度和有限层级设计，不能依赖像素级定位。
- 长历史与活动动画共存时可能产生重绘压力，需确保动画状态局部化并通过稳定帧测试观察终端抖动。
- Unicode 虚拟形象在不同字体下宽度可能不同，必须提供 ASCII 版本并使用显示宽度测试。
- 底栏“常驻”指当前活动界面的最后区域，不承诺覆盖终端模拟器自身的滚动历史或系统状态栏。
- 结构化命令输出会改变 UI 控制器契约，必须同步更新所有假控制器和命令测试，避免业务行为回归。
- 对其他终端 Agent 只采纳可独立验证的通用交互原则，不复刻或声称复刻 Claude、Codex 的具体实现与视觉资产。
