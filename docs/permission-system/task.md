# BetterCode 五层权限系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|---|---|---|
| 新建 | `.gitignore` | 忽略项目本地权限配置 |
| 修改 | `package.json` | 增加 `minimatch` 直接依赖 |
| 修改 | `pnpm-lock.yaml` | 锁定新增依赖版本 |
| 新建 | `src/permission/types.ts` | 权限模式、规则、请求、决定、结果与诊断类型 |
| 新建 | `src/permission/command-blacklist.ts` | 不可配置危险命令匹配 |
| 新建 | `src/permission/command-blacklist.test.ts` | 黑名单正例、负例与不可绕过场景 |
| 新建 | `src/permission/sandbox.ts` | 权限目标提取、规范化与路径预检 |
| 新建 | `src/permission/sandbox.test.ts` | 路径、glob 与符号链接沙箱测试 |
| 新建 | `src/permission/rule-parser.ts` | 权限表达式解析、转义与 glob 编译 |
| 新建 | `src/permission/rule-parser.test.ts` | 工具级、精确、glob 和非法规则测试 |
| 新建 | `src/permission/rule-engine.ts` | 四层规则维护、优先级和最佳匹配 |
| 新建 | `src/permission/rule-engine.test.ts` | 跨层与同层冲突测试 |
| 新建 | `src/permission/config-store.ts` | 三层 YAML 加载、诊断和本地规则持久化 |
| 新建 | `src/permission/config-store.test.ts` | 配置加载、失败关闭和原子写入测试 |
| 新建 | `src/permission/manager.ts` | 五层权限判定、模式和人工确认编排 |
| 新建 | `src/permission/manager.test.ts` | 强制层、规则、模式、授权时效和取消测试 |
| 新建 | `src/permission/factory.ts` | 权限模块启动装配 |
| 修改 | `src/tool/types.ts` | 工具权限画像和权限错误码 |
| 修改 | `src/tool/registry.ts` | 提供无副作用参数预检接口 |
| 修改 | `src/tool/registry.test.ts` | 参数预检与权限画像隔离测试 |
| 修改 | `src/tool/tools/read-file.ts` | 声明读取路径权限画像 |
| 修改 | `src/tool/tools/write-file.ts` | 声明写入路径权限画像 |
| 修改 | `src/tool/tools/edit-file.ts` | 声明编辑路径权限画像 |
| 修改 | `src/tool/tools/run-command.ts` | 声明命令权限画像 |
| 修改 | `src/tool/tools/find-files.ts` | 声明 glob 权限画像 |
| 修改 | `src/tool/tools/search-code.ts` | 声明带默认值的 glob 权限画像 |
| 修改 | `src/tool/tools.test.ts` | 六个工具权限画像测试 |
| 修改 | `src/agent/types.ts` | 权限事件、进度阶段和决策器运行选项 |
| 修改 | `src/agent/tool-scheduler.ts` | 串行判权与分组执行 |
| 修改 | `src/agent/tool-scheduler.test.ts` | 权限调度、顺序、并发与取消测试 |
| 修改 | `src/agent/loop.ts` | 透传权限决策器并保持拒绝后循环 |
| 修改 | `src/agent/loop.test.ts` | 权限拒绝恢复与事件集成测试 |
| 修改 | `src/chat/manager.ts` | 权限模式控制和会话规则生命周期 |
| 修改 | `src/chat/manager.test.ts` | 模式切换、清理和决策器透传测试 |
| 新建 | `src/ui/permission-prompt.tsx` | Ink 人工权限确认面板 |
| 修改 | `src/ui/app.tsx` | 权限 Promise、模式命令和状态展示 |
| 修改 | `src/index.tsx` | 权限模式参数、配置加载和依赖装配 |

所有新增代码注释使用中文。现有英文标识符、第三方 API 名称和错误码保持项目既有风格，不为本阶段改写无关注释。

## T1：确认实现前基线

**文件：** 无

**依赖：** 无，必须在任何实现代码修改前完成

**步骤：**

1. 运行项目现有类型检查和全部测试，记录退出状态与失败用例。
2. 确认当前未提交的系统提示改动仍能通过验证，不覆盖或回退这些改动。
3. 检查 `git status --short`，记录实现前已有改动和未跟踪文件。
4. 如果存在与权限系统无关的基线失败，只记录并隔离，不擅自修复。

