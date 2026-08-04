# /model 命令 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/command/types.ts` | `CommandUIController.showOrSwitchModel` |
| 修改 | `src/command/builtins.ts` | 注册 `/model` |
| 修改 | `src/bootstrap/application.ts` | `ProviderSummary`、`switchProvider`、`activeProvider` |
| 新建 | `src/ui/model-dialog.tsx` | 动态选择面板 |
| 修改 | `src/ui/app.tsx` | 活跃 Provider 状态与对话框集成 |
| 修改 | `src/index.tsx` | 传递新 props |
| 新建 | `src/ui/model-dialog.test.ts` | 面板交互测试 |
| 修改 | `src/ui/app.test.ts` | `/model` 全流程测试 |
| 修改 | `src/command/builtins.test.ts`、`dispatcher.test.ts` | 控制器桩补字段 |
| 修改 | `AGENTS.md` | 动态命令约束 |
| 修改 | `README.md` | 命令表与说明 |

## 状态

- [x] T1: 命令注册完成，`/model` 已进入命令目录。
- [x] T2: 应用层 Provider 切换完成，`activeProvider` 供 UI 与子 Agent 共用。
- [x] T3: ModelDialog 完成，交互与 `/session` 一致。
- [x] T4: App 集成完成，切换后后续请求与 `/status` 使用新 Provider。
- [x] T5: 文档与约束完成，README 已登记 `/model`。

## T1: 命令注册

1. `CommandUIController` 增加 `showOrSwitchModel(): void`。
2. `builtins.ts` 注册 `/model`，description `切换当前模型`，usage `/model`，type `ui`。
3. 更新命令测试桩。

**验证：** `pnpm test src/command/builtins.test.ts src/command/dispatcher.test.ts`。

## T2: 应用层 Provider 切换

1. 新增 `ProviderSummary`，`BetterCodeApplication.providers` 只含 name/model/base_url。
2. `createApplication` 维护 `activeProvider`，实现 `switchProvider(name)` 复用 `providerResolver` 缓存。
3. 子 Agent `defaultProvider` 改为 `() => activeProvider`。

**验证：** `pnpm typecheck`；bootstrap 测试补切换断言。

## T3: ModelDialog

1. 新建 `ModelDialog`，方向键选择、Enter 确认、Esc 退出。
2. 当前项 `[当前]` 标记，选中整行高亮，超过 9 个可滚动。
3. 左侧名称、右侧 `模型 · base_url`。

**验证：** `pnpm test src/ui/model-dialog.test.ts`。

## T4: App 集成

1. `App` 接收 `providers`、`switchProvider`，新增 `activeProvider` state。
2. 消息、Skill、压缩、状态全部改用活跃 Provider。
3. `showOrSwitchModel` 打开对话框，选择后切换并通知；只有 1 个 Provider 时提示。

**验证：** `pnpm test src/ui/app.test.ts`。

## T5: 文档与约束

1. `AGENTS.md` 增加动态命令约束。
2. `README.md` 命令表增加 `/model`。
3. 四份文档更新为最终状态。

**验证：** `pnpm check`、`git diff --check`。
