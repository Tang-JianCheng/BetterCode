# BetterCode Worktree 隔离系统 Checklist

> 每一项都通过运行测试、执行命令或观察任务结果验证；不以阅读具体实现代码作为通过依据。

## 角色与配置

- [ ] 旧角色定义不包含 `isolation` 时仍能加载，并归一化为不隔离。（验证：运行 `pnpm exec tsx --test src/subagent/parser.test.ts src/subagent/loader.test.ts`，观察兼容用例通过）
- [ ] `isolation: worktree` 只对定义式子 Agent 生效，普通定义式和 Fork 继续使用主工作区。（验证：运行 `pnpm exec tsx --test src/subagent/runner.test.ts src/subagent/integration.test.ts`，比较三类任务的 cwd）
- [ ] isolation 使用未知值时只禁用对应角色并给出来源明确的解析诊断。（验证：运行角色 parser 与 definition manager 非法值用例，观察其他角色仍可加载）
- [ ] `worktrees` 缺省时使用七天保留期、一小时扫描间隔和内置初始化惯例。（验证：运行 `pnpm exec tsx --test src/config/loader.test.ts`，观察解析结果）
- [ ] 非法保留期限、扫描间隔、未知字段、绝对规则路径和 `..` 规则路径在配置加载时被拒绝。（验证：运行 config loader 边界用例，观察每类输入返回具体字段错误）

## 名称与路径安全

- [ ] 合法名称 `<角色>/<任务编号>` 映射到 `.bettercode/worktrees/<名称>` 和 `bettercode/worktree/<名称>`。（验证：运行 `pnpm exec tsx --test src/worktree/name.test.ts src/worktree/path-guard.test.ts`，观察映射断言）
- [ ] 名称总长 120、单段 48 的边界按定义执行。（验证：运行名称长度边界用例，观察边界值通过、超一字符失败）
- [ ] 绝对路径、空段、`.`、`..`、连续点号、控制字符、`.lock`、`@{` 和非法 Git 引用在任何 Git 调用前被拒绝。（验证：运行 name 恶意输入表驱动测试，并断言 Git spy 调用数为零）
- [ ] 路径包含关系使用真实路径判断，相似字符串前缀不能冒充 Worktree 根目录子路径。（验证：运行 path guard 前缀碰撞用例）
- [ ] `.bettercode`、Worktree 父目录、复制源或复制目标中的符号链接不能逃逸主仓库和目标 Worktree。（验证：运行 path guard 与 initializer 符号链接用例）
- [ ] 强制删除也不能绕过名称、真实路径、仓库身份和元数据归属校验。（验证：运行 manager `force: true` 的越界与归属不匹配用例）

## 创建与恢复

- [ ] 新 Worktree 位于固定忽略目录，并从创建时主工作区当前 `HEAD` 建立专属分支。（验证：运行真实 Git manager 创建测试，比较 `rev-parse HEAD`、路径和分支）
- [ ] 主工作区已暂存、未暂存和未追踪的修改不会出现在新 Worktree 中。（验证：在临时仓库制造三类修改后创建 Worktree，检查目标文件内容与列表）
- [ ] 同一角色的两个任务使用不同任务编号、目录和分支。（验证：运行双任务并发集成测试，比较 task snapshot）
- [ ] 两个调用并发创建同一安全名称时只执行一次 Git 创建，不产生重复分支或损坏元数据。（验证：运行 manager 同名并发用例，观察 Git 调用数与最终登记）
- [ ] 创建按 creating、Git Worktree、初始化、ready 顺序落盘，成功元数据包含仓库、路径、分支、基点和时间。（验证：运行 manager 创建事件测试并读取状态文件）
- [ ] Git 创建或必需初始化失败时只回滚本次创建的资源，不删除调用前存在的目录、分支或元数据。（验证：分别注入 Git 和 initializer 失败，比较失败前后文件系统）
- [ ] 合法已存在目录通过元数据、`.git` 指针和关联 `HEAD` 文件快速恢复，恢复路径不调用任何 Git 客户端方法。（验证：运行 manager 快速恢复 spy 用例，断言 Git 调用数为零）
- [ ] 元数据缺失、版本不兼容、仓库身份不符、路径不符、Git dir 越界或分支不符时拒绝快速恢复且不改动目录。（验证：运行 manager 恢复异常参数化用例，比较目录哈希）

## 环境初始化