**验证：** 运行 `pnpm check` 和 `git status --short`，期望获得可复核的基线结果与工作区清单。

## T2：加入 glob 依赖和本地配置忽略项

**文件：** `package.json`、`pnpm-lock.yaml`、`.gitignore`

**依赖：** T1

**步骤：**

1. 使用 pnpm 把 `minimatch` 加为运行时直接依赖，并同步 lockfile。
2. 创建 `.gitignore`，加入 `.bettercode/permissions.local.yaml`。
3. 如果实现时 `.gitignore` 已由用户创建，则只追加缺失规则，不覆盖已有内容。
4. 不忽略项目共享的 `.bettercode/permissions.yaml`。

**验证：** 运行 `pnpm list minimatch --depth 0`，期望显示直接依赖；运行 `git check-ignore .bettercode/permissions.local.yaml`，期望命中本地权限文件。

## T3：定义权限公共类型

**文件：** `src/permission/types.ts`、`src/tool/types.ts`

**依赖：** T2

**步骤：**

1. 定义 `PermissionMode`、`PermissionEffect`、`PermissionRuleLayer` 和 `PermissionPatternKind`。
2. 定义 `PermissionRule`、`RuleMatch`、`PermissionDiagnostic` 和 `PermissionStatus`。
3. 定义 `PermissionChoice`、`PermissionRequest`、`PermissionDecider` 和 `PermissionDecisionSource`。
4. 定义 `PermissionAuthorization` 的允许与拒绝联合类型。
5. 在工具类型中定义 `PermissionTargetKind`、`PermissionPathIntent` 和 `ToolPermissionProfile`。
6. 给 `Tool` 增加只读 `permission` 画像，不把该字段加入 `ToolDefinition`。
7. 给 `ToolErrorCode` 增加五个批准的权限错误码。

**验证：** 运行 `rg -n "PermissionMode|PermissionRequest|PermissionAuthorization|ToolPermissionProfile|DANGEROUS_COMMAND|PERMISSION_CONFIG_ERROR" src/permission/types.ts src/tool/types.ts`，期望所有公共契约均存在且名称与 plan.md 一致。

## T4：为六个工具声明权限画像

**文件：** `src/tool/tools/read-file.ts`、`src/tool/tools/write-file.ts`、`src/tool/tools/edit-file.ts`、`src/tool/tools/run-command.ts`、`src/tool/tools/find-files.ts`、`src/tool/tools/search-code.ts`、`src/tool/tools.test.ts`

**依赖：** T3

**步骤：**

1. `read_file` 声明 `path/existing/read` 画像。
2. `write_file` 声明 `path/write/write` 画像。
3. `edit_file` 声明 `path/existing/write` 画像。
4. `run_command` 声明 `command/execute` 画像。
5. `find_files` 声明 `pattern/glob/read` 画像。
6. `search_code` 声明 `glob/glob/read` 画像，并设置默认目标 `**/*`。
7. 增加测试断言六个画像与设计表完全一致，原执行行为不变。

**验证：** 运行 `pnpm exec tsx --test src/tool/tools.test.ts`，期望六个工具原有行为和新增权限画像断言全部通过。

## T5：增加注册中心参数预检

**文件：** `src/tool/registry.ts`、`src/tool/registry.test.ts`

**依赖：** T4

**步骤：**

1. 抽取现有 Ajv 校验为公开 `validate(call)` 方法。
2. 校验成功返回 `undefined`，失败返回 `INVALID_ARGUMENTS` 结构化结果。
3. `execute()` 继续调用相同校验逻辑，防止底层直接调用绕过参数保护。
4. 保持未知工具、超时、取消、输出限制和异常封装行为不变。
5. 增加测试确认 `definitions()` 不包含本地 `permission` 画像。
6. 增加测试确认预检不会调用工具执行方法或产生副作用。

**验证：** 运行 `pnpm exec tsx --test src/tool/registry.test.ts`，期望参数预检、定义隔离和全部既有注册中心测试通过。

## T6：实现危险命令黑名单

**文件：** `src/permission/command-blacklist.ts`

**依赖：** T3

**步骤：**

1. 定义冻结的 `DangerousCommandPattern` 列表和稳定安全类别。
2. 覆盖系统根目录递归强删、文件系统格式化、裸设备写入、系统关闭或重启、典型 fork bomb。
3. 支持前置 `sudo`、Shell 命令分隔符和常见参数排列。
4. 使用命令入口边界避免把 `echo` 文本、普通文件名或相似子串当作实际高危命令。
5. 实现 `matchDangerousCommand(command)`，只返回类别与描述，不执行命令。
6. 黑名单模块不接受外部规则或关闭开关。

