# BetterCode Worktree 隔离系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `src/config/types.ts` | Worktree 配置类型 |
| 修改 | `src/config/loader.ts` | Worktree 配置解析与校验 |
| 修改 | `src/config/loader.test.ts` | 配置合法值、默认值和边界测试 |
| 新建 | `src/worktree/types.ts` | 生命周期、元数据、租约、事件和错误类型 |
| 新建 | `src/worktree/name.ts` | 安全名称与 Git 分支后缀校验 |
| 新建 | `src/worktree/name.test.ts` | 名称遍历、长度和 Git ref 边界测试 |
| 新建 | `src/worktree/path-guard.ts` | 主仓库、Worktree、复制源和目标路径保护 |
| 新建 | `src/worktree/path-guard.test.ts` | 真实路径、前缀碰撞和符号链接测试 |
| 新建 | `src/worktree/git-client.ts` | 无 shell Git 命令与 Worktree 操作封装 |
| 新建 | `src/worktree/git-client.test.ts` | 真实临时仓库 Git 行为测试 |
| 新建 | `src/worktree/metadata-store.ts` | 原子元数据读写和有界扫描 |
| 新建 | `src/worktree/metadata-store.test.ts` | 元数据损坏、越界和并发写入测试 |
| 新建 | `src/worktree/initializer.ts` | hooks、复制、ignored 文件和软链初始化 |
| 新建 | `src/worktree/initializer.test.ts` | 初始化顺序、required 和路径安全测试 |
| 新建 | `src/worktree/manager.ts` | 创建、恢复、租约、删除和回滚 |
| 新建 | `src/worktree/manager.test.ts` | 完整生命周期与保护测试 |
| 新建 | `src/worktree/cleanup.ts` | 启动及定时过期清理 |
| 新建 | `src/worktree/cleanup.test.ts` | 三层过滤、并发扫描和关闭测试 |
| 新建 | `src/runtime/project-runtime.ts` | 按绝对根目录构造项目运行时作用域 |
| 新建 | `src/runtime/project-runtime.test.ts` | 工具、权限、提示和缓存隔离测试 |
| 修改 | `src/tool/types.ts` | Worktree 相关稳定工具错误码 |
| 修改 | `src/tool/registry.ts` | 只读注册快照与作用域复制支持 |
| 修改 | `src/tool/registry.test.ts` | 注册快照与核心工具替换测试 |
| 修改 | `src/tool/factory.ts` | Scoped ToolRegistry 工厂 |
| 修改 | `src/tool/execution-state.ts` | 绝对路径文件读取缓存键 |
| 修改 | `src/tool/execution-state.test.ts` | 跨工作区同名路径缓存测试 |
| 修改 | `src/tool/tools/read-file.ts` | 使用绝对路径访问读取缓存 |
| 修改 | `src/permission/factory.ts` | 针对目标 ToolRegistry 创建权限实例 |
| 修改 | `src/permission/manager.test.ts` | Worktree 沙箱和规则根目录测试 |
| 修改 | `src/hook/types.ts` | 子 Agent Hook scope 项目根目录 |
| 修改 | `src/hook/manager.ts` | Scoped HookContext 使用实际 cwd |
| 修改 | `src/hook/action-executor.ts` | Hook 命令使用事件 projectRoot |
| 修改 | `src/hook/manager.test.ts` | 主/子 Agent Hook cwd 隔离测试 |
| 修改 | `src/subagent/types.ts` | 角色 isolation 与任务 Worktree 状态 |
| 修改 | `src/subagent/parser.ts` | isolation frontmatter 解析 |
| 修改 | `src/subagent/parser.test.ts` | isolation 缺省、合法和非法值测试 |
| 修改 | `src/subagent/prompts.ts` | Worktree 路径与分支约束提示 |
| 修改 | `src/subagent/prompts.test.ts` | 隔离提示测试 |
| 修改 | `src/subagent/task-manager.ts` | 隔离状态更新和事件发布 |
| 修改 | `src/subagent/task-manager.test.ts` | 隔离状态机和终态测试 |
| 修改 | `src/subagent/runner.ts` | Worktree 获取、Scoped Runtime 和清理 |
| 修改 | `src/subagent/runner.test.ts` | 正常、异常、取消和保留路径测试 |
| 修改 | `src/subagent/coordinator.ts` | 调度状态和前台工具结果元数据 |
| 修改 | `src/subagent/format.ts` | `/tasks` 与后台结果展示隔离状态 |
| 修改 | `src/subagent/format.test.ts` | Worktree 任务格式化测试 |
| 修改 | `src/subagent/integration.test.ts` | 两个隔离子 Agent 并发端到端测试 |
| 修改 | `src/index.tsx` | Worktree 服务启动、注入和关闭 |
| 修改 | `.gitignore` | 忽略 Worktree 目录和元数据 |
| 修改 | `config.yaml` | Worktree 可选配置示例 |

