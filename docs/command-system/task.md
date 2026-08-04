# BetterCode 命令系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/command/types.ts` | 命令、控制器、分发和补全类型 |
| 新建 | `src/command/parser.ts` | 斜杠输入解析 |
| 新建 | `src/command/registry.ts` | 注册、冲突检测、查找和补全 |
| 新建 | `src/command/dispatcher.ts` | 命令分流和异常隔离 |
| 新建 | `src/command/builtins.ts` | 十个主命令与兼容命令 |
| 新建 | `src/command/*.test.ts` | 命令域单元测试 |
| 修改 | `src/ui/input-box.tsx` | Tab 补全与多候选菜单 |
| 修改 | `src/ui/input-box.test.ts` | 补全状态测试 |
| 修改 | `src/ui/app.tsx` | 控制器、分流器、模式状态和状态栏 |
| 修改 | `src/ui/app.test.ts` | 帮助、状态和提示词格式测试 |
| 修改 | `README.md` | 命令列表和模式说明 |

## T1：定义命令公共契约

**文件：** `src/command/types.ts`
**依赖：** 无

1. 定义 `CommandType`、`CommandDefinition`、`ParsedCommand`、`CommandInvocation`。
2. 定义 `CommandUIController`，覆盖消息、Agent 发送、模式、Token、状态和现有本地动作。
3. 定义 `DispatchResult` 和 `CommandCompletion`。

**验证：** `pnpm typecheck` 能解析所有公开类型。

## T2：实现解析器

**文件：** `src/command/parser.ts`、`src/command/parser.test.ts`
**依赖：** T1

1. 区分空输入、普通输入和斜杠命令。
2. 按第一段空白拆分名称与参数并规范化小写。
3. 覆盖大小写、多个空格、只有 `/` 和 Unicode 参数。

**验证：** `pnpm exec tsx --test src/command/parser.test.ts` 全绿。

## T3：实现注册中心

**文件：** `src/command/registry.ts`、`src/command/registry.test.ts`
**依赖：** T1

1. 校验主名称、别名和必填元数据。
2. 用统一索引登记名称和别名，冲突同步抛错。
3. 实现按名查找、稳定列表和隐藏过滤。
4. 实现主名称与别名前缀补全、按命令去重。

**验证：** `pnpm exec tsx --test src/command/registry.test.ts` 全绿。

## T4：实现分发器

**文件：** `src/command/dispatcher.ts`、`src/command/dispatcher.test.ts`
**依赖：** T2、T3

1. 普通输入返回 `not_command`。
2. 未知命令显示 `/help` 引导。
3. 命中后执行 handler 并返回规范主名称。
4. 捕获同步和异步异常，显示确定性错误。

**验证：** `pnpm exec tsx --test src/command/dispatcher.test.ts` 全绿。

## T5：登记内置命令

**文件：** `src/command/builtins.ts`、`src/command/builtins.test.ts`
**依赖：** T3、T4

1. 登记十个可见主命令和各自元数据。
2. `/help` 从 registry 动态格式化。
3. `/plan`、`/do` 切换模式，`/review` 构造固定提示词。
4. 会话、记忆、权限、状态、压缩和清理转发到控制器。
5. 增加隐藏 `rewind`、`exit` 与兼容别名。

**验证：** `pnpm exec tsx --test src/command/builtins.test.ts` 全绿，主命令数量等于 10。

## T6：实现输入补全交互

**文件：** `src/ui/input-box.tsx`、`src/ui/input-box.test.ts`
**依赖：** T3

1. 增加补全回调与菜单状态。
2. 单候选 Tab 直接补全规范主命令。
3. 多候选显示菜单并支持上下、Enter、Esc。
4. 隐藏命令由 registry 提前过滤。
5. 历史导航、编辑和提交时正确关闭菜单。

**验证：** `pnpm exec tsx --test src/ui/input-box.test.ts` 全绿，`pnpm typecheck` 通过。

## T7：接入 App 控制器与分流

**文件：** `src/ui/app.tsx`
**依赖：** T4、T5、T6

1. 初始化默认 registry 和 dispatcher。
2. 将 Agent 流式执行提取为 `sendAgentMessage`。
3. 实现 `CommandUIController` 桥接现有清理、压缩、会话、记忆、权限、状态、回滚和退出行为。
4. 回车先 dispatch，普通输入才发送 Agent。
5. 增加 `agentMode` 状态与 ref，Header 显示模式标记。
6. `/review` 使用预设提示词但显示原始命令。

**验证：** `pnpm typecheck` 通过；App 相关测试全绿。

## T8：更新测试与说明

**文件：** `src/ui/app.test.ts`、`README.md`
**依赖：** T7

1. 测试状态文本、帮助输出和 review 提示词。
2. 更新 README 命令表、模式切换和兼容别名。
3. 扫描旧硬编码帮助与旧 `/plan <任务>` 文案。

**验证：** `rg -n '/plan <任务>|执行最近成功生成的计划' src/ui README.md` 无匹配。

## T9：全量验收与阶段提交

**文件：** 全部变更
**依赖：** T1-T8

1. 运行 `pnpm check`。
2. 运行 `git diff --check`。
3. 按 checklist 执行自动化场景并记录结果。
4. 生成 changelog，使用中文提交信息完成阶段提交。

**验证：** 测试全绿、差异检查通过、提交后工作区干净。

## 执行顺序

```text
T1 -> T2 -> T3 -> T4 -> T5
                  \-> T6
T5 + T6 -> T7 -> T8 -> T9
```

## T10：/session 交互选择器与会话摘要

**文件：** `src/session/session.ts`、`src/session/summarizer.ts`、`src/chat/manager.ts`、`src/command/presenters.ts`、`src/ui/session-dialog.tsx`、`src/ui/app.tsx` 及对应测试、`docs/command-system/spec.md`、`docs/command-system/plan.md`、`docs/command-system/task.md`、`docs/command-system/checklist.md`

**依赖：** T9

**步骤：**

1. `session.ts` 增加 `session_summary` 记录类型、`saveSessionSummary` 替换写入与 `deleteSession`；`SessionInfo` 的 `firstMessage` 改为 `summary`。
2. 新增 `SessionSummarizer`，用流式 LLM 调用生成一句中文摘要，禁止工具且失败静默。
3. `ChatManager` 在自然完成与独立 Skill 结束时延迟调度摘要，增加 `deleteSession` 并拒绝删除当前会话。
4. `buildSessionPresentation` 改为摘要列；App 的无参数 `/session` 打开新的 `SessionDialog`。
5. `SessionDialog` 支持方向键、Enter、Esc、Delete/Backspace、翻页与当前会话标记。
6. 更新 session、manager、dialog 与 App 集成测试，运行全量检查。

**验证：** `pnpm check`、`git diff --check` 与选择器手工验收（恢复、退出、删除、摘要展示）。
