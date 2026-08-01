# BetterCode 团队协作系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/config/types.ts` | 增加团队、运行时、集成和终端适配配置类型 |
| 修改 | `src/config/loader.ts` | 解析并校验 `teams` 配置 |
| 修改 | `src/config/loader.test.ts` | 覆盖团队配置默认值与非法输入 |
| 新建 | `src/team/types.ts` | 团队、成员、任务、消息、审批、上下文和集成领域类型 |
| 新建 | `src/team/errors.ts` | 团队结构化错误与诊断 |
| 新建 | `src/team/path-guard.ts` | 团队名、成员名和用户目录路径防护 |
| 新建 | `src/team/path-guard.test.ts` | 名称与符号链接逃逸测试 |
| 新建 | `src/team/atomic-store.ts` | 原子 JSON 快照与 revision CAS |
| 新建 | `src/team/atomic-store.test.ts` | 原子写入、冲突和损坏隔离测试 |
| 新建 | `src/team/file-lock.ts` | 跨进程锁、重试、陈旧锁回收 |
| 新建 | `src/team/file-lock.test.ts` | 锁竞争、取消和陈旧锁测试 |
| 新建 | `src/team/repository.ts` | 团队索引、生命周期、恢复与归档状态 |
| 新建 | `src/team/repository.test.ts` | 多团队、会话绑定和重启恢复测试 |
| 新建 | `src/team/task-service.ts` | 任务 DAG、状态机、分派和所有权 |
| 新建 | `src/team/task-service.test.ts` | 依赖环、阻塞传播和状态转换测试 |
| 新建 | `src/team/mailbox-store.ts` | JSONL 邮箱追加、读取和已读更新 |
| 新建 | `src/team/mailbox-store.test.ts` | 并发追加、残缺尾行和独立已读测试 |
| 新建 | `src/team/mailbox-service.ts` | 名称注册、协议校验、广播和唤醒 |
| 新建 | `src/team/mailbox-service.test.ts` | 身份、协议、广播和唤醒失败测试 |
| 新建 | `src/team/approval-service.ts` | 逐任务计划版本与审批授权 |
| 新建 | `src/team/approval-service.test.ts` | 批准、驳回、过期和改派失效测试 |
| 新建 | `src/team/context-store.ts` | 成员可恢复上下文快照 |
| 新建 | `src/team/context-store.test.ts` | 上下文 revision、代次和恢复测试 |
| 新建 | `src/team/operation-journal.ts` | 副作用工具开始、结束和不确定操作日志 |
| 新建 | `src/team/operation-journal.test.ts` | 未配对操作与人工解决测试 |
| 修改 | `src/tool/types.ts` | 增加团队错误码与执行策略公共接口 |
| 修改 | `src/agent/tool-scheduler.ts` | 接入硬策略和工具执行观察器 |
| 修改 | `src/agent/tool-scheduler.test.ts` | 验证策略顺序、拒绝回灌和执行日志 |
| 修改 | `src/agent/loop.ts` | 传递动态可见工具、策略和观察器 |
| 修改 | `src/agent/loop.test.ts` | 验证 Provider 与执行层使用同一工具快照 |
| 新建 | `src/tool/visibility.ts` | 组合 Skill、Team、Plan 和 Coordinator 工具可见性 |
| 新建 | `src/tool/visibility.test.ts` | 身份与模式矩阵测试 |
| 修改 | `src/subagent/types.ts` | 团队工具加入不可变禁用集合 |
| 修改 | `src/subagent/tool-filter.test.ts` | 普通与 Fork 子 Agent 团队工具隔离测试 |
| 新建 | `src/team/tool-policy.ts` | actor、审批、Plan 与 Coordinator 执行前策略 |
| 新建 | `src/team/tool-policy.test.ts` | 伪造身份、审批门禁和 Coordinator 拒绝测试 |
| 新建 | `src/team/tools.ts` | 六个稳定团队工具及 action Schema |
| 新建 | `src/team/tools.test.ts` | 工具参数、动作权限和结构化错误测试 |
| 新建 | `src/team/backend/types.ts` | 成员后端接口、探测与实例类型 |
| 新建 | `src/team/backend/process-runner.ts` | `shell:false` 的有界命令执行器 |
| 新建 | `src/team/backend/process-runner.test.ts` | 超时、取消、输出上限和 argv 测试 |
| 新建 | `src/team/backend/manager.ts` | 后端优先级、显式选择和禁止静默降级 |
| 新建 | `src/team/backend/manager.test.ts` | 自动探测与显式协程测试 |
| 新建 | `src/team/backend/tmux.ts` | tmux 创建、唤醒、恢复和终止 |
| 新建 | `src/team/backend/tmux.test.ts` | tmux argv 与 pane ID 解析测试 |
| 新建 | `src/team/backend/wezterm.ts` | WezTerm 创建、唤醒、恢复和终止 |
| 新建 | `src/team/backend/wezterm.test.ts` | WezTerm 环境与 argv 测试 |
| 新建 | `src/team/backend/iterm2.ts` | iTerm2 受控 AppleScript 适配 |
| 新建 | `src/team/backend/iterm2.test.ts` | 平台探测、session ID 和转义测试 |
| 新建 | `src/team/backend/configured.ts` | 用户配置终端适配器 |
| 新建 | `src/team/backend/configured.test.ts` | 占位符、重复名称和无 shell 测试 |
| 新建 | `src/team/backend/coroutine.ts` | 同进程成员协程后端 |
| 新建 | `src/team/backend/coroutine.test.ts` | 启动、唤醒、取消与状态测试 |
| 新建 | `src/team/prompts.ts` | Team Lead 与成员动态补充指令 |
| 新建 | `src/team/prompts.test.ts` | BetterCode 名称、身份和工作目录提示测试 |
| 新建 | `src/team/member-runtime.ts` | 成员 actor Registry、ProjectRuntime 和工具快照 |
| 新建 | `src/team/member-runtime.test.ts` | 角色限制、协作工具和 Worktree 判定测试 |
| 新建 | `src/team/member-runner.ts` | 长期成员 Agent Loop、上下文保存和空闲状态 |
| 新建 | `src/team/member-runner.test.ts` | 首次运行、恢复、审批和不确定操作测试 |
| 新建 | `src/team/worker-entry.ts` | 独立 Worker 描述文件校验与入口 |
| 新建 | `src/team/worker-host.ts` | Worker 心跳、轮询、唤醒和代次检查 |
| 新建 | `src/team/worker-host.test.ts` | 失效代次、心跳和空闲恢复测试 |
| 修改 | `src/worktree/git-client.ts` | 增加目标引用包含与集成安全 Git 操作 |
| 修改 | `src/worktree/types.ts` | 增加已集成清理结果和错误类型 |
| 修改 | `src/worktree/manager.ts` | 增加 `removeIntegrated` |
| 修改 | `src/worktree/manager.test.ts` | 已合入、未合入、脏目录和租约测试 |
| 新建 | `src/team/integration-git.ts` | 临时集成分支的 `shell:false` Git 客户端 |
| 新建 | `src/team/integration-git.test.ts` | 合并、冲突、继续、终止与 ff-only 测试 |
| 新建 | `src/team/integration-manager.ts` | 集成事务状态机和验证命令 |
| 新建 | `src/team/integration-manager.test.ts` | 顺序、冲突、验证失败和整体回滚测试 |
| 新建 | `src/team/coordinator-shell.ts` | Coordinator Git 命令 argv 白名单 |
| 新建 | `src/team/coordinator-shell.test.ts` | 允许命令与 shell 绕过测试 |
| 新建 | `src/team/lead-inbox.ts` | Team Lead 通知请求边界注入 |
| 新建 | `src/team/lead-inbox.test.ts` | prepare/commit、会话隔离和持久化测试 |
| 新建 | `src/team/coordinator.ts` | 活跃团队、成员生命周期和服务编排 |
| 新建 | `src/team/coordinator.test.ts` | 创建、恢复、终止、切换和归档测试 |
| 修改 | `src/chat/manager.ts` | 接入团队可见工具、提示、通知与会话绑定 |
| 修改 | `src/chat/manager.test.ts` | Team Lead 与普通会话兼容测试 |
| 修改 | `src/command/types.ts` | 增加 `/team` UI 控制入口 |
| 修改 | `src/command/builtins.ts` | 注册 `/team` 命令 |
| 修改 | `src/command/builtins.test.ts` | `/team` 解析与帮助测试 |
| 新建 | `src/bootstrap/application.ts` | 抽取普通 TUI 与 Worker 共用服务装配 |
| 新建 | `src/bootstrap/application.test.ts` | 服务初始化、关闭顺序和诊断测试 |
| 修改 | `src/ui/app.tsx` | Team 状态、事件、命令和 Coordinator 标记 |
| 修改 | `src/ui/app.test.ts` | 状态格式和团队命令 UI 测试 |
| 修改 | `src/index.tsx` | 普通模式与 `--team-worker` 分流 |
| 新建 | `src/team/integration.test.ts` | 团队端到端协作、恢复和代码集成场景 |