## T1：定义 Worktree 配置类型

**文件：** `src/config/types.ts`

**依赖：** 无

**步骤：**
1. 增加复制规则、软链规则和 `WorktreeConfig` 接口。
2. 在 `AppConfig` 增加可选 `worktrees` 字段。
3. 保持现有 Provider、Agent model 和 SubAgent 配置兼容。

**验证：** 运行 `pnpm typecheck`，期望现有代码在尚未使用新配置时编译通过。

## T2：实现 Worktree 配置解析

**文件：** `src/config/loader.ts`, `src/config/loader.test.ts`

**依赖：** T1

**步骤：**
1. 增加 `worktrees` 允许字段集合和对象解析入口。
2. 校验保留天数、扫描间隔、规则数量、source、target、required 和未知字段。
3. 在配置阶段拒绝绝对路径、反斜杠、空路径和 `..` 段。
4. 增加合法配置、缺省配置、范围边界和逐类非法输入测试。

**验证：** 运行 `pnpm exec tsx --test src/config/loader.test.ts`，期望 Worktree 配置用例全部通过且旧配置测试无回归。

## T3：定义 Worktree 领域类型与稳定错误

**文件：** `src/worktree/types.ts`, `src/tool/types.ts`

**依赖：** T1

**步骤：**
1. 定义元数据、初始化诊断、句柄、租约、保护状态、删除结果和事件类型。
2. 定义 `WorktreeErrorCode` 与携带有界 details 的 `WorktreeError`。
3. 为子 Agent 隔离准备失败增加稳定 Tool 错误码 `SUBAGENT_WORKTREE_ERROR`。
4. 定义默认保留期限、扫描间隔和资源上限常量。

**验证：** 运行 `pnpm typecheck`，期望新增类型可独立编译且既有 ToolResult 不受影响。

## T4：实现安全名称校验

**文件：** `src/worktree/name.ts`, `src/worktree/name.test.ts`

**依赖：** T3

**步骤：**
1. 实现总长 120、单段 48 的分段名称校验。
2. 允许小写字母、数字、点、下划线、短横线和正斜杠。
3. 拒绝空段、`.`、`..`、连续点号、首尾点号、`.lock`、`@{`、控制字符和 Git ref 非法形式。
4. 增加合法嵌套名称、每类恶意输入和长度边界测试。

**验证：** 运行 `pnpm exec tsx --test src/worktree/name.test.ts`，期望所有合法名称归一化成功，非法名称均在文件系统操作前报 `INVALID_NAME`。

## T5：实现 Worktree 路径守卫

**文件：** `src/worktree/path-guard.ts`, `src/worktree/path-guard.test.ts`

**依赖：** T4

**步骤：**
1. 构造主根目录、Worktree 根目录和元数据根目录的规范化绝对路径。
2. 根据安全名称生成目录、分支和元数据路径。
3. 对现有路径解析真实路径，对待创建路径解析最近存在父目录。
4. 使用 `path.relative` 验证包含关系，拒绝前缀碰撞、根目录符号链接和源/目标逃逸。
5. 增加普通路径、相似前缀、外部符号链接、悬空符号链接和嵌套名称测试。

**验证：** 运行 `pnpm exec tsx --test src/worktree/path-guard.test.ts`，期望仓库内路径通过，所有逃逸路径返回 `PATH_OUTSIDE_ROOT`。

## T6：实现原子元数据存储

**文件：** `src/worktree/metadata-store.ts`, `src/worktree/metadata-store.test.ts`

**依赖：** T3、T5