**验证：** 使用 `pnpm exec tsx -e` 调用纯匹配函数检查一个高危样例和一个 `git status` 样例，期望前者返回类别、后者返回 `undefined`。

## T7：覆盖黑名单正反例

**文件：** `src/permission/command-blacklist.test.ts`

**依赖：** T6

**步骤：**

1. 为五类黑名单各添加至少一个直接命中用例。
2. 覆盖 `sudo`、命令链和参数顺序变化。
3. 覆盖 `rm -rf /`、`rm -rf /*` 等根目标变体。
4. 添加构建、测试、Git、项目内删除和仅打印危险文本的负例。
5. 断言返回稳定类别，不断言实现正则文本。
6. 测试中只调用匹配函数，不启动任何子进程。

**验证：** 运行 `pnpm exec tsx --test src/permission/command-blacklist.test.ts`，期望全部高危正例命中且安全负例不命中。

## T8：实现权限路径沙箱

**文件：** `src/permission/sandbox.ts`

**依赖：** T4

**步骤：**

1. 实现 `SandboxPolicy`，构造时接收项目 `PathGuard`。
2. 从工具权限画像声明的参数提取字符串目标；缺失时使用 `defaultTarget`。
3. 路径目标使用 `resolveForWrite()` 完成真实路径或最近存在父目录预检，并返回规范化项目相对路径。
4. glob 目标拒绝绝对模式和独立 `..` 段，统一路径分隔符。
5. command 目标保留完整文本，value 目标只执行非空校验。
6. 参数画像不一致时返回 `INVALID_ARGUMENTS`，路径越界沿用 `PATH_OUTSIDE_ROOT`。
7. 不缓存预检得到的绝对执行路径，工具执行时仍由 PathGuard 重查。

**验证：** 使用临时项目运行 `pnpm exec tsx -e` 分别解析项目内路径、越界路径和命令，期望返回规范化目标、越界错误和原命令文本。

## T9：覆盖沙箱与符号链接边界

**文件：** `src/permission/sandbox.test.ts`

**依赖：** T8

**步骤：**

1. 覆盖已存在项目内文件、待新建嵌套文件和普通相对 glob。
2. 覆盖绝对路径、`..` 路径和绝对 glob。
3. 创建指向项目外的文件符号链接，断言读取与写入画像都拒绝。
4. 创建指向项目外目录的符号链接，断言其下新文件目标被拒绝。
5. 创建悬空符号链接，断言写入预检拒绝。
6. 断言命令目标不被误当路径解析。
7. 在不支持创建符号链接的平台只跳过对应案例，并保留其他边界测试。

**验证：** 运行 `pnpm exec tsx --test src/permission/sandbox.test.ts`，期望项目内目标通过、全部逃逸目标失败。

## T10：实现规则表达式解析

**文件：** `src/permission/rule-parser.ts`

**依赖：** T3、T4

**步骤：**

1. 实现工具级、精确值和 glob 三种表达式解析。
2. 使用第一个 `(` 和最后一个 `)` 识别外层边界，允许目标包含普通空格与括号。
3. 校验工具名存在、effect 合法、表达式非空且括号完整。
4. 区分未转义 glob 元字符，计算 patternKind 和非通配字面长度。
5. 使用 `minimatch` 预编译 matcher，关闭隐式 basename 匹配并启用反斜杠转义。
6. 实现生成精确表达式的转义函数，确保 `*`、`?`、`[` 和反斜杠按字面值匹配。
7. 错误信息包含规则位置和中文原因，不包含 YAML 文件外的敏感内容。

**验证：** 使用 `pnpm exec tsx -e` 解析 `run_command(git *)`、`read_file(src/index.ts)` 和 `read_file`，期望分别得到 glob、exact 和 tool 三类规则。

## T11：覆盖规则解析与转义

**文件：** `src/permission/rule-parser.test.ts`

**依赖：** T10

**步骤：**

1. 覆盖工具级、精确路径、命令 glob、包含空格和括号的目标。
2. 断言大小写敏感工具名和未知工具被拒绝。
3. 覆盖空表达式、非法 effect、缺失括号、多余尾部和空模式。
4. 验证 `*`、`?`、`[`、`]` 和反斜杠的精确表达式转义往返。
5. 断言 glob 只匹配完整权限目标，不隐式匹配 basename。
6. 断言 literalLength 和 patternKind 可稳定用于具体程度排序。

