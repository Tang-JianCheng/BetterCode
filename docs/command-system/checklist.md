# BetterCode 命令系统 Checklist

> 每项以自动化命令输出或可观察的终端行为为证据。

## 实现完整性

- [x] 注册中心包含完整元数据、统一索引、稳定列表和隐藏过滤。（证据：registry 单测通过）
- [x] 名称与别名冲突在注册阶段同步抛错。（证据：名称、跨命令别名、命令内重复三类用例通过）
- [x] 解析器支持大小写不敏感、参数拆分、空输入与普通输入早返回。（证据：parser 单测通过）
- [x] 分发器区分普通、已处理、未知命令并隔离 handler 异常。（证据：dispatcher 单测通过）
- [x] 控制器接口不依赖 React 或 Ink。（证据：`rg` 扫描 `src/command` 无运行时 import）
- [x] 十个主命令完整登记，帮助文本由注册元数据生成。（证据：builtins 与 App 帮助测试通过）
- [x] 隐藏兼容命令不出现在帮助和补全中，但仍可直接执行。（证据：builtins/registry 单测通过）

## 集成

- [x] 回车入口先执行命令分流，普通输入才调用 Agent。（证据：App 单入口分支与 dispatcher 测试通过）
- [x] `/plan` 切换 `[PLAN]`，普通任务使用只读工具；`/do` 切回 `[DEFAULT]`。（证据：builtins 模式测试与既有 Plan Mode 工具测试通过）
- [x] `/review` 发送固定审查提示词并保留命令作为显示文本。（证据：假控制器断言通过）
- [x] `/session` 与旧 `/resume` 均能列出或恢复会话。（证据：别名注册与会话恢复测试通过）
- [x] `/permission` 与旧 `/permissions` 均能显示或切换权限。（证据：别名注册与权限状态测试通过）
- [x] `/status` 包含 Provider、Agent 模式、权限、会话、Token 和记忆信息。（证据：综合状态格式测试通过）
- [x] `/compact`、`/clear`、`/memory` 绕过普通 Agent 发送。（证据：假控制器调用计数通过）
- [x] `/rewind`、`/exit`、`/quit` 保持可用。（证据：隐藏命令与别名测试通过）

## 补全

- [x] 唯一前缀 Tab 直接补为规范主命令。（证据：补全状态单测通过）
- [x] 共享前缀 Tab 返回多个稳定候选并显示菜单。（证据：registry 与 InputBox 测试通过）
- [x] 别名前缀可命中主命令且候选不重复。（证据：registry 单测通过）
- [x] 隐藏命令不参与补全。（证据：registry 单测通过）
- [x] 菜单支持上下选择、Enter 确认、Esc 关闭。（证据：状态转换与组件分支通过类型检查）

## 编译与测试

- [x] `pnpm typecheck` 无错误。（证据：2026-07-29 验收通过）
- [x] `pnpm test` 全部通过，无既有功能回归。（证据：216/216 通过）
- [x] `git diff --check` 无空白错误。（证据：命令退出码 0）
- [x] `rg -n '/plan <任务>|执行最近成功生成的计划' src/ui README.md` 无旧语义残留。（证据：无输出）

## 端到端场景

- [x] 场景 1：输入 `/HELP`，立即显示十个主命令，Provider 不被调用。（证据：大小写分发与动态帮助测试通过）
- [x] 场景 2：输入 `/plan` 后状态栏显示 `[PLAN]`，输入普通任务只暴露读工具；输入 `/do` 后恢复 `[DEFAULT]` 和完整工具。（证据：模式标记、内置命令和 Agent Loop Plan Mode 测试通过）
- [x] 场景 3：输入 `/review src/chat`，界面显示原命令，模型收到包含范围和审查准则的预设任务。（证据：review 假控制器测试通过）
- [x] 场景 4：输入 `/ses` 后按 Tab 补成 `/session `；输入能匹配多个命令的前缀时出现选择菜单。（证据：补全解析与菜单状态测试通过）
- [x] 场景 5：输入 `/missing`，显示未知命令和 `/help` 引导，随后仍可正常发送普通任务。（证据：dispatcher 未知与普通输入测试通过）
- [x] 场景 6：输入 `/session <id>`、`/permission strict`、`/compact` 和 `/clear`，各自复用原有能力且不进入普通对话分支。（证据：builtins 假控制器与既有 ChatManager 测试通过）

## 增量：/session 交互选择器与会话摘要

- [x] `/session` 无参数打开交互选择器，方向键选择、Enter 恢复、Esc 退出。（验证：SessionDialog 与 App 集成测试；覆盖 AC11）
- [x] Delete/Backspace 删除选中会话并即时刷新列表，当前会话删除被拒绝。（验证：SessionDialog 与 App 删除测试；覆盖 AC12）
- [x] 会话描述使用 `session_summary` 摘要，旧会话回退最近用户消息，不再显示首条任务。（验证：session 列表测试；覆盖 AC13）
- [x] 摘要持久化为 `session_summary` 系统记录且更新替换旧记录，不影响恢复与压缩重建。（验证：session 单测与 manager 恢复测试；覆盖 AC14）

**验收记录：**

- 专项：session 摘要/删除、SessionDialog 交互与 App 集成测试通过。
- 全量：`pnpm check` 退出码 0，全量测试通过；`git diff --check` 通过。
- 手工：终端内 `/session` 选择、恢复、退出与删除均正常，摘要随新对话更新。