## 阶段一：配置与持久化基础

## T1：定义团队配置类型与默认值

**文件：** `src/config/types.ts`、`src/team/types.ts`、`src/team/errors.ts`

**依赖：** 无

**步骤：**
1. 在配置类型中加入 `TeamConfig`、Mailbox、Runtime、Integration 和自定义终端结构。
2. 在团队类型文件定义 Plan 中的 Team、Member、Task、Message、Approval、Context、Integration 和事件类型。
3. 定义 `TeamError`、稳定错误码和脱敏 `TeamDiagnostic`。
4. 增加配置解析后的默认值常量，保持所有默认值集中可测试。

**验证：** 运行 `pnpm typecheck`，期望新增类型在 strict 模式下无错误。

## T2：解析并校验 teams 配置

**文件：** `src/config/loader.ts`、`src/config/loader.test.ts`

**依赖：** T1

**步骤：**
1. 增加 `teams` 顶层字段和每层允许字段集合。
2. 校验布尔开关、超时范围、心跳关系、验证命令和自定义终端名称唯一性。
3. 校验 ProcessTemplate 使用 argv 数组，并仅允许三个受控占位符。
4. 把缺省配置解析为 Plan 中的默认值，不修改现有配置行为。
5. 为合法、未知字段、非法超时、重复终端和非法占位符添加测试。

**验证：** 运行 `pnpm exec tsx --test src/config/loader.test.ts`，期望全部通过。

## T3：实现团队路径守卫

**文件：** `src/team/path-guard.ts`、`src/team/path-guard.test.ts`

**依赖：** T1

**步骤：**
1. 实现团队名和成员名的规范化、长度、字符集和保留名校验。
2. 构造 `~/.bettercode/teams` 及团队内各类路径。
3. 对已存在路径解析符号链接，对新路径校验最近存在父目录。
4. 拒绝绝对路径、分隔符、`.`、`..`、控制字符和跨团队逃逸。
5. 使用临时用户目录覆盖普通、边界和符号链接场景。

**验证：** 运行 `pnpm exec tsx --test src/team/path-guard.test.ts`，期望全部通过。

## T4：实现 revision 原子 JSON 存储

**文件：** `src/team/atomic-store.ts`、`src/team/atomic-store.test.ts`

**依赖：** T1、T3

**步骤：**
1. 实现严格 JSON 读取、版本校验和损坏诊断。
2. 使用同目录临时文件、权限设置、`fsync` 和 `rename` 完成原子写入。
3. 写入时校验 expected revision 并自动生成下一 revision。
4. 清理本进程遗留临时文件，但不误删其他活跃写入者文件。
5. 测试首次创建、更新、revision 冲突、写入失败和损坏文件隔离。

**验证：** 运行 `pnpm exec tsx --test src/team/atomic-store.test.ts`，期望全部通过。

## T5：实现跨进程文件锁

**文件：** `src/team/file-lock.ts`、`src/team/file-lock.test.ts`