- [ ] 主工作区存在 `.env`、`.env.local`、`.env.*.local` 或 `BETTERCODE.local.md` 时，首次创建会安全复制对应文件。（验证：运行 initializer 内置复制用例，比较内容和权限）
- [ ] 主工作区存在 `node_modules` 时，目标得到指向同一源的相对软链；源不存在时只跳过，不创建悬空默认链接。（验证：运行 initializer 软链用例并解析链接目标）
- [ ] 主工作区自定义 Git hooks 在隔离 Worktree 中可见且执行目录正确。（验证：在临时仓库安装记录 cwd 的 hook，运行 Worktree 提交并检查记录）
- [ ] 项目 `copy_files`、`ignored_files` 和 `symlinks` 规则按 target 与相对目录结构生效。（验证：运行 initializer 项目规则用例，检查目标树）
- [ ] `ignored_files` 只复制 Git 确认被忽略的候选，不复制同一 glob 命中的受跟踪文件。（验证：运行 initializer tracked/ignored 对照用例）
- [ ] 可选初始化失败只产生有界诊断并继续，必需规则失败使创建失败并触发回滚。（验证：运行 optional/required 对照用例，观察句柄和目录结果）
- [ ] glob 候选超限、目标冲突、目录内部符号链接和复制 Worktree 运行目录的规则被安全拒绝。（验证：运行 initializer 资源上限与逃逸用例）

## 租约与运行时

- [ ] `acquire` 返回规范化绝对 cwd、专属分支、创建基点和唯一 lease ID。（验证：运行 manager acquire 用例，检查句柄字段）
- [ ] 同一 Worktree 的多个租约独立计数，乱序和重复释放不会误减其他租约。（验证：运行 manager 多租约测试，观察 entered/exited 事件计数）
- [ ] 存在任一有效租约时，普通删除、强制删除和过期清理全部拒绝。（验证：持有租约分别调用三条删除路径，观察 `ACTIVE_LEASE`）
- [ ] 最后一个租约退出时更新 lastUsedAt，其他租约退出时不触发自动删除。（验证：用可控时钟运行多租约测试，比较元数据时间和目录存在性）
- [ ] 主进程 cwd 在隔离子 Agent 创建、运行、前台转后台和完成期间始终不变。（验证：集成测试前后读取 `process.cwd()` 并监测代码中无 `process.chdir` 调用）
- [ ] 文件和命令工具在每个 scoped registry 的绝对根目录执行。（验证：两个作用域分别读写同名文件并运行 `pwd`，比较结果）
- [ ] Worktree 权限沙箱只允许当前隔离目录，不能通过相对路径或符号链接操作主工作区。（验证：运行 project runtime 与 permission Worktree 沙箱测试）
- [ ] 共享 MCP 和 Skill 工具保持同一基础连接或实现实例，但执行上下文获得当前 scoped cwd。（验证：运行 registry snapshot 与 project runtime 测试，比较实例及调用 context）

## 缓存与上下文隔离

- [ ] `ToolExecutionState` 使用规范化绝对文件路径作为缓存键。（验证：运行 `pnpm exec tsx --test src/tool/execution-state.test.ts`，观察绝对路径用例）
- [ ] 主工作区和两个 Worktree 中相同相对路径、相同 size 与 mtime 的文件仍拥有不同缓存内容。（验证：运行跨根目录同名文件缓存测试）
- [ ] 两个 Worktree 分别加载各自的项目指令和项目记忆，不读取对方内容。（验证：运行 `pnpm exec tsx --test src/runtime/project-runtime.test.ts`，比较 Supplemental Prompt）
- [ ] 关闭一个 ProjectRuntimeScope 只清理本作用域 ContextManager 和读取状态，不影响另一个作用域。（验证：关闭左侧作用域后继续在右侧运行读取与上下文管理用例）
- [ ] Worktree 进入和退出不依赖清空全局缓存，主 Agent 后续读取仍正常命中自己的状态。（验证：运行主/子/主顺序集成测试，观察主作用域读取结果）

## 子 Agent 集成