**验证：** 运行 `pnpm exec tsx --test src/permission/rule-parser.test.ts`，期望解析、非法输入、glob 和转义场景全部通过。

## T12：实现分层规则引擎

**文件：** `src/permission/rule-engine.ts`

**依赖：** T10

**步骤：**

1. 为 user、project、local、session 四层分别维护有序规则数组。
2. 实现 `replaceLayer()`，复制输入并只替换指定层。
3. 实现 `addSessionRule()` 和 `clearSessionRules()`。
4. 实现 `match(toolName, target)`，按 session、local、project、user 查找第一个有匹配的层。
5. 同层按 exact、glob、tool 排序；glob 再按 literalLength；最终按后声明 order 决胜。
6. 实现 `countByLayer()`，返回只读计数快照。
7. 不让 PermissionMode 进入规则引擎，保持匹配职责单一。

**验证：** 使用 `pnpm exec tsx -e` 构造四层冲突规则，期望 session 结果覆盖 local、project 和 user。

## T13：覆盖规则优先级

**文件：** `src/permission/rule-engine.test.ts`

**依赖：** T12

**步骤：**

1. 分别验证四层单独命中和完全未命中。
2. 构造 allow/deny 跨层冲突，断言 session > local > project > user。
3. 同层构造 tool、glob 和 exact 同时命中，断言 exact 优先。
4. 构造两个命中 glob，断言字面字符更多者优先。
5. 构造具体程度相同规则，断言后声明规则优先。
6. 验证替换一层不改变其他层，会话清理只清 session。
7. 重复相同输入，断言结果与计数稳定。

**验证：** 运行 `pnpm exec tsx --test src/permission/rule-engine.test.ts`，期望跨层、同层和生命周期测试全部通过。

## T14：实现三层权限配置加载

**文件：** `src/permission/config-store.ts`

**依赖：** T10、T12

**步骤：**

1. 使用 `homedir()` 和项目真实根目录计算 user、project、local 三个文件路径。
2. 使用现有 `yaml` 依赖读取 `version: 1` 与有序 `rules`。
3. 严格校验根对象、版本、规则数组、每条字段和未知字段。
4. 调用 RuleParser 校验工具名、effect 和 expression。
5. 不存在文件返回空规则层，不生成诊断。
6. 单个文件无效时跳过完整层，并返回含 layer、file、message 的诊断。
7. 允许测试注入用户目录，避免测试读写真实 `~/.bettercode`。

**验证：** 使用临时目录运行 `pnpm exec tsx -e` 加载一份有效 user 配置和缺失 project/local 配置，期望得到 user 规则且无诊断。

## T15：覆盖配置加载与失败关闭

**文件：** `src/permission/config-store.test.ts`

**依赖：** T14

**步骤：**

1. 覆盖三个文件都不存在和三个文件同时有效。
2. 断言 YAML 数组顺序转换成稳定 order。
3. 分别覆盖语法错误、错误 version、非法根结构、未知字段和非法规则。
4. 断言单层损坏时该层为空，其他有效层仍正常加载。
5. 断言诊断包含正确 layer 和文件路径，不包含其他配置正文。
6. 覆盖未知工具规则，断言不能形成 allow。

**验证：** 运行 `pnpm exec tsx --test src/permission/config-store.test.ts`，期望有效配置加载和全部无效配置失败关闭场景通过。

## T16：实现项目本地永久授权写入

**文件：** `src/permission/config-store.ts`

**依赖：** T14

**步骤：**

1. 实现 `appendLocalAllow(expression)`，每次写入前重新读取本地文件。
2. 本地文件不存在时创建 `version: 1` 与空 rules 文档。
3. 已有文件使用 YAML Document API 更新，尽量保留注释和顺序。
4. 写入前完整校验文档；损坏文件直接失败且不覆盖。
5. 相同 allow 表达式已存在时复用，不重复追加。
6. 在 `.bettercode` 同目录写临时文件，再原子重命名。
7. 写入或重命名失败时清理临时文件并保留原文件。
8. 成功返回编译后的 local 规则，供 RuleEngine 立即刷新。