**依赖：** T1、T3

**步骤：**
1. 用 `open('wx')` 创建包含 PID、实例 ID、创建时间和过期时间的锁文件。
2. 实现有界重试、取消响应和超时错误。
3. 仅在锁超时且 PID 失效或运行代次失效时回收陈旧锁。
4. 释放时校验实例 ID，避免删除后来持有者的锁。
5. 测试并发竞争、正常释放、取消、陈旧活进程和陈旧死进程。

**验证：** 运行 `pnpm exec tsx --test src/team/file-lock.test.ts`，期望全部通过。

## T6：实现团队仓库与索引

**文件：** `src/team/repository.ts`、`src/team/repository.test.ts`

**依赖：** T3、T4、T5

**步骤：**
1. 实现团队索引、团队元数据和成员文件的创建、查询与列表。
2. 实现 session 到唯一活跃团队的持久化绑定和安全切换。
3. 创建团队时记录 repositoryId、projectRoot、Lead 和 generation。
4. 隔离损坏团队并返回诊断，不阻止其他团队加载。
5. 测试两个团队切换、非法名称、重复创建、错误仓库和损坏数据。

**验证：** 运行 `pnpm exec tsx --test src/team/repository.test.ts`，期望基础生命周期测试通过。

## T7：实现启动恢复与运行代次

**文件：** `src/team/repository.ts`、`src/team/repository.test.ts`

**依赖：** T6

**步骤：**
1. 激活团队时原子递增 generation。
2. 把遗留 `running`、`stopping` 状态成员转为 `interrupted`，保留 waiting approval。
3. 作废旧 generation 的 runtime lease，不删除上下文和邮箱。
4. 实现归档团队默认不可激活和显式 restore 前完整校验。
5. 增加进程崩溃、旧租约和归档恢复测试。

**验证：** 运行 `pnpm exec tsx --test src/team/repository.test.ts`，期望恢复场景全部通过。

## T8：提交持久化基础检查点

**文件：** 阶段一全部文件

**依赖：** T1-T7

**步骤：**
1. 运行阶段一全部定向测试和类型检查。
2. 检查没有修改或提交 `.bettercode/` 运行数据。
3. 检查新增源码注释为中文。
4. 创建中文 Git 提交 `feat(团队): 建立持久化与恢复基础`。

**验证：** 运行 `git show --stat --oneline HEAD`，期望提交信息为中文且只包含阶段一文件。

## 阶段二：任务、邮箱与审批领域

## T9：实现任务 DAG 校验

**文件：** `src/team/task-service.ts`、`src/team/task-service.test.ts`

**依赖：** T4、T6

**步骤：**
1. 实现任务 ID 分配、创建、读取和列表。
2. 校验未知依赖、自依赖和重复依赖。
3. 使用 Kahn 算法检测循环并提供稳定拓扑顺序。
4. 限制任务数和依赖数，避免无界图计算。
5. 测试合法链、菱形依赖、未知依赖、自环和多节点环。

**验证：** 运行 `pnpm exec tsx --test src/team/task-service.test.ts`，期望 DAG 测试通过。

## T10：实现任务状态机与所有权

**文件：** `src/team/task-service.ts`、`src/team/task-service.test.ts`

**依赖：** T9

**步骤：**
1. 定义成员与 Lead 可执行的状态转换表。
2. 实现分派、报告、取消、失败、完成和显式 reopen。
3. 前置任务变化后增量重算后继任务 blocked/pending/ready 状态。
4. 拒绝成员修改他人任务、依赖、负责人和终态。
5. 记录每次状态变化的 actor、原因、时间和旧新状态。

**验证：** 运行 `pnpm exec tsx --test src/team/task-service.test.ts`，期望状态与所有权测试通过。

## T11：实现 JSONL 邮箱存储

**文件：** `src/team/mailbox-store.ts`、`src/team/mailbox-store.test.ts`

**依赖：** T3、T5

**步骤：**
1. 在锁内追加完整 JSONL 消息并 `fsync`。
2. 实现按 cursor 读取、按 ID 标记已读和邮箱大小边界。
3. 保留完整合法前缀，对末尾残缺行产生诊断。
4. 标记已读时保持其他消息字段和并发追加结果。
5. 测试并发写、残缺尾行、重复 ID、独立已读和锁超时。

**验证：** 运行 `pnpm exec tsx --test src/team/mailbox-store.test.ts`，期望全部通过。

## T12：实现结构化消息协议

**文件：** `src/team/mailbox-service.ts`、`src/team/mailbox-service.test.ts`

**依赖：** T6、T10、T11

**步骤：**
1. 实现名称注册表解析和 Lead 保留身份。
2. 为 text、task、status、approval、idle、interrupted 和 system 消息建立判别校验。
3. 由服务生成消息 ID、发件人、时间戳和默认未读状态。
4. 拒绝未知成员、跨团队对象、伪造身份和错误关联 ID。
5. 测试每类合法消息与缺字段、错任务、错审批和伪造 sender。

**验证：** 运行 `pnpm exec tsx --test src/team/mailbox-service.test.ts`，期望协议校验通过。

## T13：实现广播与后端唤醒

**文件：** `src/team/mailbox-service.ts`、`src/team/mailbox-service.test.ts`

**依赖：** T12

**步骤：**
1. 广播时为每个收件人生成独立消息记录。
2. 返回逐收件人的投递成功与失败结果，不回滚已成功写入消息。
3. 消息落盘后调用注入的 `MemberWakeDispatcher`。
4. 唤醒失败只记录诊断，消息继续保持未读。
5. 让广播与系统通知默认不唤醒，任务、审批响应和明确 direct wake 才唤醒。

**验证：** 运行 `pnpm exec tsx --test src/team/mailbox-service.test.ts`，期望广播和唤醒测试通过。

## T14：实现审批版本状态机

**文件：** `src/team/approval-service.ts`、`src/team/approval-service.test.ts`

**依赖：** T10、T12

