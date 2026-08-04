# cc-switch 适配 Plan

## 架构概览

新增 `src/cc-switch/` 模块，作为 BetterCode 配置层的可选外部供应商来源。`bootstrap/application.ts` 在 `loadConfig()` 之后、`resolveProvider()` 之前调用 cc-switch 加载器，把导入成功的 Provider 合并进 `appConfig.providers`，并把结构化诊断传给 UI 展示。

- `types.ts`：`CcSwitchConfig`、诊断与导入结果类型。
- `claude.ts`：读取 `~/.claude/settings.json`，构建 Anthropic Provider。
- `loader.ts`：统一入口，负责导入 Provider、标记默认、生成诊断。
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

**职责：** 读取 Claude Code 的 cc-switch 配置并生成 Anthropic Provider。

**读取内容：**

- 路径：`<userHome>/.claude/settings.json`
- `env.ANTHROPIC_BASE_URL`：缺省 `https://api.anthropic.com`
- `env.ANTHROPIC_API_KEY` 或 `env.ANTHROPIC_AUTH_TOKEN`：二者至少一个，否则诊断并跳过
- `env.ANTHROPIC_MODEL`：存在则作为模型；否则使用 `cc_switch.claude.model`；两者都没有则诊断并跳过
- 认证方式：`ANTHROPIC_AUTH_TOKEN` 存在时 `authMode: 'bearer'`，否则 `'api-key'`
- `context_window` 与 `thinking` 来自配置覆盖或默认值

**Provider 命名：** 默认 `cc-switch.claude`，与现有 providers 冲突时诊断并跳过。

### loader.ts

**职责：** 单来源导入与默认标记。

1. `cc_switch` 未配置或 `enabled: false` 时直接返回空结果。
2. 读取 Claude 线，收集 Provider 与诊断。
3. 导入成功时把 Provider 合并进 providers，并标记为 `default: true`。
4. 返回 `provider` 与 `diagnostics`。

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
  → loadCcSwitchProviders(config)    // 读 ~/.claude/settings.json，产 Provider + 诊断
  → appConfig.providers.push(imported)
  → 标记 imported.default = true
  → resolveProvider(appConfig, providerName)   // --provider > imported > 原 default
  → createProvider(selected)
  → App(ccSwitchStatus=diagnostics)
```

## 文件组织

```
src/cc-switch/
├── types.ts
├── claude.ts
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
| 配置格式 | 不新增解析依赖 | settings.json 是标准 JSON，避免引入 TOML 解析器 |
| 命名冲突 | 诊断并跳过 | 避免 provider 名重复导致启动校验失败 |
| 失败策略 | fail-open | 外部工具文件不可用不影响 BetterCode 正常启动 |
| 认证优先级 | AUTH_TOKEN 存在用 Bearer，否则 x-api-key | 与 Claude Code 实际读取顺序一致 |

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
