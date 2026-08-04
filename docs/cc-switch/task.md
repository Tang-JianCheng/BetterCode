# cc-switch 适配 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/cc-switch/types.ts` | 配置、诊断、导入结果类型 |
| 新建 | `src/cc-switch/claude.ts` | Claude 线读取 |
| 新建 | `src/cc-switch/database.ts` | cc-switch SQLite 数据库读取 |
| 新建 | `src/cc-switch/loader.ts` | 统一入口与默认标记 |
| 新建 | `src/cc-switch/database.test.ts` | 数据库读取专项测试 |
| 修改 | `src/config/types.ts` | `AppConfig.cc_switch` 与 `authMode` |
| 修改 | `src/config/loader.ts` | 解析校验 `cc_switch` |
| 修改 | `src/provider/anthropic.ts` | Bearer 认证与 `/v1` 归一化 |
| 修改 | `src/bootstrap/application.ts` | 调用 loader、传诊断 |
| 修改 | `src/ui/app.tsx` | cc-switch 启动诊断展示 |
| 修改 | `config.yaml` | 注释示例块 |
| 新建 | `src/cc-switch/*.test.ts` | 各模块测试 |
| 修改 | `src/config/types.ts` | `ClaudeModelTier`、`ModelTierConfig`、`model_tiers`、`active_tier` |
| 修改 | `src/cc-switch/database.ts` | 解析档位模型与上下文窗口 |
| 修改 | `src/cc-switch/claude.ts` | Provider 写入档位元数据 |
| 修改 | `src/bootstrap/application.ts` | `switchModelTier` 与档位摘要 |
| 修改 | `src/ui/model-dialog.tsx` | 档位模式展示 |
| 修改 | `src/ui/app.tsx` | 档位切换与通知 |
| 修改 | `src/index.tsx` | 传递 `switchModelTier` |

## T1: 类型与配置解析

**文件：** `src/cc-switch/types.ts`、`src/config/types.ts`、`src/config/loader.ts`
**依赖：** 无

1. 定义 `CcSwitchClaudeConfig`、`CcSwitchConfig`、`CcSwitchDiagnostic`、`CcSwitchImportResult`。
2. `ProviderConfig` 增加 `authMode?: 'api-key' | 'bearer'`。
3. `AppConfig` 增加可选 `cc_switch?: CcSwitchConfig`。
4. `loadConfig` 解析并校验 `cc_switch`：`enabled` 布尔（缺省 true）、`claude.name` 非空、`model` 可选字符串、`thinking` 可选布尔、`context_window` 可选正整数，未知字段报错。
5. 补充 loader 测试：合法块、非法枚举、未知字段、缺省 enabled。

**验证：** `pnpm test src/config/loader.test.ts` 通过；`pnpm typecheck` 通过。

## T2: Claude 线读取

**文件：** `src/cc-switch/claude.ts`
**依赖：** T1

1. 实现 `readClaudeProvider(userHome, environment, options)`。
2. 读取 `<userHome>/.claude/settings.json` 的 `env`。
3. `ANTHROPIC_API_KEY` 与 `ANTHROPIC_AUTH_TOKEN` 至少一个，否则诊断跳过。
4. `ANTHROPIC_MODEL` 或 `options.model` 二选一，缺则诊断跳过。
5. 返回 `ProviderConfig`（protocol anthropic、authMode 按 token 判定、base_url 缺省官方端点）。
6. 补充测试：api-key、bearer、缺 key、缺 model、文件缺失、base_url 带 `/v1`。

**验证：** `pnpm test src/cc-switch/claude.test.ts` 通过。

## T3: 统一 loader 与默认标记

**文件：** `src/cc-switch/loader.ts`
**依赖：** T2

1. `cc_switch` 未配置或 `enabled: false` 时返回空结果。
2. 读取 Claude 线，收集 Provider 与诊断。
3. 导入成功后把 Provider 标记为 `default: true`。
4. 命名冲突（`cc-switch.claude` 已在 providers 中）诊断跳过。
5. 补充测试：关闭、成功、冲突、文件缺失、key/model 缺失。

**验证：** `pnpm test src/cc-switch/loader.test.ts` 通过。

## T4: Anthropic Provider 认证与归一化

**文件：** `src/provider/anthropic.ts`
**依赖：** T1

1. 构造时按 `authMode` 选择 `x-api-key` 或 `Authorization: Bearer`。
2. `base_url` 若以 `/v1` 结尾则先去掉，再拼 `/v1/messages`。
3. 补充测试：api-key、bearer、`/v1` 结尾、普通结尾、请求头断言。

**验证：** `pnpm test src/provider/anthropic.test.ts` 通过。

## T5: 应用集成与 UI 诊断

**文件：** `src/bootstrap/application.ts`、`src/ui/app.tsx`
**依赖：** T3、T4