**步骤：**
1. 实现成员提交审批请求并递增 planVersion。
2. 实现 Lead approve/reject，严格关联审批、任务、成员和计划版本。
3. 任务改派、reopen 或新计划时 supersede 旧审批。
4. 拒绝成员自批、普通文本批准、重复决定和过期响应。
5. 批准或驳回后更新任务状态并发送结构化响应。

**验证：** 运行 `pnpm exec tsx --test src/team/approval-service.test.ts`，期望全部通过。

## T15：实现成员上下文快照

**文件：** `src/team/context-store.ts`、`src/team/context-store.test.ts`

**依赖：** T4、T6

**步骤：**
1. 保存消息、Token、角色 revision、系统提示哈希、邮箱 cursor 和任务 ID。
2. 校验 team、member、generation 和 revision 后恢复。
3. 拒绝错团队、旧代次、未知版本和路径不匹配快照。
4. 让上下文写入保持 0600，并对大对象使用现有上下文管理边界。
5. 测试首次保存、增量更新、冲突、旧代次和损坏快照。

**验证：** 运行 `pnpm exec tsx --test src/team/context-store.test.ts`，期望全部通过。

## T16：实现副作用操作日志

**文件：** `src/team/operation-journal.ts`、`src/team/operation-journal.test.ts`

**依赖：** T5、T15

**步骤：**
1. 写入 `tool_started`、`tool_finished` 和 `tool_resolved` 事件。
2. 对参数与结果做长度限制和敏感字段脱敏。
3. 扫描未配对 started 事件并返回 uncertain IDs。
4. 只允许 Lead 对当前成员当前任务的不确定操作做明确解决。
5. 测试完整配对、进程中断、多任务和迟到 finished 事件。

**验证：** 运行 `pnpm exec tsx --test src/team/operation-journal.test.ts`，期望全部通过。

## T17：提交协作领域检查点

**文件：** 阶段二全部文件

**依赖：** T9-T16

**步骤：**
1. 运行任务、邮箱、审批、上下文和操作日志定向测试。
2. 运行 `pnpm typecheck`。
3. 检查消息和诊断不输出 API Key 或完整敏感正文。
4. 创建中文 Git 提交 `feat(团队): 实现任务邮箱与审批领域`。

**验证：** 运行 `git show --stat --oneline HEAD`，期望提交范围正确。

## 阶段三：执行策略与团队工具

## T18：为 ToolScheduler 增加硬策略

**文件：** `src/tool/types.ts`、`src/agent/tool-scheduler.ts`、`src/agent/tool-scheduler.test.ts`

**依赖：** T1

**步骤：**
1. 定义 `ToolExecutionPolicy` 和策略输入结构。
2. 在 Schema 与可见性检查后、Hook 与权限前执行硬策略。
3. 策略拒绝作为结构化工具结果返回，不抛出 Agent Loop。
4. 保持系统工具与普通工具现有权限行为不变。
5. 测试执行顺序、拒绝、取消和多工具批次。

**验证：** 运行 `pnpm exec tsx --test src/agent/tool-scheduler.test.ts`，期望全部通过。

## T19：增加工具执行观察器

**文件：** `src/tool/types.ts`、`src/agent/tool-scheduler.ts`、`src/agent/loop.ts`、对应测试

**依赖：** T18

**步骤：**
1. 定义 beforeExecute/afterExecute 异步观察器。
2. 副作用工具执行前等待 started 日志完成，失败时拒绝执行。
3. 工具返回后保存 finished 日志；日志失败转为可诊断结果。
4. AgentLoop 把运行时策略与观察器传给 Scheduler。
5. 测试观察器时序、工具异常、超时和只读工具行为。

**验证：** 运行 `pnpm exec tsx --test src/agent/tool-scheduler.test.ts src/agent/loop.test.ts`，期望全部通过。

## T20：实现统一工具可见性解析器

**文件：** `src/tool/visibility.ts`、`src/tool/visibility.test.ts`

**依赖：** T18

**步骤：**
1. 组合 Registry、Skill 白名单、团队身份、Agent Mode 和 Coordinator 状态。
2. 未激活团队移除全部团队工具。
3. Lead 和成员分别追加各自工具，Coordinator 移除普通副作用和 Agent 工具。
4. 生成不可变名称快照，供 Provider definitions 与执行层共同使用。
5. 覆盖普通会话、Skill、Lead、成员、Plan 和 Coordinator 组合矩阵。

**验证：** 运行 `pnpm exec tsx --test src/tool/visibility.test.ts`，期望全部通过。

## T21：封禁普通子 Agent 的团队工具

**文件：** `src/subagent/types.ts`、`src/subagent/tool-filter.ts`、`src/subagent/tool-filter.test.ts`、`src/subagent/definition-manager.test.ts`

**依赖：** T20

**步骤：**
1. 把全部稳定 `team_*` 名称加入不可变禁用集合。
2. 定义式和 Fork 式子 Agent 都移除团队工具。
3. 角色定义显式引用团队工具时产生 `FORBIDDEN_TOOL`。
4. 保持 TeamMemberRunner 使用独立成员工具注入路径，不经过普通子 Agent 过滤。

**验证：** 运行 `pnpm exec tsx --test src/subagent/tool-filter.test.ts src/subagent/definition-manager.test.ts`，期望全部通过。

## T22：实现团队执行策略

**文件：** `src/team/tool-policy.ts`、`src/team/tool-policy.test.ts`

**依赖：** T14、T18、T20

**步骤：**
1. 校验 Lead/Member actor、team、generation 和工具 action。
2. 审批等待期拒绝普通副作用工具，仅开放只读与协作工具。
3. Plan Mode 对团队变更 action 返回 `TOOL_UNAVAILABLE`。
4. Coordinator 模式拒绝所有普通副作用工具，仅把 run_command 交给专用 Shell 策略。
5. 测试伪造身份、跨团队、旧代次、旧批准和允许路径。

**验证：** 运行 `pnpm exec tsx --test src/team/tool-policy.test.ts`，期望全部通过。

