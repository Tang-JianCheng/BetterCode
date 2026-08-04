# cc-switch 适配 Plan

## 架构概览

新增 `src/cc-switch/` 模块，作为 BetterCode 配置层的可选外部供应商来源。`bootstrap/application.ts` 在 `loadConfig()` 之后、`resolveProvider()` 之前调用 cc-switch 加载器，把导入成功的 Provider 合并进 `appConfig.providers`，并把结构化诊断传给 UI 展示。

- `types.ts`：`CcSwitchConfig`、诊断与导入结果类型。
- `claude.ts`：读取 `~/.claude/settings.json` 或复用 env 块，构建 Anthropic Provider。
- `database.ts`：用 Node 内置 SQLite 读取 `~/.cc-switch/cc-switch.db` 的全部 Claude 供应商。
- `loader.ts`：统一入口，优先数据库导入、回退 settings.json，负责导入 Provider、标记默认、生成诊断。
- `config/loader.ts`：解析并校验 `cc_switch` 配置块。
- `provider/anthropic.ts`：新增 Bearer 认证与 `/v1` 归一化。
- `ui/app.tsx`：新增 cc-switch 启动诊断展示。

## 核心数据结构

### CcSwitchConfig

```ts
interface CcSwitchClaudeConfig {
  name: string;          // 导入后的 Provider 名，默认 cc-switch.claude
  model?: string;        // 模型覆盖；缺省时使用 ANTHROPIC_MODEL
  thinking?: boolean;
  context_window?: number;
}

interface CcSwitchConfig {
  enabled: boolean;               // 默认 true（配置块存在即启用）
  claude?: CcSwitchClaudeConfig;
}
```

### CcSwitchDiagnostic

```ts
interface CcSwitchDiagnostic {
  line: 'claude' | 'config';
  severity: 'info' | 'warning' | 'error';
  message: string;   // 不含密钥
}
```

### CcSwitchImportResult

```ts
interface CcSwitchImportResult {
  provider?: ProviderConfig;       // 导入成功的 Provider
  diagnostics: CcSwitchDiagnostic[];
}
```

## 模块设计

### claude.ts

**职责：** 把 cc-switch 的 env 块转换成 Anthropic Provider。

**输入：**

- `env.ANTHROPIC_BASE_URL`：缺省 `https://api.anthropic.com`
- `env.ANTHROPIC_API_KEY` 或 `env.ANTHROPIC_AUTH_TOKEN`：二者至少一个，否则诊断并跳过
- `env.ANTHROPIC_MODEL`：存在则作为模型；否则使用 `cc_switch.claude.model`；两者都没有则诊断并跳过
- 认证方式：`ANTHROPIC_AUTH_TOKEN` 存在时 `authMode: 'bearer'`，否则 `'api-key'`
- `context_window` 与 `thinking` 来自配置覆盖或默认值

`readClaudeProvider` 读取 `<userHome>/.claude/settings.json` 后复用同一转换；`buildClaudeProviderFromEnv` 供数据库路径按行调用。

### database.ts

**职责：** 读取 cc-switch 桌面版 SQLite 数据库。

- 路径：`<userHome>/.cc-switch/cc-switch.db`
- 查询 `app_type = 'claude'` 的 providers 行，解析 `settings_config.env`
- env 值支持 `${VAR}` 展开；`is_current` 与 `~/.cc-switch/settings.json` 的 `currentProviderClaude` 用于确定当前激活项
- 数据库缺失、Node 不支持 SQLite 或表结构异常时返回空列表，不抛异常

### loader.ts

**职责：** 多供应商导入与默认标记。

1. `cc_switch` 未配置或 `enabled: false` 时直接返回空结果。
2. 优先读取 `database.ts`；有可用供应商时逐行构建 Provider，按 cc-switch 原名去重命名。
3. 当前激活项标记 `default: true`，其余导入项保持非默认；导入前清空原 config.yaml 默认标记。
4. 数据库不可用或没有任何可用供应商时，回退读取 `~/.claude/settings.json` 的单供应商路径。
5. 返回当前激活 Provider 与诊断。

### config/loader.ts

- 解析 `cc_switch` 块：`enabled`、`claude`。
- 校验字段：`name` 非空字符串、`model` 可选字符串、`thinking` 可选布尔、`context_window` 可选正整数。
- 未知字段报错，与现有配置校验风格一致。

### provider/anthropic.ts

- `ProviderConfig` 增加可选 `authMode?: 'api-key' | 'bearer'`。
- `base_url` 归一化：去掉尾部 `/`；若以 `/v1` 结尾则去掉，再统一拼 `/v1/messages`，避免 `/v1/v1/messages`。
- 认证头：`api-key` 用 `x-api-key`，`bearer` 用 `Authorization: Bearer <key>`。