**验证：** 使用临时项目连续写入两次相同表达式，期望本地 YAML 只出现一条规则且可重新加载。

## T17：覆盖永久规则持久化

**文件：** `src/permission/config-store.test.ts`

**依赖：** T16

**步骤：**

1. 覆盖首次创建 `.bettercode/permissions.local.yaml`。
2. 覆盖向已有有效规则追加并保留原顺序。
3. 覆盖重复 allow 不重复写入。
4. 覆盖已有注释尽量保留。
5. 覆盖已有 YAML 损坏时拒绝写入且文件字节不变。
6. 模拟临时写入或重命名失败，断言正式文件保持原内容。
7. 断言写入后重新加载能得到新增 local 规则。

**验证：** 运行 `pnpm exec tsx --test src/permission/config-store.test.ts`，期望加载、幂等、失败保护和重新加载测试全部通过。

## T18：实现权限管理器固定判定管线

**文件：** `src/permission/manager.ts`

**依赖：** T6、T8、T12、T16

**步骤：**

1. 构造时接收模式、SandboxPolicy、RuleEngine 和 ConfigStore。
2. 实现模式读取、空闲期模式设置、状态快照和会话规则清理。
3. `authorize()` 先提取规范化目标，命令目标先查不可配置黑名单。
4. 黑名单与沙箱拒绝立即返回结构化结果，不进入规则或人工确认。
5. 规则命中 allow 时允许，命中 deny 时返回 `PERMISSION_DENIED`。
6. 规则未命中时实现严格拒绝、放行允许、默认进入待确认分支。
7. 在结果 metadata 中只加入 source、category、rule 等非敏感值。
8. 保持所有错误为返回值，不让权限拒绝抛出到 AgentLoop。

**验证：** 使用 Fake Store 和固定规则运行 `pnpm exec tsx -e` 检查黑名单、沙箱、规则 allow/deny 及三档模式，期望决策源与结果一致。

## T19：覆盖强制层、规则和模式

**文件：** `src/permission/manager.test.ts`

**依赖：** T18

**步骤：**

1. 在三档模式和显式 allow 下测试黑名单，断言始终 `DANGEROUS_COMMAND`。
2. 在三档模式和显式 allow 下测试路径逃逸，断言始终 `PATH_OUTSIDE_ROOT`。
3. 覆盖四层 allow/deny 规则的决策源和优先级。
4. 对未命中调用验证 strict 拒绝、allow 放行。
5. 默认模式无 decider 时验证 `PERMISSION_UNAVAILABLE`。
6. 验证配置诊断与规则计数出现在状态快照。
7. 断言拒绝结果不包含写入内容、替换正文或用户配置正文。

**验证：** 运行 `pnpm exec tsx --test src/permission/manager.test.ts`，期望强制层不可覆盖、规则和模式测试全部通过。

## T20：实现人工确认和授权时效

**文件：** `src/permission/manager.ts`

**依赖：** T18

**步骤：**

1. 默认模式为未命中调用创建随机 PermissionRequest，并调用 `onRequest`。
2. 生成只精确匹配当前规范化目标的 `proposedRule`，转义 glob 元字符。
3. 将 decider Promise 与 AbortSignal 竞速，只消费第一个完成结果。
4. `deny` 返回 `PERMISSION_DENIED`，不创建规则。
5. `allow_once` 只允许当前调用。
6. `allow_session` 先把精确 allow 加入 session 层，再允许当前调用。
7. `allow_permanent` 先写入项目本地文件并刷新 local 层，再允许当前调用。
8. 永久写入失败返回 `PERMISSION_CONFIG_ERROR`，当前调用不得执行。
9. 取消返回 `PERMISSION_CANCELLED`；decider 抛错或非法结果返回 `PERMISSION_UNAVAILABLE`。

**验证：** 使用可控 Promise decider 运行 `pnpm exec tsx -e`，期望四种选择、取消和异常分别得到设计中的结果。

## T21：覆盖本次、会话、永久和取消

**文件：** `src/permission/manager.test.ts`

**依赖：** T20

**步骤：**

1. `deny` 后重复相同调用，断言再次请求确认。
2. `allow_once` 后重复相同调用，断言再次请求确认。
3. `allow_session` 后重复相同调用，断言直接由 session_rule 允许。
4. 清理 session 后重复调用，断言重新请求确认。
5. `allow_permanent` 后创建新 Manager 并重新加载，断言由 local_rule 允许。
6. 模拟永久写入失败，断言当前调用拒绝且未添加 session 规则。
7. 取消 pending 请求后完成原 Promise，断言迟到决定不会改变结果。
8. 验证请求 ID 唯一、toolCallId 绑定、target 和 proposedRule 不含敏感正文。