## T23：实现六个稳定团队工具

**文件：** `src/team/tools.ts`、`src/team/tools.test.ts`

**依赖：** T10、T13、T14、T22

**步骤：**
1. 实现 `team_status`、`team_member`、`team_task`、`team_message`、`team_approval`、`team_integrate` 的 JSON Schema。
2. 使用 `oneOf` 对 action 参数做判别校验。
3. 工具只调用注入的 TeamCoordinator 接口，不直接读写文件。
4. 返回稳定 Team 错误码、对象 ID、状态和简洁摘要。
5. 测试每个 action 的合法参数、缺字段、越权和服务错误转换。

**验证：** 运行 `pnpm exec tsx --test src/team/tools.test.ts`，期望全部通过。

## T24：提交执行策略检查点

**文件：** 阶段三全部文件

**依赖：** T18-T23

**步骤：**
1. 运行 Agent、工具可见性、子 Agent 和团队工具测试。
2. 运行 `pnpm typecheck`。
3. 确认普通会话和普通子 Agent 测试无回归。
4. 创建中文 Git 提交 `feat(团队): 接入工具作用域与执行门禁`。

**验证：** 运行 `git show --stat --oneline HEAD`，期望提交范围正确。

## 阶段四：后端、成员运行与 Worker

## T25：实现安全 ProcessRunner

**文件：** `src/team/backend/process-runner.ts`、`src/team/backend/process-runner.test.ts`

**依赖：** T1

**步骤：**
1. 使用 `spawn(command, args, { shell: false })` 执行后端命令。
2. 实现 stdout/stderr 上限、超时、取消和终止升级。
3. 返回退出码、信号、截断和耗时元数据。
4. 测试参数保持独立、超时进程、取消和大输出。

**验证：** 运行 `pnpm exec tsx --test src/team/backend/process-runner.test.ts`，期望全部通过。

## T26：实现后端选择管理器

**文件：** `src/team/backend/types.ts`、`src/team/backend/manager.ts`、`src/team/backend/manager.test.ts`

**依赖：** T25

**步骤：**
1. 定义 probe、spawn、wake、recover、terminate 接口和结果类型。
2. 自动模式按 tmux、当前原生终端、自定义适配器顺序探测。
3. 全部独立后端不可用时返回详情，不调用协程。
4. 显式后端不可用时直接失败；显式 coroutine 才允许协程。
5. 测试优先级、探测异常、显式选择和禁止静默降级。

**验证：** 运行 `pnpm exec tsx --test src/team/backend/manager.test.ts`，期望全部通过。

## T27：实现 tmux 后端

**文件：** `src/team/backend/tmux.ts`、`src/team/backend/tmux.test.ts`

**依赖：** T25、T26

**步骤：**
1. 检测 `TMUX` 和 tmux 可执行状态。
2. 构造 split-window argv，传 Worker 描述文件并解析 pane ID。
3. 使用 send-keys 唤醒，使用受控 kill-pane 终止。
4. 校验 pane ID 格式，拒绝命令输出注入。

**验证：** 运行 `pnpm exec tsx --test src/team/backend/tmux.test.ts`，期望全部通过。

## T28：实现 WezTerm 后端

**文件：** `src/team/backend/wezterm.ts`、`src/team/backend/wezterm.test.ts`

**依赖：** T25、T26

**步骤：**
1. 检测 TERM_PROGRAM 和 `wezterm cli`。
2. 构造 split-pane argv 并解析 pane ID。
3. 实现 send-text 唤醒和 pane 关闭。
4. 测试非 WezTerm、CLI 不可用、合法和非法 pane ID。

**验证：** 运行 `pnpm exec tsx --test src/team/backend/wezterm.test.ts`，期望全部通过。

## T29：实现 iTerm2 后端

**文件：** `src/team/backend/iterm2.ts`、`src/team/backend/iterm2.test.ts`

**依赖：** T25、T26

**步骤：**
1. 限制 macOS 且 TERM_PROGRAM 为 iTerm2。
2. 使用固定 AppleScript 和 argv 参数创建 split pane，不拼接用户脚本。
3. 解析并校验 session ID，实现 write text 唤醒和受控关闭。
4. 测试路径含空格、引号、非 macOS 和自动化失败。

**验证：** 运行 `pnpm exec tsx --test src/team/backend/iterm2.test.ts`，期望全部通过。

## T30：实现配置终端适配器

**文件：** `src/team/backend/configured.ts`、`src/team/backend/configured.test.ts`

**依赖：** T2、T25、T26

**步骤：**
1. 在单个 argv 元素内替换受控占位符。
2. 分别执行 detect、spawn、wake 和可选 terminate 模板。
3. 解析 bounded pane ID，保留适配器名称。
4. 拒绝未知占位符、空命令和 shell 字符串语义。

**验证：** 运行 `pnpm exec tsx --test src/team/backend/configured.test.ts`，期望全部通过。

## T31：实现协程后端

**文件：** `src/team/backend/coroutine.ts`、`src/team/backend/coroutine.test.ts`

**依赖：** T26

**步骤：**
1. 为每个成员保存独立 AbortController、运行 Promise 和实例 ID。
2. wake 只触发该成员等待器，重复 wake 合并但不丢邮箱消息。
3. terminate 先取消并等待，超时返回不确定终止结果。
4. 保证一个成员失败不影响其他协程。

**验证：** 运行 `pnpm exec tsx --test src/team/backend/coroutine.test.ts`，期望全部通过。

## T32：实现成员提示与运行时工具快照

**文件：** `src/team/prompts.ts`、`src/team/prompts.test.ts`、`src/team/member-runtime.ts`、`src/team/member-runtime.test.ts`

**依赖：** T20、T21、T23

**步骤：**
1. 构造成员固定角色提示、团队身份、任务、邮箱和工作目录补充指令。
2. 从角色定义解析 Provider、权限、最大迭代和普通工具集合。
3. 系统追加成员协作工具并排除 Lead、Agent 和 Skill 加载工具。
4. 根据普通工具 effect 判定共享根目录或专属 Worktree。
5. 测试只读、含 Shell、显式空白名单和角色热更新快照。