**步骤：**
1. 实现按 `<name>.json` 嵌套保存的严格元数据序列化和解析。
2. 使用同目录临时文件、限制权限和原子 rename 写入。
3. 实现读取、删除、空父目录清理和最多固定数量的有界扫描。
4. 校验版本、仓库身份、路径、分支、日期和 initializationComplete 字段。
5. 测试损坏 JSON、字段缺失、路径越界、并发写入和扫描上限。

**验证：** 运行 `pnpm exec tsx --test src/worktree/metadata-store.test.ts`，期望合法状态可往返，损坏或越界状态被隔离且不影响其他记录。

## T7：实现受限 Git 命令执行器

**文件：** `src/worktree/git-client.ts`, `src/worktree/git-client.test.ts`

**依赖：** T3

**步骤：**
1. 封装无 shell、参数数组、显式 cwd 的 Git 子进程执行器。
2. 加入超时、取消、stdout/stderr 上限和稳定错误摘要。
3. 实现仓库根目录、common Git dir、仓库身份和 `HEAD` 解析。
4. 用临时 Git 仓库测试正常、非仓库、超时和路径含空格场景。

**验证：** 运行 `pnpm exec tsx --test src/worktree/git-client.test.ts --test-name-pattern='仓库|命令'`，期望仓库身份稳定且命令不经过 shell。

## T8：实现 Git Worktree 创建与 hooks 配置

**文件：** `src/worktree/git-client.ts`, `src/worktree/git-client.test.ts`

**依赖：** T7

**步骤：**
1. 实现从指定基点创建专属分支和 Worktree。
2. 返回并校验 Worktree 的 Git dir 指针。
3. 读取主工作区有效 hooks 路径，并按需配置 worktree-specific hooks。
4. 实现批量 `check-ignore` 供 ignored 文件规则使用。
5. 测试创建分支、主工作区 dirty 不继承、自定义 hooks 和 ignored 识别。

**验证：** 运行 `pnpm exec tsx --test src/worktree/git-client.test.ts --test-name-pattern='创建|hooks|忽略'`，期望临时 Worktree 从指定提交建立且 hooks 可见。

## T9：实现 Git 变更保护与删除原语

**文件：** `src/worktree/git-client.ts`, `src/worktree/git-client.test.ts`

**依赖：** T8

**步骤：**
1. 实现 staged、unstaged、untracked 的 dirty 检查。
2. 实现创建基点祖先校验、新提交计数、上游解析和未推送判断。
3. 实现 `git worktree list --porcelain` 的路径与分支登记校验。
4. 实现 Worktree 移除和专属本地分支删除原语。
5. 测试无新提交、无 upstream 新提交、已推送提交、偏离基点、dirty 和登记不一致。

**验证：** 运行 `pnpm exec tsx --test src/worktree/git-client.test.ts --test-name-pattern='保护|删除|上游'`，期望各保护状态和删除结果符合 Plan 算法。

## T10：实现初始化规则展开与安全复制

**文件：** `src/worktree/initializer.ts`, `src/worktree/initializer.test.ts`

**依赖：** T2、T5、T8

**步骤：**
1. 合并内置复制规则、项目 copy_files 和 ignored_files 规则。
2. 使用 `fast-glob` 有界展开规则，保留相对目录结构。
3. ignored_files 候选必须经过 Git ignored 校验。
4. 复制前后执行源和目标真实路径检查，保留文件权限，不跟随目录内符号链接。
5. 拒绝复制 Worktree 根和元数据根，拒绝覆盖未知目标。
6. 测试 glob、ignored 过滤、权限、候选上限和符号链接逃逸。

**验证：** 运行 `pnpm exec tsx --test src/worktree/initializer.test.ts --test-name-pattern='复制|忽略|路径'`，期望仅安全候选复制到目标相对位置。

## T11：实现依赖软链、Git hooks 与 required 语义

**文件：** `src/worktree/initializer.ts`, `src/worktree/initializer.test.ts`

**依赖：** T10

**步骤：**
1. 在初始化开头调用 Git hooks 配置。
2. 增加内置 `node_modules` 和项目 symlinks 规则。
3. 使用相对软链，目标已存在时只接受等价文件或同源链接。
4. 可选规则失败收集有界诊断，必需规则失败抛出 `INITIALIZATION_FAILED`。
5. 测试可选继续、必需终止、同源幂等、目标冲突和软链逃逸。