- [ ] 隔离任务在 Agent Loop 开始前完成 Worktree acquire 和 ProjectRuntime 创建。（验证：订阅任务与 Worktree 事件，观察 active 先于首个 requesting_model）
- [ ] 隔离子 Agent 的运行时提醒包含绝对路径、专属分支、创建基点和不得操作主工作区的约束。（验证：运行 `pnpm exec tsx --test src/subagent/prompts.test.ts`，检查发送给模拟 Provider 的 System Prompt）
- [ ] Worktree 准备失败返回 `SUBAGENT_WORKTREE_ERROR`，Provider 未被调用，任务不会退回主工作区。（验证：注入 Manager 创建失败，断言 Provider 请求数为零）
- [ ] 正常完成、Agent Loop 异常、用户取消和应用关闭均通过 finally 释放租约。（验证：运行 runner 四类终止用例，检查活动租约为零）
- [ ] 前台超时或手动切后台保持同一 Worktree、任务编号、运行时和累计状态。（验证：运行 runner 前台转后台用例，比较切换前后快照）
- [ ] Hook 启动的定义式隔离角色使用 Worktree，Fork 和普通 Hook 角色保持既有行为。（验证：运行 Hook Agent 集成测试，比较 cwd 与 isolation 状态）
- [ ] scoped Hook 的 `projectRoot` 和 command cwd 等于子 Agent Worktree，而主 Agent Hook 仍使用主根目录。（验证：运行 Hook cwd 对照测试）
- [ ] `/tasks <id>`、前台 ToolResult 和后台回流都显示 deleted、retained 或 failed 结果；展示内容不包含本地配置文件内容。（验证：运行 coordinator、format 和 inbox 测试并检查输出）

## 删除保护

- [ ] 已暂存、未暂存和未追踪文件分别阻止默认删除并返回具体 dirty 原因。（验证：在真实 Worktree 分别制造三类状态后调用 remove）
- [ ] 相对创建基点没有新增提交时，即使专属分支没有 upstream 也允许 clean 删除。（验证：运行无新提交删除用例）
- [ ] 没有 upstream 且存在新增提交时判定为未推送并保留。（验证：提交一处修改但不设置 upstream，观察 retained 原因）
- [ ] 存在 upstream 但 `HEAD` 有上游未包含提交时判定为未推送。（验证：建立本地 bare remote，推送一次后再新增本地提交并检查）
- [ ] 新增提交已被 upstream 包含且工作区 clean 时允许自动删除。（验证：推送专属分支后调用 finalize，检查目录、分支和元数据均消失）
- [ ] 当前分支不再包含创建基点或 Git 状态无法确认时按保护性失败保留。（验证：制造分支偏离和 Git 查询失败，观察 `GIT_STATE_UNKNOWN`）
- [ ] `force: true` 可删除 dirty 或未推送 Worktree，并同步删除专属本地分支和元数据。（验证：运行 force 删除用例，检查三类资源）
- [ ] 删除 Worktree 成功但分支或元数据清理失败时保留可重试状态，不报告完整成功。（验证：注入分阶段失败并再次调用删除）
- [ ] 子 Agent 原始执行结果与 Worktree 清理结果分别记录，retained 不把已完成任务改成 failed。（验证：运行产生修改并正常回答的子 Agent，检查 task state 与 worktree state）

## 过期清理

- [ ] BetterCode 启动时触发一次清理，运行期间默认每小时扫描，定时器不会阻止进程退出。（验证：使用假时钟运行 cleanup scheduler 测试并检查 timer `unref`）
- [ ] lastUsedAt 未超过七天的 Worktree 不进入 Git 保护检查和删除。（验证：运行未过期候选测试并检查 Git spy 调用数）
- [ ] 超过七天且路径、归属、租约、dirty 和 unpushed 检查全部安全的 Worktree 被删除。（验证：运行真实仓库过期 clean 用例）
- [ ] 路径越界、元数据不符、活动租约、dirty、unpushed 和未知目录分别被三层过滤跳过。（验证：运行 cleanup 参数化过滤测试）
- [ ] 清理器从不使用强制删除，单个损坏或失败候选不影响后续安全候选。（验证：第一个候选注入异常，第二个合法，观察第二个仍删除）
- [ ] 并发触发启动扫描、定时扫描和手动扫描时最多一个扫描运行。（验证：运行 cleanup 单飞测试，检查最大并发计数为 1）
- [ ] 关闭清理器后不再启动新扫描，并等待当前扫描安全结束。（验证：运行 close 期间挂起扫描用例）

## 事件与错误

