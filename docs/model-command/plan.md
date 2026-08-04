# /model 命令 Plan

## 架构概览

`application.ts` 负责 Provider 实例的创建与缓存，运行时切换通过它暴露的 `switchProvider(name)` 完成；`App` 持有 `activeProvider` 状态，所有模型请求都改用当前活跃 Provider。`/model` 命令通过 `CommandUIController.showOrSwitchModel()` 打开新的 `ModelDialog`，复用 `/session` 的动态选择器模式。

## 数据结构

```ts
interface ProviderSummary {
  name: string;
  model: string;
  base_url: string;
}

interface ModelOption {
  name: string;
  model: string;
  base_url: string;
}
```

## 模块设计

### application.ts

- 新增 `ProviderSummary` 导出类型。
- `BetterCodeApplication` 增加 `providers: readonly ProviderSummary[]` 与 `switchProvider(name: string): LLMProvider`。
- `createApplication` 内维护 `activeProvider`；`switchProvider` 复用已有 `providerResolver` 的缓存，切换后更新活跃实例。
- 子 Agent 的 `defaultProvider` 从固定 `provider` 改为 `() => activeProvider`，保证切换后子任务沿用新模型。
- `built.providers` 只暴露名称、模型、base_url，不带 API key。

### command/types.ts 与 command/builtins.ts

- `CommandUIController` 增加 `showOrSwitchModel(): void`。
- 注册 `/model` 命令：`type: 'ui'`，无参数，无别名。

### ui/model-dialog.tsx

- 新增 `ModelDialog` 交互组件：方向键、Enter、Esc，当前项标记、整行高亮、分页滚动。
- 行内容：左侧 Provider 名称，右侧 `模型 · base_url`。

### ui/app.tsx

- `App` 增加 `providers` 与 `switchProvider` props。
- 新增 `activeProvider` 状态，`sendAgentMessage`、`runSkill`、`compactConversation`、`showStatus` 全部改用活跃 Provider。
- 新增 `showOrSwitchModel` 与 `handleModelSelect`，接入 `CommandUIController` 与 `ModelDialog`。

## 模块交互

```
用户输入 /model
  → dispatcher → commandUi.showOrSwitchModel()
  → App 打开 ModelDialog
  → 选择 Provider → switchProvider(name) 更新 application 活跃 Provider
  → setActiveProvider(next) 更新 UI 状态
  → 后续 chatManager.run(...) 使用新 Provider
```

## 文件组织

```
src/command/types.ts         — CommandUIController 接口
src/command/builtins.ts      — /model 注册
src/bootstrap/application.ts — ProviderSummary + switchProvider + activeProvider
src/ui/model-dialog.tsx      — 动态选择面板
src/ui/app.tsx               — 状态与对话框集成
src/index.tsx                — 传递 providers / switchProvider
docs/model-command/*.md      — 本套文档
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 切换粒度 | Provider 列表 | 与现有配置结构一致，每个 Provider 一个模型 |
| 活跃状态位置 | application 内 `activeProvider` + App 内 state | 子 Agent 与 UI 都能拿到同一份最新选择 |
| 面板实现 | 独立 `ModelDialog` | 与 SessionDialog 复用同一套终端交互规范 |
| 敏感信息 | providers 摘要不含 api_key | 避免密钥进入 UI 层 |