**验证：** 运行 `pnpm exec tsx --test src/worktree/initializer.test.ts`，期望初始化顺序、诊断和 required 行为全部通过。

## T12：实现 Worktree 首次创建与回滚

**文件：** `src/worktree/manager.ts`, `src/worktree/manager.test.ts`

**依赖：** T6、T8、T11

**步骤：**
1. 实现 Manager 初始化和按安全名称串行化的 Promise 队列。
2. 实现创建前路径冲突、分支位置和元数据检查。
3. 按 creating 元数据、Git 创建、初始化、ready 元数据的顺序创建。
4. 跟踪本次调用实际创建的资源，必需步骤失败时只回滚这些资源。
5. 测试正常创建、同名并发、Git 失败、初始化失败和已有未知目录。

**验证：** 运行 `pnpm exec tsx --test src/worktree/manager.test.ts --test-name-pattern='创建|回滚|并发'`，期望创建顺序稳定且失败不删除预存内容。

## T13：实现无 Git 快速恢复

**文件：** `src/worktree/manager.ts`, `src/worktree/manager.test.ts`

**依赖：** T12

**步骤：**
1. 目录存在时读取并验证 ready/retained 元数据。
2. 解析 Worktree `.git` 指针并限制在记录的 common Git dir 下。
3. 读取关联 `HEAD` 文件确认专属分支，确认初始化完成。
4. 更新 lastUsedAt 并返回 recovered 句柄，不调用 Git 客户端或初始化器。
5. 用记录型依赖断言合法恢复零 Git 调用，并测试元数据、Git dir、HEAD 和分支不一致。

**验证：** 运行 `pnpm exec tsx --test src/worktree/manager.test.ts --test-name-pattern='恢复'`，期望合法目录只读恢复，任何不一致均拒绝接管。

## T14：实现进入、退出与引用计数租约

**文件：** `src/worktree/manager.ts`, `src/worktree/manager.test.ts`

**依赖：** T13

**步骤：**
1. 实现 `enter`、`acquire` 和随机 lease ID。
2. 按名称维护活动租约集合和引用计数。
3. 实现幂等 `exit`，最后租约释放时更新 lastUsedAt。
4. 在任何删除路径前拒绝活动租约。
5. 测试多租约、乱序释放、重复释放、未知租约和运行中删除。

**验证：** 运行 `pnpm exec tsx --test src/worktree/manager.test.ts --test-name-pattern='租约|进入|退出'`，期望计数准确且活动目录无法删除。

## T15：实现安全删除、强制删除与 finalize

**文件：** `src/worktree/manager.ts`, `src/worktree/manager.test.ts`

**依赖：** T9、T14

**步骤：**
1. 删除前重新验证路径、元数据、仓库身份和 Git 登记。
2. 默认删除将 dirty、unpushed 和 Git 状态未知映射为 retained 及具体原因。
3. force 仅跳过 dirty 和 unpushed，不能跳过租约与硬安全校验。
4. 按 deleting 元数据、Worktree 移除、分支删除、元数据删除的顺序执行。
5. 实现 finalize 释放租约后自动尝试默认删除。
6. 测试 clean 删除、dirty 保留、未推送保留、已推送删除、force、部分删除失败和重试。

**验证：** 运行 `pnpm exec tsx --test src/worktree/manager.test.ts --test-name-pattern='删除|保留|finalize'`，期望目录、分支和元数据保持一致。

## T16：实现后台过期清理

**文件：** `src/worktree/cleanup.ts`, `src/worktree/cleanup.test.ts`

**依赖：** T15

**步骤：**
1. 实现启动扫描、`unref` 定时器、单飞扫描和关闭等待。
2. 按 lastUsedAt 与默认七天筛选候选。
3. 依次执行路径、归属/租约、Git 变更三层过滤并调用普通删除。
4. 单候选失败发布诊断后继续，绝不调用 force。
5. 测试未过期、合法过期、路径异常、活动租约、dirty、unpushed、并发触发和 close。

**验证：** 运行 `pnpm exec tsx --test src/worktree/cleanup.test.ts`，期望只有过期且安全的候选被删除。

## T17：把文件读取缓存改为绝对路径键

**文件：** `src/tool/execution-state.ts`, `src/tool/execution-state.test.ts`, `src/tool/tools/read-file.ts`