**验证：** 运行 `pnpm exec tsx --test src/team/prompts.test.ts src/team/member-runtime.test.ts`，期望全部通过。

## T33：实现长期成员 Agent Runner

**文件：** `src/team/member-runner.ts`、`src/team/member-runner.test.ts`

**依赖：** T14-T16、T19、T22、T32

**步骤：**
1. 首次运行从角色指令和首个任务启动，恢复运行加载上下文快照。
2. 使用 ProjectRuntimeFactory 创建成员 scoped runtime。
3. 接入审批动态工具集、TeamExecutionPolicy 和 OperationJournal observer。
4. 每轮安全边界保存消息、Token、邮箱 cursor 与任务状态。
5. 自然完成时原子更新任务和成员为空闲，再发送结果通知。

**验证：** 运行 `pnpm exec tsx --test src/team/member-runner.test.ts`，期望首次与恢复测试通过。

## T34：接入长期 Worktree 生命周期

**文件：** `src/team/member-runtime.ts`、`src/team/member-runner.ts`、对应测试

**依赖：** T33

**步骤：**
1. 可写成员首次创建并 acquire `team/<team>/<member>` Worktree。
2. 空闲时只 exit 租约，不 finalize；恢复时 enter 同一 Worktree。
3. 只读成员绑定 Lead root，角色新增副作用工具时拒绝共享目录恢复。
4. Worktree 初始化失败时成员进入 failed 且无半初始化运行。

**验证：** 运行 `pnpm exec tsx --test src/team/member-runtime.test.ts src/team/member-runner.test.ts`，期望 Worktree 场景通过。

## T35：实现 Worker 描述文件与租约

**文件：** `src/team/worker-entry.ts`、`src/team/worker-host.ts`、`src/team/worker-host.test.ts`

**依赖：** T7、T33

**步骤：**
1. 定义 0600 Worker descriptor，只含路径、身份、配置路径和 generation。
2. 校验 descriptor 归属、文件权限、团队、成员和 repositoryId。
3. 创建带 PID、实例 ID、窗格 ID、generation 和心跳的 runtime lease。
4. 每次状态写入前检查 generation，失效时停止。
5. 测试 descriptor 篡改、旧代次、PID 复用标识和心跳超时。

**验证：** 运行 `pnpm exec tsx --test src/team/worker-host.test.ts`，期望全部通过。

## T36：实现 Worker 空闲与唤醒循环

**文件：** `src/team/worker-host.ts`、`src/team/worker-host.test.ts`

**依赖：** T13、T31、T35

**步骤：**
1. 空闲时监听 stdin 唤醒并低频轮询邮箱。
2. 只为任务、审批响应和明确 direct wake 恢复 Agent。
3. 合并重复唤醒，按邮箱 cursor 消费消息且成功保存后再标记已读。
4. 退出前停止心跳、释放租约和保存最后状态。

**验证：** 运行 `pnpm exec tsx --test src/team/worker-host.test.ts`，期望空闲恢复测试通过。

## T37：提交成员运行检查点

**文件：** 阶段四全部文件

**依赖：** T25-T36

**步骤：**
1. 运行全部 backend、member runtime、runner 和 worker 测试。
2. 运行 `pnpm typecheck`。
3. 确认窗格命令不包含 API Key、任务正文或消息正文。
4. 创建中文 Git 提交 `feat(团队): 实现成员后端与持久运行`。

**验证：** 运行 `git show --stat --oneline HEAD`，期望提交范围正确。

## 阶段五：Git 集成与 Coordinator

## T38：扩展 Git Worktree 安全检查

**文件：** `src/worktree/git-client.ts`、`src/worktree/types.ts`、`src/worktree/manager.ts`、`src/worktree/manager.test.ts`

**依赖：** T34

**步骤：**
1. 增加检查 Worktree HEAD 是否被目标引用包含的 Git 方法。
2. 实现 `removeIntegrated(name, targetRef)`。
3. 仅在无租约、目录干净、登记一致且提交已被目标包含时安全强制清理。
4. 对未合入、脏目录、目标变化和检查失败返回 retained 原因。

**验证：** 运行 `pnpm exec tsx --test src/worktree/manager.test.ts`，期望新增与既有测试全部通过。

## T39：实现集成 Git 客户端

**文件：** `src/team/integration-git.ts`、`src/team/integration-git.test.ts`

**依赖：** T25、T38

**步骤：**
1. 使用 `shell:false` 实现 Lead 安全状态检查与 HEAD/分支读取。
2. 实现 merge、冲突文件查询、continue、abort、验证状态和 ff-only。
3. 限制输出、超时和参数格式，不接受任意 shell 命令。
4. 使用临时 Git 仓库测试无冲突、冲突、abort 和分支前移。

**验证：** 运行 `pnpm exec tsx --test src/team/integration-git.test.ts`，期望全部通过。

## T40：实现集成事务开始与顺序合并

**文件：** `src/team/integration-manager.ts`、`src/team/integration-manager.test.ts`

**依赖：** T10、T38、T39

**步骤：**
1. 校验 Lead 工作区、任务终态、成员分支和提交状态。
2. 按稳定拓扑顺序创建 IntegrationRecord。
3. 创建临时 Worktree 和分支并逐任务 merge。
4. 冲突时暂停并记录当前任务与冲突文件，不修改 Lead 分支。

**验证：** 运行 `pnpm exec tsx --test src/team/integration-manager.test.ts`，期望准备、顺序和冲突测试通过。

## T41：实现冲突继续、验证与最终提交

**文件：** `src/team/integration-manager.ts`、`src/team/integration-manager.test.ts`

**依赖：** T40

**步骤：**
1. 实现 status、continue 和 abort，校验无未合并索引后继续。
2. 全部分支合并后串行运行配置验证命令并记录结果。
3. finalize 前确认 Lead HEAD 未变化，再执行 ff-only。
4. 成功后标记任务 integrated 并调用 removeIntegrated；失败保留临时状态或安全清理。
5. 测试可解决冲突、不可解决冲突、验证失败和 Lead 分支变化。

