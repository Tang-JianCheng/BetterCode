# cc-switch 适配 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [x] `cc_switch` 配置块可解析，非法字段与非法类型报错（验证：`pnpm test src/config/loader.test.ts`）
- [x] Claude 线读取 `~/.claude/settings.json` 生成 Anthropic Provider（验证：claude 专项测试）
- [x] Claude 线优先读取 `~/.cc-switch/cc-switch.db` 的全部供应商，数据库不可用时回退 settings.json（验证：database/loader 专项测试）
- [x] 同名供应商自动去重，名称唯一且可读（验证：loader 专项测试）
- [x] 文件缺失、key 缺失、model 缺失都产生诊断且不崩溃（验证：loader 专项测试）
- [x] Codex 等其它 cc-switch 来源完全不读取（验证：无相关依赖与读取代码，专项测试覆盖）

## 供应商选择

- [x] `cc_switch.enabled: true` 且文件可用时，启动使用导入供应商，`/status` 展示导入 base_url 与模型（验证：集成测试 + 手工 `/status`）
- [x] `--provider cc-switch.claude` 可显式选择 Claude 线（验证：集成测试）
- [x] 数据库导入后 `/model` 面板列出全部 cc-switch 供应商，当前激活项标为默认（验证：应用集成测试）
- [x] 导入失败时回退到 config.yaml 原 default provider（验证：集成测试）
- [x] 档位 env（`ANTHROPIC_DEFAULT_*_MODEL`）解析为 `model_tiers`，`[1M]` 换算为 1M 上下文，`_NAME` 作为显示名（验证：database/loader 专项测试）
- [x] `settings_config.model` 为档位名时正确记录激活档位（验证：database 专项测试）
- [x] `/model` 对带档位的 cc-switch Provider 展示 Sonnet/Opus/Fable/Haiku 与上下文窗口（验证：model-dialog / app 测试）
- [x] 档位切换后 `/status` 与后续请求使用新档位模型，未配置档位时报错不崩溃（验证：应用集成测试）

## Anthropic 兼容

- [x] `ANTHROPIC_AUTH_TOKEN` 走 Bearer 认证，`ANTHROPIC_API_KEY` 走 x-api-key（验证：anthropic 请求头测试）
- [x] `base_url` 带 `/v1` 时不会拼成 `/v1/v1/messages`（验证：anthropic 测试）
- [x] 诊断与日志中不出现 API key 明文（验证：读取测试断言）

## 编译与测试

- [x] `pnpm typecheck` 无错误
- [x] `pnpm test` 全量通过
- [x] `git diff --check` 通过

## 端到端场景

- [ ] 场景 1：cc-switch 中激活一个 Claude 供应商 → 重启 BetterCode → 自动使用该供应商，`/status` 显示对应 base_url 与模型
- [ ] 场景 2：`~/.claude/settings.json` 缺失或 key 缺失 → BetterCode 正常启动，显示诊断并回退 config.yaml 默认供应商
- [ ] 场景 3：`--provider deepseek-v4` 显式指定时，即使 cc-switch 已启用也使用指定供应商
- [ ] 场景 4：cc-switch 中配置多个 Claude 供应商 → 重启 BetterCode → `/model` 可见全部并可切换，当前激活项带标记
- [ ] 场景 5：cc-switch 当前供应商带 Sonnet/Opus/Haiku/Fable 档位与 1M 上下文 → 重启 BetterCode → `/model` 展示档位并可切换，`/status` 跟随