**依赖：** 无

**步骤：**
1. 将 `CachedFileRead.relativePath` 改为 `absolutePath`。
2. 使用规范化绝对路径完成 get、set 和 invalidate。
3. `read_file` 改用 `PathGuard` 返回的 absolute 路径。
4. 更新旧测试并增加两个根目录同名相对文件不会命中同一缓存的测试。

**验证：** 运行 `pnpm exec tsx --test src/tool/execution-state.test.ts src/tool/tools.test.ts`，期望读取缓存行为和现有文件工具行为全部通过。

## T18：增加 ToolRegistry 注册快照

**文件：** `src/tool/registry.ts`, `src/tool/registry.test.ts`

**依赖：** 无

**步骤：**
1. 定义只读注册快照，包含 Tool 实例和 owner/system 元信息。
2. 返回复制且冻结的快照，不暴露内部 Map。
3. 保证 `replaceOwned` 后快照只包含当前有效注册。
4. 测试普通、系统、动态 owner、替换和调用方修改隔离。

**验证：** 运行 `pnpm exec tsx --test src/tool/registry.test.ts`，期望快照准确且不能修改注册表内部状态。

## T19：实现 Scoped ToolRegistry 工厂

**文件：** `src/tool/factory.ts`, `src/tool/registry.test.ts`

**依赖：** T18

**步骤：**
1. 提取六个核心工具名集合。
2. 为目标根目录重新创建核心工具和 PathGuard。
3. 从主注册快照复制所有非核心工具及 owner/system 元信息。
4. 测试主目录与两个目标目录的核心工具实例不同、共享 MCP/脚本工具实例相同、定义顺序稳定。

**验证：** 运行 `pnpm exec tsx --test src/tool/registry.test.ts --test-name-pattern='作用域|快照'`，期望 scoped registry 根目录正确且工具集合稳定。

## T20：让权限工厂接受目标注册表

**文件：** `src/permission/factory.ts`, `src/permission/manager.test.ts`

**依赖：** T19

**步骤：**
1. 扩展 `PermissionManagerFactory.create`，允许传入 scoped registry，缺省仍使用主注册表。
2. 从目标 registry 构造工具目标类型、项目/local 规则存储和 Sandbox PathGuard。
3. 增加主目录与 Worktree 规则、路径和临时会话权限互不共享的测试。

**验证：** 运行 `pnpm exec tsx --test src/permission/manager.test.ts`，期望 Worktree 权限只允许目标根目录内路径且旧调用保持兼容。

## T21：实现 ProjectRuntimeFactory

**文件：** `src/runtime/project-runtime.ts`, `src/runtime/project-runtime.test.ts`

**依赖：** T17、T19、T20

**步骤：**
1. 定义 ProjectRuntimeScope 和 ProjectRuntimeFactory。
2. 为规范化绝对根目录创建 scoped registry、permission manager、ContextManager 和 ToolExecutionState。
3. 从目标根目录加载项目指令和项目记忆，形成 SupplementalPromptContent。
4. close 时只关闭本作用域上下文和缓存，不影响共享 Provider、MCP、Skill 或主注册表。
5. 测试两个根目录的工具 cwd、沙箱、指令、记忆和同名文件缓存完全隔离。

**验证：** 运行 `pnpm exec tsx --test src/runtime/project-runtime.test.ts`，期望两个作用域互不读取或修改对方路径状态。

## T22：解析角色 isolation 字段

**文件：** `src/subagent/types.ts`, `src/subagent/parser.ts`, `src/subagent/parser.test.ts`

**依赖：** 无

**步骤：**
1. 增加 `AgentIsolation` 和角色 metadata 的 isolation 字段。
2. 将 `isolation` 加入允许 frontmatter 字段。
3. 缺省归一化为 `none`，只接受 `none` 与 `worktree`。
4. 更新全部角色测试夹具，并增加合法、缺省、非法值和未知字段测试。

**验证：** 运行 `pnpm exec tsx --test src/subagent/parser.test.ts src/subagent/loader.test.ts src/subagent/definition-manager.test.ts`，期望旧角色兼容且隔离声明准确。

## T23：增加 Worktree 子 Agent 提示段

**文件：** `src/subagent/prompts.ts`, `src/subagent/prompts.test.ts`