**验证：** 运行 `pnpm exec tsx --test src/team/integration-manager.test.ts`，期望全部通过。

## T42：实现 Coordinator Shell 白名单

**文件：** `src/team/coordinator-shell.ts`、`src/team/coordinator-shell.test.ts`

**依赖：** T22、T39

**步骤：**
1. 执行前拒绝重定向、管道、替换、换行、控制字符和脚本解释器。
2. 解析简单 argv，只接受 Plan 中列出的 Git 只读子命令。
3. 仅在活动集成 Worktree 允许 merge continue/abort。
4. 校验 `-C` 路径属于 Lead、成员或活动集成 Worktree。
5. 测试允许命令及 `sh -c`、分号、管道、重定向、别名和危险 Git 参数。

**验证：** 运行 `pnpm exec tsx --test src/team/coordinator-shell.test.ts`，期望全部通过。

## T43：提交 Git 集成检查点

**文件：** 阶段五全部文件

**依赖：** T38-T42

**步骤：**
1. 运行 Worktree、Integration 和 Coordinator Shell 定向测试。
2. 运行 `pnpm typecheck`。
3. 检查所有 Git 子进程使用 `shell:false`，Shell 白名单没有提示词依赖。
4. 创建中文 Git 提交 `feat(团队): 实现事务式代码集成`。

**验证：** 运行 `git show --stat --oneline HEAD`，期望提交范围正确。

## 阶段六：协调器、主会话与界面接入

## T44：实现 Team Lead 通知 Inbox

**文件：** `src/team/lead-inbox.ts`、`src/team/lead-inbox.test.ts`

**依赖：** T13

**步骤：**
1. 将关键团队通知转为 instruction 消息。
2. 实现 prepare/commit 两阶段，未提交批次可重试。
3. 按 session 和 team 隔离 cursor，切换团队不串消息。
4. 对正文截断并只注入必要摘要。

**验证：** 运行 `pnpm exec tsx --test src/team/lead-inbox.test.ts`，期望全部通过。

## T45：实现 TeamCoordinator 生命周期

**文件：** `src/team/coordinator.ts`、`src/team/coordinator.test.ts`

**依赖：** T7、T26、T33、T41、T44

**步骤：**
1. 绑定 session 与活跃团队，管理 generation 和订阅器。
2. 实现成员创建、恢复、终止、查询和后端唤醒。
3. 创建失败时回滚半初始化成员并安全处理 Worktree。
4. 切换团队时停止本进程协程、释放监听但不归档。
5. close 时取消活动运行并保持可恢复持久化状态。

**验证：** 运行 `pnpm exec tsx --test src/team/coordinator.test.ts`，期望生命周期测试通过。

## T46：接入任务、消息、审批与归档编排

**文件：** `src/team/coordinator.ts`、`src/team/coordinator.test.ts`

**依赖：** T45

**步骤：**
1. 把工具调用路由到 Task、Mailbox、Approval 和 Integration 服务。
2. 分派满足依赖的任务并唤醒成员，阻塞任务不唤醒。
3. 处理成员完成、空闲、中断和关键通知。
4. 实现团队 archive/restore，归档时安全终止并按保护结果清理 Worktree。
5. 测试改派、审批唤醒、成员失败隔离和归档保留原因。

**验证：** 运行 `pnpm exec tsx --test src/team/coordinator.test.ts`，期望完整编排测试通过。

## T47：在 ChatManager 接入 Team Runtime

**文件：** `src/chat/manager.ts`、`src/chat/manager.test.ts`、`src/tool/visibility.ts`

**依赖：** T20、T23、T44-T46

**步骤：**
1. 把 Skill 与 Team 可见性组合成同一 AgentLoop 快照。
2. 在活跃团队时注入 Lead 团队提示和 Coordinator 状态。
3. 组合 SubAgentResultInbox 与 TeamLeadInbox 的 prepare/commit。
4. session resume/clear 时正确更新团队绑定，不清除持久团队。
5. 暴露团队状态、事件订阅和命令服务给 UI。

**验证：** 运行 `pnpm exec tsx --test src/chat/manager.test.ts src/tool/visibility.test.ts`，期望全部通过。

## T48：增加 /team 命令

**文件：** `src/command/types.ts`、`src/command/builtins.ts`、`src/command/builtins.test.ts`

**依赖：** T46、T47

**步骤：**
1. 为 UI Controller 增加 `manageTeam(args)`。
2. 注册 `/team list|create|use|status|archive|restore`。
3. 校验参数并提供完整用法，不把本地生命周期操作发给模型。
4. 保持命令名、别名和 Skill 命令冲突检测。

**验证：** 运行 `pnpm exec tsx --test src/command/builtins.test.ts`，期望全部通过。

## T49：抽取共用应用服务装配

**文件：** `src/bootstrap/application.ts`、`src/bootstrap/application.test.ts`、`src/index.tsx`

**依赖：** T45-T48

**步骤：**
1. 把 Provider、Registry、MCP、Skill、Agent、Permission、Hook、Worktree 和 Team 初始化移入 `createApplicationServices()`。
2. 统一服务关闭顺序和初始化失败清理。
3. 在 Team 工具注册后初始化角色定义，确保普通子 Agent 能识别并拒绝团队工具。
4. 普通启动路径继续得到原有 ChatManager、诊断和 UI 依赖。

**验证：** 运行 `pnpm exec tsx --test src/bootstrap/application.test.ts` 和 `pnpm typecheck`，期望通过。

## T50：接入独立 Team Worker 入口

**文件：** `src/index.tsx`、`src/team/worker-entry.ts`、`src/bootstrap/application.ts`、对应测试

**依赖：** T35、T36、T49