**验证：** 运行 `pnpm exec tsx --test src/permission/manager.test.ts`，期望四种选择、重启持久化、失败和取消竞速测试全部通过。

## T22：实现权限模块工厂

**文件：** `src/permission/factory.ts`

**依赖：** T13、T17、T20

**步骤：**

1. 从 ToolRegistry 获取已注册工具名并构造 knownTools 集合。
2. 使用项目根目录和可注入用户目录创建 ConfigStore。
3. 加载三层规则并分别写入 RuleEngine。
4. 使用与 ToolRegistry 相同的项目根目录创建 SandboxPolicy。
5. 以初始模式创建 PermissionManager，并保留配置诊断。
6. 不读取 Provider 配置，不依赖 React 或 Agent 事件类型。

**验证：** 使用临时项目运行 `pnpm exec tsx -e` 调用工厂，期望 Manager 状态包含正确模式、三层计数和诊断。

## T23：扩展 Agent 权限事件契约

**文件：** `src/agent/types.ts`

**依赖：** T3

**步骤：**

1. 给 `AgentProgressStage` 增加 `checking_permissions` 和 `waiting_permission`。
2. 给 `AgentEvent` 增加纯数据 `permission_request` 和 `permission_decision` 分支。
3. 权限请求事件包含 iteration 与完整 PermissionRequest。
4. 权限决定事件包含调用信息、allowed、source 和可选 choice/requestId。
5. 给 `AgentRunOptions` 和 `AgentLoopRequest` 增加可选 PermissionDecider。
6. 不给 Provider 类型增加权限字段，不改变 AgentStopReason。

**验证：** 运行 `rg -n "checking_permissions|waiting_permission|permission_request|permission_decision|permissionDecider" src/agent/types.ts`，期望五类契约完整且 `AgentStopReason` 无权限拒绝分支。

## T24：接入 ToolScheduler 串行判权

**文件：** `src/agent/tool-scheduler.ts`

**依赖：** T5、T20、T23

**步骤：**

1. 构造函数注入 PermissionManager。
2. 保留未知工具与 Plan Mode 检查，并在权限判断前调用 registry.validate。
3. 按模型原始顺序串行调用 `authorize()`，使前一授权规则可影响后一调用。
4. 判权前发出 checking_permissions；需要确认时发出 permission_request 与 waiting_permission。
5. 判权完成后发出 permission_decision，拒绝结果直接写入结果表。
6. 允许调用按 read_only 和 side_effect 分组。
7. 全部判权结束后并发执行只读组、串行执行副作用组。
8. 取消后不启动剩余工具，为每个调用补齐结果并保持原顺序。
9. 权限拒绝不增加 unknownToolStreak，不触发 unknownToolLimitReached。

**验证：** 运行 `rg -n "registry\.validate|permissionManager\.authorize|permission_request|permission_decision|Promise\.all" src/agent/tool-scheduler.ts`，期望参数预检、串行判权、权限事件和只读并发入口均存在；完整类型验证在调用方迁移后执行。

## T25：覆盖权限批次调度

**文件：** `src/agent/tool-scheduler.test.ts`

**依赖：** T24

**步骤：**

1. 更新既有 Scheduler 构造，注入可控 PermissionManager。
2. 断言未知工具、Plan Mode 不可用和参数无效调用不发权限请求。
3. 断言权限判断按原调用顺序串行，session allow 能影响同批后续调用。
4. 断言已授权只读工具并发，副作用工具串行。
5. 混合 allow、deny 和确认调用，断言结果保持原顺序。
6. 断言权限拒绝不改变 unknown tool streak。
7. 在等待确认和执行阶段分别取消，断言未启动副作用不执行。
8. 验证 request、decision、progress、tool execution 事件顺序。

**验证：** 运行 `pnpm exec tsx --test src/agent/tool-scheduler.test.ts`，期望权限顺序、并发、拒绝、取消和原有调度测试全部通过。

## T26：在 AgentLoop 透传权限决策器

**文件：** `src/agent/loop.ts`

**依赖：** T24

**步骤：**