**依赖：** T22

**步骤：**
1. 定义可选 Worktree Prompt 输入，包含绝对 cwd、分支和创建基点。
2. 仅隔离定义式 Agent 增加高优先级约束段。
3. 明确所有工具使用该目录、不得操作主工作区或猜测同步状态。
4. 测试普通定义式 Prompt 不变，隔离 Prompt 包含正确路径且不进入 Fork Prompt。

**验证：** 运行 `pnpm exec tsx --test src/subagent/prompts.test.ts`，期望隔离提示仅在需要时出现。

## T24：扩展任务 Worktree 状态与事件

**文件：** `src/subagent/types.ts`, `src/subagent/task-manager.ts`, `src/subagent/task-manager.test.ts`

**依赖：** T22

**步骤：**
1. 定义 preparing、active、deleted、retained、failed 状态和 `task_worktree` 事件。
2. 启动隔离角色任务时生成初始名称 `<role>/<taskId>`。
3. 实现 `updateWorktree` 唯一写入口，复制冻结输入并拒绝终态被迟到事件覆盖。
4. 测试正常状态链、失败链、终态保护、并发任务隔离和快照不可变。

**验证：** 运行 `pnpm exec tsx --test src/subagent/task-manager.test.ts`，期望 Worktree 状态可观测且不破坏既有任务状态机。

## T25：让 Scoped Hook 使用实际项目根目录

**文件：** `src/hook/types.ts`, `src/hook/manager.ts`, `src/hook/action-executor.ts`, `src/hook/manager.test.ts`

**依赖：** 无

**步骤：**
1. 为 `HookAgentScope` 增加可选 `projectRoot`。
2. 子 Agent scope 构造 HookContext 时使用 scope 根目录，主 Agent 上下文保持主根目录。
3. 命令动作改为使用 `context.projectRoot` 作为 cwd。
4. 测试主 Agent Hook 在主目录执行，两个 scoped Hook 分别在各自目录执行，其他动作不变。

**验证：** 运行 `pnpm exec tsx --test src/hook/manager.test.ts src/hook/action-executor.test.ts`，期望 Hook 命令 cwd 与事件 projectRoot 一致。

## T26：接入 SubAgentRunner 的隔离运行时

**文件：** `src/subagent/runner.ts`, `src/subagent/runner.test.ts`

**依赖：** T14、T21、T23、T24、T25

**步骤：**
1. Runner 注入 WorktreeManager 和 ProjectRuntimeFactory。
2. 普通定义式和 Fork 使用主根目录作用域；`isolation: worktree` 使用任务记录中的安全名称 acquire 租约。
3. 把 scoped registry、permission、context、execution state、supplemental 和 Hook projectRoot 传给 AgentLoop。
4. 隔离 Prompt 注入租约路径、分支和基点。
5. 在统一 finally 中关闭 Hook、上下文、执行状态和 runtime，再 finalize Worktree。
6. 将准备、active、deleted、retained 和 failed 更新回任务管理器。
7. 测试正常完成、AgentLoop 抛错、取消、转后台、保留变更和普通/Fork 不隔离。

**验证：** 运行 `pnpm exec tsx --test src/subagent/runner.test.ts`，期望所有退出路径释放租约且只在声明角色中创建 Worktree。

## T27：接入 Coordinator、任务展示和后台回流

**文件：** `src/subagent/coordinator.ts`, `src/subagent/format.ts`, `src/subagent/format.test.ts`

**依赖：** T24、T26

**步骤：**
1. Coordinator 启动任务时传入角色 isolation，并把更新回调交给 Runner。
2. 隔离准备失败转换为 `SUBAGENT_WORKTREE_ERROR`，不回退主目录。
3. 前台工具结果 metadata 增加有界的 Worktree 状态、路径和分支。
4. `/tasks <id>` 和后台结果摘要增加 deleted/retained/failed 状态及保留原因。
5. 测试前台、后台、Hook Agent 和错误格式不泄露配置或文件内容。

**验证：** 运行 `pnpm exec tsx --test src/subagent/coordinator.test.ts src/subagent/format.test.ts src/subagent/result-inbox.test.ts`，期望各输出包含准确隔离结果且旧任务格式兼容。

## T28：接入启动、清理与关闭顺序