1. `createApplication` 在 `resolveProvider` 前调用 `loadCcSwitchProviders`。
2. 导入 Provider 合并进 `appConfig.providers`，并标记 `default: true`。
3. `--provider` 仍走 `resolveProvider` 优先匹配。
4. `App` 接收 `ccSwitchStatus`，有诊断时渲染启动 Notice。
5. 补充集成测试：临时 home 下 settings.json 生效、诊断展示、回退不崩溃。

**验证：** `pnpm test src/bootstrap/application.test.ts src/ui/app.test.ts` 通过。

## T6: 配置示例与文档收尾

**文件：** `config.yaml`、`README.md`、`docs/cc-switch/*.md`
**依赖：** T5

1. `config.yaml` 增加注释掉的 `cc_switch` 示例块。
2. README 增加 cc-switch 适配章节：启用方法、读取来源、重启生效说明。
3. 更新四份文档为最终状态。

**验证：** 文档 diff 无遗留 TODO；`pnpm check` 与 `git diff --check` 通过。

## T7: 全部 Claude 供应商导入

**文件：** `src/cc-switch/database.ts`、`src/cc-switch/claude.ts`、`src/cc-switch/loader.ts`
**依赖：** T2、T3

1. 新增 `readClaudeProviderRows`：用 Node 内置 SQLite 读取 `~/.cc-switch/cc-switch.db` 的 `app_type='claude'` 供应商，解析 `settings_config.env` 并展开 `${VAR}`。
2. `claude.ts` 抽出 `buildClaudeProviderFromEnv`，settings.json 与数据库路径共用同一转换。
3. `loader.ts` 优先数据库导入全部 Claude 供应商，当前激活项（`currentProviderClaude` / `is_current`）标为默认，同名供应商自动去重。
4. 数据库不可用或没有可用供应商时回退原 settings.json 单供应商路径。
5. 补充测试：数据库行解析、缺失回退、多供应商导入、同名去重、应用集成。

**验证：** `pnpm test src/cc-switch/database.test.ts src/cc-switch/loader.test.ts src/bootstrap/application.test.ts` 通过。

## T8: 数据库导入文档收尾

**文件：** `config.yaml`、`README.md`、`docs/cc-switch/*.md`
**依赖：** T7

1. `config.yaml` 注释改为数据库导入说明，移除只在回退路径生效的 `name` 示例。
2. README 更新读取来源、`/model` 切换与重启生效说明。
3. spec/plan/task/checklist 按增量方式补充数据库导入内容。

**验证：** `pnpm check` 与 `git diff --check` 通过。

## 执行顺序

```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9
```

## 完成状态

- T1 类型与配置解析：已完成，含 loader 校验与专项测试。
- T2 Claude 线读取：已完成，`src/cc-switch/claude.ts` 与专项测试。
- T3 统一 loader 与默认标记：已完成，`src/cc-switch/loader.ts` 与专项测试。
- T4 Anthropic Provider 认证与归一化：已完成，Bearer / x-api-key / `/v1` 测试覆盖。
- T5 应用集成与 UI 诊断：已完成，`createApplication` 集成测试与启动 Notice 渲染测试。
- T6 配置示例与文档收尾：已完成，`config.yaml` 注释示例、README 章节与本套文档。
- T7 全部 Claude 供应商导入：已完成，`database.ts` 读取 cc-switch.db，loader 优先导入全部并回退 settings.json。
- T8 数据库导入文档收尾：已完成，config.yaml、README 与本套文档按增量补充。
- T9 档位模型导入与 /model 档位切换：已完成，`switchModelTier` 与档位面板测试覆盖。

## T9: 档位模型导入与 /model 档位切换

**文件：** `src/config/types.ts`、`src/cc-switch/database.ts`、`src/cc-switch/claude.ts`、`src/cc-switch/loader.ts`、`src/bootstrap/application.ts`、`src/ui/model-dialog.tsx`、`src/ui/app.tsx`、`src/index.tsx`
**依赖：** T7

1. `ProviderConfig` 增加 `model_tiers`、`active_tier`，`database.ts` 解析 `ANTHROPIC_DEFAULT_*_MODEL` / `_NAME` 与 `[1M]` 上下文标记。
2. `buildClaudeProviderFromEnv` 接收档位与激活档位并写入 Provider。
3. `createApplication` 增加 `switchModelTier(tier)`，用档位模型与上下文重建 Provider，未配置档位时报错。
4. `ModelDialog` 支持档位模式，`/model` 对带档位映射的 Provider 展示 Sonnet/Opus/Fable/Haiku 与上下文窗口。
5. 补充测试：tier 解析、应用切换、档位面板与 `/model` 全流程。

**验证：** `pnpm test src/cc-switch/database.test.ts src/cc-switch/loader.test.ts src/bootstrap/application.test.ts src/ui/model-dialog.test.ts src/ui/app.test.ts` 通过。