1. 构造 AgentLoop 时接收同一个 PermissionManager，并传给 ToolScheduler。
2. 把 AgentLoopRequest.permissionDecider 传入每批 ToolScheduleOptions。
3. 原样转发 Scheduler 产生的权限事件。
4. 权限拒绝继续按 ToolResult 序列化并写入 tool 历史。
5. 权限错误不发 Agent error，不新增停止原因，不增加未知工具计数。
6. 拒绝后只要未触发既有停止条件，继续下一轮 Provider 请求。
7. 取消等待确认时仍按现有 cancelled 路径停止。

**验证：** 运行 `rg -n "PermissionManager|permissionDecider|executeBatch|tool_result" src/agent/loop.ts`，期望权限依赖、决策器透传、调度和结果回灌入口均存在；接口行为由下一任务的 Agent 测试验证。

## T27：覆盖拒绝后 Agent 调整

**文件：** `src/agent/loop.test.ts`

**依赖：** T26

**步骤：**

1. 更新全部 AgentLoop 测试构造，注入测试权限管理器或明确放行模式。
2. 构造第一轮工具被 deny、第二轮模型改用允许工具、第三轮输出文本的场景。
3. 断言拒绝结果以匹配 toolCallId 写入历史，Provider 收到后续请求。
4. 断言最终 stop reason 为 completed，不是 stream_error 或 unknown_tool_limit。
5. 覆盖黑名单拒绝后继续一轮并正常结束。
6. 覆盖默认模式无 decider 的失败关闭与继续循环。
7. 覆盖等待确认期间取消，断言不执行工具且以 cancelled 停止。
8. 保留全部既有迭代上限、流错误、用量和多工具测试。

**验证：** 运行 `pnpm exec tsx --test src/agent/loop.test.ts`，期望权限恢复场景与全部 Agent Loop 回归测试通过。

## T28：接入 ChatManager 权限生命周期

**文件：** `src/chat/manager.ts`

**依赖：** T22、T26

**步骤：**

1. 构造函数接收 PermissionManager，并传给 AgentLoop。
2. `run()` 和 `executeLatestPlan()` 把 PermissionDecider 透传到 AgentLoopRequest。
3. 提供 `getPermissionStatus()` 和 `setPermissionMode()`。
4. Agent 正在运行时拒绝切换模式，返回明确中文错误。
5. `clear()` 在清空历史和计划时同时清空 session 规则。
6. `clear()` 保留当前 PermissionMode、user/project/local 规则和诊断。
7. 保持运行互斥、最近计划和历史提交语义不变。

**验证：** 运行 `rg -n "PermissionManager|getPermissionStatus|setPermissionMode|clearSessionRules|permissionDecider" src/chat/manager.ts`，期望权限依赖、模式、清理和决策器透传入口均存在；接口行为由下一任务的 Chat 测试验证。

## T29：覆盖 Chat 模式和会话规则

**文件：** `src/chat/manager.test.ts`

**依赖：** T28

**步骤：**

1. 更新既有 ChatManager 测试装配，注入 PermissionManager。
2. 断言 run 和 executeLatestPlan 都把 decider 传入权限流程。
3. 空闲时切换 strict/default/allow，断言状态立即更新。
4. Agent 运行期间尝试切换模式，断言被拒绝且当前模式不变。
5. 添加 session allow 后调用 clear，断言历史、计划和 session 规则清空。
6. 断言 clear 后当前模式及持久层规则仍保留。
7. 保留 Plan、Do、互斥运行和历史回归测试。

**验证：** 运行 `pnpm exec tsx --test src/chat/manager.test.ts`，期望权限生命周期和全部 Chat 回归测试通过。

## T30：实现 Ink 权限确认面板

**文件：** `src/ui/permission-prompt.tsx`

**依赖：** T23

**步骤：**

1. 定义组件 props：PermissionRequest、选择回调和 disabled 状态。
2. 展示工具名、中文风险标签、规范化 target 和 proposedRule；命令类明确提示获准后继承 BetterCode 进程权限。
3. 提供 `d` 拒绝、`o` 仅本次、`s` 本会话、`p` 永久允许四个按键选项。
4. 使用 `useInput` 只接受四个明确按键，忽略其他输入和控制字符。
5. 使用 ref 保证同一请求只提交一次选择。
6. 不展示完整 JsonObject、写入内容、old_text 或 new_text。
7. 所有新增 JSX 注释使用中文。