- [ ] 创建、恢复、进入、退出、保留、删除和清理失败都有异步事件可订阅。（验证：运行 manager 事件顺序测试，检查事件集合完整）
- [ ] 事件快照不可变，监听器抛错不会中断 Worktree 生命周期或其他监听器。（验证：注册破坏性和抛错监听器后完成创建与删除）
- [ ] 名称无效、非 Git 仓库、路径越界、目录冲突、元数据不符、Git 创建失败、初始化失败、活动租约、dirty、unpushed 和删除失败均映射为稳定错误码。（验证：运行错误码参数化测试）
- [ ] 错误、诊断、任务事件和 `/tasks` 输出有大小上限，且不包含环境变量值、Provider key、本地配置内容或 Hook secret。（验证：注入超长敏感输入并搜索输出）
- [ ] 单个 Worktree 创建、初始化或清理失败不会退出 BetterCode，也不会取消其他子 Agent。（验证：并发运行一个失败任务和一个成功任务，观察成功任务完成）

## 兼容与范围

- [ ] 未启用 Worktree 时，主 Agent、普通定义式、Fork、工具、权限、Hook、Skill、记忆、上下文、会话和 Provider 测试全部保持通过。（验证：运行 `pnpm check`）
- [ ] 当前目录不是 Git 仓库时，未隔离 BetterCode 仍能启动；调用隔离角色时才返回明确不可用错误。（验证：在临时非 Git 目录运行装配测试）
- [ ] `.bettercode/worktrees/` 和 `.bettercode/worktree-state/` 被 Git 忽略，用户现有 `.bettercode/` 数据不被修改或提交。（验证：运行 `git check-ignore` 检查两个目录并审阅 `git status --short`）
- [ ] 系统不会自动 merge、rebase、cherry-pick、同步主工作区后续修改、提交或 push Worktree 分支。（验证：使用记录型 Git client 检查完整生命周期调用白名单）
- [ ] 系统不会为 Fork 创建 Worktree，不会复制主工作区未提交修改，也不会删除缺少 BetterCode 元数据的目录。（验证：运行对应三类端到端边界场景）
- [ ] 用户可见文档、Prompt、事件和错误统一使用 BetterCode 名称。（验证：扫描 `src`、Spec 与 Plan，期望不存在旧名称）

## 编译与测试

- [ ] TypeScript 严格类型检查通过。（验证：运行 `pnpm typecheck`，退出码为 0）
- [ ] Worktree 单元与集成测试全部通过。（验证：运行 `pnpm exec tsx --test src/worktree/*.test.ts src/runtime/project-runtime.test.ts`，退出码为 0）
- [ ] 子 Agent、工具、权限与 Hook 相关回归测试通过。（验证：运行 `pnpm exec tsx --test src/subagent/*.test.ts src/tool/*.test.ts src/permission/*.test.ts src/hook/*.test.ts`，退出码为 0）
- [ ] 项目完整测试通过且没有未处理 Promise rejection。（验证：运行 `pnpm test`，观察退出码为 0 且 stderr 无未处理拒绝）
- [ ] Git diff 不包含空白错误或意外生成文件。（验证：运行 `git diff --check` 和 `git status --short`）
- [ ] 本章新增源码注释和阶段性 Git 提交信息使用中文。（验证：审阅本章 diff 与提交信息）

## 端到端场景

- [ ] **并发隔离修改**：从同一 `HEAD` 启动两个 Worktree 定义式子 Agent，分别修改相同相对路径；看到两个不同分支和不同文件内容，主工作区文件不变。（验证：运行 `src/subagent/integration.test.ts` 双任务场景）
- [ ] **安全自动清理**：隔离子 Agent 只读完成且未产生提交；看到任务完成后 Worktree、专属本地分支和元数据自动删除。（验证：运行 clean 完成场景并检查三类资源）
- [ ] **成果保护**：隔离子 Agent 修改文件或产生未推送提交后完成；看到任务仍为 completed，Worktree 状态为 retained，并返回路径、分支和原因。（验证：运行 dirty 与 unpushed 两个场景）
- [ ] **推送后清理**：保留的专属分支设置 upstream 并推送，再执行普通删除；看到 Worktree、本地分支和元数据被删除，远程分支不受影响。（验证：使用临时 bare remote 执行完整流程）
- [ ] **快速恢复**：模拟 BetterCode 中断后保留 ready Worktree，重新构造 Manager 并 acquire；看到原路径和分支被恢复，过程中没有 Git 调用。（验证：运行恢复 spy 场景）
- [ ] **过期三层过滤**：准备一个安全过期目录、一个 dirty 目录、一个未推送目录和一个未知目录；启动清理后只删除安全目录。（验证：运行 cleanup 综合场景并比较目录集合）
- [ ] **隔离失败不降级**：让 Worktree 创建失败并同时运行普通子 Agent；看到隔离任务明确失败且 Provider 未调用，普通任务仍在主目录完成。（验证：运行双任务故障隔离场景）