**文件：** `src/index.tsx`, `.gitignore`, `config.yaml`

**依赖：** T2、T16、T21、T27

**步骤：**
1. 启动时根据主根目录和配置构造 Git client、PathGuard、MetadataStore、Initializer、Manager、CleanupScheduler 和 RuntimeFactory。
2. 非 Git 仓库时只禁用 Worktree 隔离能力，不影响未隔离 BetterCode 启动。
3. 把 Manager 和 RuntimeFactory 注入 SubAgentRunner。
4. 关闭时先停止并等待子 Agent，再停止清理器和 Manager，最后关闭共享基础设施。
5. `.gitignore` 增加 `.bettercode/worktrees/` 与 `.bettercode/worktree-state/`。
6. `config.yaml` 增加不含敏感值的注释化可选 Worktree 配置示例。

**验证：** 运行 `pnpm typecheck`，期望应用装配编译通过；运行 `git status --short --ignored .bettercode`，期望 Worktree 和状态目录显示为 ignored。

## T29：补充 Worktree 生命周期集成测试

**文件：** `src/worktree/manager.test.ts`, `src/worktree/cleanup.test.ts`

**依赖：** T16、T28

**步骤：**
1. 在真实临时仓库走创建、初始化、进入、修改、提交、模拟上游、退出和删除完整链路。
2. 验证 dirty 与无 upstream commit 保留，已推送模拟分支可自动删除。
3. 验证快速恢复不执行 Git，force 不绕过活动租约和元数据归属。
4. 验证过期扫描不会处理未知目录或其他工具创建的 Worktree。

**验证：** 运行 `pnpm exec tsx --test src/worktree/manager.test.ts src/worktree/cleanup.test.ts`，期望所有生命周期和三层过滤场景通过。

## T30：补充双子 Agent 并发端到端测试

**文件：** `src/subagent/integration.test.ts`, `src/runtime/project-runtime.test.ts`

**依赖：** T27、T29

**步骤：**
1. 创建两个声明 `isolation: worktree` 的并发定义式任务。
2. 让两个任务读写相同相对路径并执行报告 cwd 的命令。
3. 验证主工作区不变、两个 Worktree 内容不同、分支不同、缓存不串用。
4. 让一个任务保持 dirty、另一个保持 clean，验证前者 retained、后者 deleted。
5. 增加普通定义式和 Fork 继续共享主目录的回归场景。

**验证：** 运行 `pnpm exec tsx --test src/subagent/integration.test.ts src/runtime/project-runtime.test.ts`，期望并发隔离和非隔离兼容场景全部通过。

## T31：执行完整回归与文档一致性检查

**文件：** 本章修改的全部文件、`docs/worktree-system/*.md`

**依赖：** T1-T30

**步骤：**
1. 运行 TypeScript 类型检查和全部测试。
2. 检查源码新增注释与 Git 提交信息使用中文。
3. 扫描用户可见内容，确认只使用 BetterCode 名称。
4. 检查 Spec F1-F14、Plan 模块与实现文件一一对应。
5. 检查工作区，只暂存本章文档和源码，不暂存用户现有 `.bettercode/` 数据。

**验证：** 运行 `pnpm check`、`rg -n "MewCode|Mewcode|mewcode" src docs/worktree-system/spec.md docs/worktree-system/plan.md` 和 `git diff --check`，期望测试全通过、本章无旧名称且 diff 无格式错误。

## 执行顺序

```text
T1 -> T2 -----------\
T3 -> T4 -> T5 -> T6 \
T3 -> T7 -> T8 -> T9  -> T12 -> T13 -> T14 -> T15 -> T16 ----\
T2 + T5 + T8 -> T10 -> T11 -------------------------------/   \
T17 ------------------------------------------------------------\
T18 -> T19 -> T20 -> T21 -----------------------------------------> T26 -> T27 -> T28 -> T29 -> T30 -> T31
T22 -> T23 -> T24 ----------------------------------------------/
T25 -----------------------------------------------------------/
```

可并行组：

- T1-T2、T3-T16、T17、T18-T21、T22-T24、T25 在各自依赖满足后可并行推进。
- T26 是核心汇合点，必须等待生命周期、运行时、角色状态与 Hook cwd 完成。
- T29 与 T30 只在应用装配完成后执行，避免测试夹具重复返工。