**步骤：**
1. 解析隐藏 `--team-worker <descriptor-path>` 参数。
2. Worker 模式不渲染 Ink，只创建成员所需服务并启动 WorkerHost。
3. 普通模式拒绝 Worker 专用参数组合，Worker 模式拒绝交互 Provider 选择。
4. 处理 SIGINT/SIGTERM，先保存成员状态和租约再关闭服务。

**验证：** 运行 `pnpm exec tsx --test src/bootstrap/application.test.ts src/team/worker-host.test.ts`，期望入口分流通过。

## T51：接入 UI 状态与团队事件

**文件：** `src/ui/app.tsx`、`src/ui/app.test.ts`

**依赖：** T47-T50

**步骤：**
1. 实现 `/team` UI Controller 方法和结果展示。
2. 状态栏增加 `[TEAM:<name>]` 与 `[COORDINATOR]`。
3. `/status` 展示成员、任务、待审批、未读消息和集成摘要。
4. 订阅团队事件，只显示脱敏摘要并刷新状态。
5. 未激活团队时保持现有 UI 文案和布局。

**验证：** 运行 `pnpm exec tsx --test src/ui/app.test.ts`，期望全部通过。

## T52：提交主流程接入检查点

**文件：** 阶段六全部文件

**依赖：** T44-T51

**步骤：**
1. 运行 Chat、Command、Bootstrap、UI 和 Coordinator 定向测试。
2. 运行 `pnpm typecheck`。
3. 确认系统名称全部为 BetterCode，新增注释为中文。
4. 创建中文 Git 提交 `feat(团队): 接入Team Lead与终端界面`。

**验证：** 运行 `git show --stat --oneline HEAD`，期望提交范围正确。

## 阶段七：端到端与回归

## T53：实现协程团队端到端场景

**文件：** `src/team/integration.test.ts`

**依赖：** T52

**步骤：**
1. 使用临时用户目录、临时 Git 仓库、Fake Provider 和协程后端创建团队。
2. 创建只读与可写成员，验证根目录和 Worktree 隔离。
3. 创建 DAG 任务、分派、成员通信、审批、执行、空闲和后续恢复。
4. 验证普通子 Agent 看不到团队工具。

**验证：** 运行 `pnpm exec tsx --test src/team/integration.test.ts`，期望完整协作场景通过。

## T54：实现重启与故障恢复场景

**文件：** `src/team/integration.test.ts`

**依赖：** T53

**步骤：**
1. 在 running、waiting approval 和 idle 状态模拟进程重启。
2. 验证 generation 使旧 Worker 失效，running 变为 interrupted。
3. 构造未配对副作用操作，验证禁止自动恢复。
4. 注入邮箱锁、唤醒、成员和后端失败，验证其他成员继续运行。

**验证：** 运行 `pnpm exec tsx --test src/team/integration.test.ts`，期望恢复与隔离场景通过。

## T55：实现事务式 Git 集成场景

**文件：** `src/team/integration.test.ts`

**依赖：** T53

**步骤：**
1. 创建无冲突、多任务依赖和冲突分支。
2. 验证临时集成、可继续冲突、验证失败和 abort。
3. 验证失败时 Lead HEAD 与工作区不变，成功时一次 ff-only 更新。
4. 验证已集成 Worktree 可清理，未集成或脏 Worktree保留。

**验证：** 运行 `pnpm exec tsx --test src/team/integration.test.ts`，期望 Git 场景通过。

## T56：实现 Coordinator 双锁端到端场景

**文件：** `src/team/integration.test.ts`、`src/ui/app.test.ts`

**依赖：** T42、T51、T53

**步骤：**
1. 覆盖配置开关与环境变量四种组合。
2. 验证仅双锁满足时移除普通副作用工具并显示状态标记。
3. 验证允许 Git 查询和团队编排命令。
4. 验证重定向、脚本解释器和文件修改命令执行前被拒绝。

**验证：** 运行 `pnpm exec tsx --test src/team/integration.test.ts src/ui/app.test.ts`，期望全部通过。

## T57：运行完整回归并修复本章问题

**文件：** 本章涉及文件

**依赖：** T53-T56

**步骤：**
1. 运行 `pnpm check`。
2. 只修复由团队系统引入的类型、测试或行为回归。
3. 重跑失败的最小测试，再重跑完整检查。
4. 检查测试未依赖真实 tmux、WezTerm、iTerm2 或外部 API。

**验证：** `pnpm check` 退出码为 0。

## T58：执行文档验收并提交大型 Plan 检查点

**文件：** `docs/team-system/checklist.md`、本章全部实现文件

**依赖：** T57、已批准的 checklist.md

**步骤：**
1. 按 checklist.md 逐项执行并记录实际证据。
2. 检查仓库中没有新增旧系统名称、英文 Git 提交信息或英文新增注释。
3. 检查 `.bettercode/` 运行数据未进入提交。
4. 创建中文 Git 提交 `feat(团队): 完成长驻多Agent协作系统`。
5. 输出最终验收报告和提交编号。

**验证：** 运行 `git log -1 --oneline`、`git status --short` 和 `pnpm check`，期望最终提交为中文、工作区仅保留用户原有未提交内容、完整检查通过。

## 执行顺序

```text
T1 → T2
 ├→ T3 → T4 → T6 → T7 → T8
 └────────→ T5 ─┘

T9 → T10 ─┬→ T12 → T13 ─┐
T11 ───────┘              ├→ T17
T10 → T14                 │
T15 → T16 ────────────────┘

T18 → T19
  └→ T20 → T21
T14 + T18 + T20 → T22 → T23 → T24

T25 → T26 → T27/T28/T29/T30/T31
T20 + T21 + T23 → T32 → T33 → T34
T7 + T33 → T35 → T36
后端任务 + T36 → T37

T34 → T38 → T39 → T40 → T41
T22 + T39 → T42
T38-T42 → T43

T13 → T44
T7 + T26 + T33 + T41 + T44 → T45 → T46
T20 + T23 + T44-T46 → T47 → T48 → T49 → T50 → T51 → T52

T52 → T53 → T54
          ├→ T55
T42 + T51 └→ T56
T53-T56 → T57 → T58
```