**验证：** 运行 `pnpm exec tsx -e "import('./src/ui/permission-prompt.tsx')"`，期望组件模块可成功解析且无运行期导入错误；完整类型检查在 UI 装配完成后执行。

## T31：在 App 接入确认 Promise 和权限命令

**文件：** `src/ui/app.tsx`

**依赖：** T28、T30

**步骤：**

1. 为每次 Agent 运行创建 PermissionDecider，并以 state/ref 保存当前请求和 Promise 完成函数。
2. 收到 permission_request 时更新进度并渲染 PermissionPrompt。
3. 用户选择后只完成对应请求一次，并清理活动面板。
4. 收到 permission_decision 时更新进度；运行结束或取消时清理 pending UI。
5. 调用 chatManager.run 和 executeLatestPlan 时都传入 decider。
6. 增加 `/permissions` 状态命令和 `/permissions <strict|default|allow>` 切换命令。
7. `/help` 增加权限命令说明和 Shell 非系统级沙箱边界，顶部显示当前权限模式。
8. 配置诊断在首次状态或 `/permissions` 中清楚展示，不暴露配置正文。
9. 等待确认时隐藏普通 InputBox，保留 Ctrl+C 取消整个运行。

**验证：** 运行 `rg -n "permission_request|permission_decision|PermissionPrompt|/permissions|permissionDecider" src/ui/app.tsx`，期望请求、决定、确认面板、模式命令和决策器五类接入点完整；完整类型检查在启动装配后执行。

## T32：完成启动装配

**文件：** `src/index.tsx`

**依赖：** T22、T31

**步骤：**

1. 给 `parseArgs` 增加 `--permission-mode` 字符串参数。
2. 严格校验参数只能是 strict、default、allow；非法值在启动前给出中文错误。
3. 先创建 ToolRegistry，再调用权限工厂加载配置并创建 PermissionManager。
4. 把 ToolRegistry 和 PermissionManager 注入 ChatManager。
5. 保持 Provider 选择、config 参数和 Ink 启动方式不变。
6. 权限 YAML 诊断不终止启动，由 Manager 状态交给 UI 展示。
7. 启动失败信息继续走现有统一错误出口。

**验证：** 运行 `pnpm exec tsx src/index.tsx --permission-mode invalid`，期望在调用 Provider 前提示非法权限模式；运行 `pnpm exec tsc --noEmit --pretty false`，期望启动装配编译通过。

## T33：执行权限系统全量回归

**文件：** 本任务涉及的全部源码与测试文件

**依赖：** T2-T32

**步骤：**

1. 运行全部权限模块测试，确认没有依赖真实用户目录、真实 LLM 或高危命令。
2. 运行 Tool、Agent、Chat、Prompt 和 Provider 全部既有测试。
3. 运行 TypeScript 严格类型检查。
4. 检查权限本地文件确实被忽略，项目共享文件不被忽略。
5. 扫描新增源码注释，确认使用中文；扫描产品名称，确认不引入旧产品名。
6. 检查 `git diff --check`，修复空白与补丁格式问题。
7. 对照 plan.md 文件组织，确认所有公开接口都有真实调用方。
8. 不处理与权限系统无关的既有工作区改动和失败。

**验证：** 运行 `pnpm check && git diff --check`，期望类型检查、全部测试和补丁检查通过；运行 `rg -n "$(printf 'Mew%s' 'Code')" src docs/permission-system`，期望无匹配。

## 执行顺序

```text
T1 -> T2 -> T3 -> T4 -> T5
               |     |
               |     +-> T8 -> T9
               +-> T6 -> T7
               +-> T10 -> T11 -> T12 -> T13
                                   |
                                   +-> T14 -> T15 -> T16 -> T17

T6 + T8 + T12 + T16 -> T18 -> T19 -> T20 -> T21 -> T22

T3 -> T23
T5 + T20 + T23 -> T24 -> T25 -> T26 -> T27
T22 + T26 -> T28 -> T29
T23 -> T30
T28 + T30 -> T31
T22 + T31 -> T32
T2-T32 -> T33
```

可以并行的工作仅限依赖已满足且不修改同一文件的任务。例如 T6/T8/T10 可并行；T7/T9/T11 可分别跟随对应实现。`manager.ts`、`tool-scheduler.ts`、`loop.ts`、`chat/manager.ts` 和 `app.tsx` 按主链顺序修改，避免接口迁移期间互相覆盖。