### ui/app.tsx

- `App` 新增可选 prop `ccSwitchStatus`（诊断数组）。
- 有诊断时生成启动 Notice（INFO/WARN），复用现有 startup 提示机制。

## 模块交互

```
createApplication()
  → loadConfig()                     // 解析 config.yaml，含 cc_switch
  → loadCcSwitchProviders(config)    // 读 cc-switch.db 全部 Claude 供应商，回退 settings.json
  → appConfig.providers.push(...imported)
  → 标记 current.active.default = true
  → resolveProvider(appConfig, providerName)   // --provider > cc-switch 当前激活 > 原 default
  → createProvider(selected)
  → App(ccSwitchStatus=diagnostics)
```

## 文件组织

```
src/cc-switch/
├── types.ts
├── claude.ts
├── database.ts
└── loader.ts
src/config/types.ts      — AppConfig.cc_switch
src/config/loader.ts     — 解析校验 cc_switch
src/config/resolver.ts   — 不变（合并后天然生效）
src/bootstrap/application.ts — 调用 loader、传诊断
src/provider/types.ts    — ProviderConfig.authMode
src/provider/anthropic.ts — Bearer + /v1 归一化
src/ui/app.tsx           — 启动诊断展示
config.yaml              — 增加注释示例块
docs/cc-switch/*.md      — 本四份文档
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 读取来源 | 仅 Claude 线 | 用户确认只适配 Claude，避免双线选择歧义 |
| 主数据源 | `~/.cc-switch/cc-switch.db` | cc-switch 全部供应商的权威存储；Node 内置 SQLite，不新增依赖 |
| 回退路径 | `~/.claude/settings.json` env 块 | 数据库缺失或不可用时仍可跟随当前激活供应商 |
| 命名冲突 | 按 cc-switch 原名去重 | 同名供应商追加短 ID，保证 `/model` 可区分且不重复 |
| 失败策略 | fail-open | 外部工具文件不可用不影响 BetterCode 正常启动 |
| 认证优先级 | AUTH_TOKEN 存在用 Bearer，否则 x-api-key | 与 Claude Code 实际读取顺序一致 |

## 增量：档位模型导入与 /model 档位切换

cc-switch 桌面版新版供应商的 `settings_config.env` 会带 `ANTHROPIC_DEFAULT_SONNET_MODEL` 等档位键。导入时把这些档位解析进 `ProviderConfig.model_tiers`，并把 `settings_config.model` 中的激活档位写入 `active_tier`，供 `/model` 面板按档位展示和切换。

### database.ts 增量

- 读取 `ANTHROPIC_DEFAULT_SONNET_MODEL` / `OPUS` / `HAIKU` / `FABLE` 与对应 `_NAME`。
- 值里的 `[1M]` / `[N K]` 后缀解析为 `context_window`，模型名去掉后缀；`_NAME` 非空时优先作为显示模型名。
- `settings_config.model` 为档位名（sonnet/opus/haiku/fable）时记录 `activeTier`。

### application.ts 增量

- `ProviderSummary` 增加 `model_tiers`、`active_tier`（不含密钥）。
- 新增 `switchModelTier(tier: ClaudeModelTier): LLMProvider`：用 `model_tiers[tier].model` 与 `context_window` 重建 Provider，更新 `active_tier`；档位缺失时报结构化错误。
- 切换 Provider 时同步更新 `active_tier` 为所选 Provider 的档位。
- 初始 Provider 与按名解析都按激活档位（缺省 Sonnet）取 `context_window`，避免启动时误报 128K 默认值；档位未标记上下文时仍回退默认窗口。

### ui/model-dialog.tsx 与 ui/app.tsx 增量

- `ModelDialog` 支持档位模式：档位列表非空时按 Sonnet/Opus/Fable/Haiku 渲染，右侧显示 `模型 · 上下文`，当前档位带 `[当前]` 标记。
- `App` 增加 `switchModelTier` prop 与 `handleTierSelect`，档位切换后刷新活跃 Provider 并提示 `模型已切换`。
- `showOrSwitchModel` 分流：当前 Provider 有档位映射时打开档位面板，否则保持原 Provider 列表。

### 新增测试

- 档位解析：`[1M]` 上下文换算、`_NAME` 显示名、激活档位。
- 应用集成：`switchModelTier('opus')` 返回 1M 上下文的 Provider，未配置档位抛错。
- UI：档位面板展示、Enter 切换、无档位时仍走 Provider 列表。

## 配置示例

```yaml
cc_switch:
  enabled: true
  claude:
    name: cc-switch.claude
    model: claude-sonnet-5-20251001
    thinking: false
    context_window: 200000
```
