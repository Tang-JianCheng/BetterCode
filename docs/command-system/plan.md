# BetterCode 命令系统 Plan

## 架构概览

新增 `src/command/` 作为与渲染框架无关的命令域层。`CommandRegistry` 负责注册和查找，`parseCommandInput` 只负责语法拆分，`CommandDispatcher` 负责把解析结果交给处理函数，`createDefaultCommandRegistry` 统一登记内置命令。Ink `App` 实现 `CommandUIController`，输入框通过注册中心提供的补全函数展示候选。

普通任务发送逻辑从 `App.sendMessage` 中抽成可复用的 `sendAgentMessage`。回车时先记录 Prompt 历史，再调用 dispatcher；只有返回 `not_command` 时才调用 `sendAgentMessage`。提示词命令通过控制器调用同一个发送函数，因此仍进入完整 Agent Loop，但用户界面显示原始斜杠命令。

## 核心数据结构

```typescript
export type CommandType = 'local' | 'ui' | 'prompt';

export interface CommandDefinition {
  name: string;
  aliases: readonly string[];
  description: string;
  usage: string;
  type: CommandType;
  argumentHint?: string;
  hidden?: boolean;
  handler(invocation: CommandInvocation): void | Promise<void>;
}

export interface ParsedCommand {
  raw: string;
  name: string;
  args: string;
}

export interface CommandInvocation extends ParsedCommand {
  definition: CommandDefinition;
  registry: CommandRegistry;
  ui: CommandUIController;
}

export type DispatchResult =
  | { status: 'not_command' }
  | { status: 'handled'; command: string }
  | { status: 'unknown'; command: string };
```

```typescript
export interface CommandUIController {
  showMessage(content: string): void;
  sendUserMessage(content: string, displayText?: string): Promise<void>;
  setAgentMode(mode: AgentMode): void;
  getAgentMode(): AgentMode;
  getTokenUsage(): TokenUsage | undefined;
  refreshStatus(): void;
  clearConversation(): Promise<void>;
  compactConversation(): Promise<void>;
  showOrResumeSession(sessionId?: string): Promise<void>;
  showMemoryStatus(): void;
  showOrSetPermission(mode?: string): void;
  showStatus(): void;
  rewindConversation(): void;
  exit(): void;
}
```

## 模块设计

### `src/command/types.ts`

定义命令元数据、解析结果、控制器接口、分发结果和补全候选。该文件只依赖 Agent、Provider 的类型，不依赖 React 或 Ink。

### `src/command/registry.ts`

- `register(definition)` 校验主名称和别名格式，规范化为小写。
- 用单一 `Map<string, CommandDefinition>` 同时索引主名称和别名。
- 冲突时抛出包含冲突 token 与双方主名称的错误。
- `list({ includeHidden })` 保持注册顺序。
- `complete(input)` 用命令名和别名前缀匹配，按主命令去重，隐藏命令直接过滤。

### `src/command/parser.ts`

- `parseCommandInput(input)` 对空输入与非 `/` 输入返回对应状态。
- 使用首段非空白字符作为名称，参数保留内部空格、去除首尾空白。
- 只做语法解析，不查注册中心。

### `src/command/dispatcher.ts`

- 非命令返回 `not_command`。
- 查不到命令时调用 `ui.showMessage` 输出 `/help` 引导并返回 `unknown`。
- 命中后构造 invocation 并 await handler。
- handler 抛错时显示规范错误并返回 `handled`，不向外抛到 Ink 渲染循环。

### `src/command/builtins.ts`

`createDefaultCommandRegistry()` 注册十个主命令和两个隐藏兼容命令。帮助文本由可见元数据动态生成，不维护第二份硬编码列表。

| 主命令 | 类型 | 关键行为 | 别名 |
|--------|------|----------|------|
| help | local | 展示可见命令、用法和参数提示 | h, ? |
| compact | ui | 触发手动上下文压缩 | 无 |
| clear | ui | 清空会话并刷新界面 | reset |
| plan | ui | 切换 `plan` 模式 | p |
| do | ui | 切换 `act` 模式 | d |
| session | ui | 显示或恢复会话 | s, resume, r |
| memory | local | 显示两级记忆状态 | m |
| permission | ui | 显示或切换权限模式 | permissions, perm |
| status | local | 展示综合状态并刷新 | st |
| review | prompt | 发送固定审查提示词 | rv |

隐藏兼容命令为 `rewind` 和 `exit`，其中 `quit` 是 `exit` 的别名。

### `src/ui/input-box.tsx`

增加可选 `complete(input)` 回调和补全菜单状态。Tab 获取候选：零候选不动作，单候选写回规范命令并追加空格，多候选显示最多若干条菜单；菜单打开时上下键移动、Enter 选中、Esc 关闭。普通输入和历史导航会关闭旧菜单。

### `src/ui/app.tsx`

- 创建默认 registry 与 dispatcher。
- 用 `useMemo` 构造控制器，控制器方法桥接现有 ChatManager、Provider 和 React 状态。
- `agentMode` 为会话级状态，配套 ref 避免异步闭包读到旧值。
- Header 增加 `[DEFAULT]` / `[PLAN]`。
- 删除 `sendMessage` 中的斜杠条件链，只保留分流与普通 Agent 发送。

## 模块交互

```text
InputBox Enter
  -> App.handleSubmit(raw)
     -> prompt history
     -> CommandDispatcher.dispatch(raw, ui)
        -> not_command -> App.sendAgentMessage(raw, currentMode)
        -> handled     -> built-in handler -> CommandUIController
        -> unknown     -> showMessage + /help guidance

InputBox Tab
  -> CommandRegistry.complete(input)
     -> 0: no-op
     -> 1: canonical completion
     -> N: completion menu
```

## 文件组织

```text
src/command/
  types.ts
  parser.ts
  parser.test.ts
  registry.ts
  registry.test.ts
  dispatcher.ts
  dispatcher.test.ts
  builtins.ts
  builtins.test.ts
src/ui/
  app.tsx
  app.test.ts
  input-box.tsx
  input-box.test.ts
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 冲突处理 | 注册时同步抛错 | 启动即失败，避免运行期随机命中 |
| 模式语义 | `/plan` 与 `/do` 只切状态 | 与本章要求一致，普通输入自然继承模式 |
| 旧命令 | 通过别名或隐藏命令兼容 | 不破坏记忆系统和退出工作流 |
| UI 解耦 | 控制器接口而非 React 回调散传 | 命令可用假控制器独立测试 |
| 帮助来源 | 注册元数据动态生成 | 防止帮助文本与真实命令漂移 |
| 补全目标 | 别名匹配后写回主命令 | 提升可发现性并保持输入规范 |
| 提示词命令 | 调同一 Agent 发送函数 | 保留流式事件、权限与上下文管理 |

## Spec 覆盖

F1-F4 由 registry/parser/dispatcher 覆盖；F5-F7 由类型、控制器和 App 分流覆盖；F8 由 registry 与 InputBox 覆盖；F9-F15 由 builtins 与 App 控制器覆盖。不存在未归属需求。
