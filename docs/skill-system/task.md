# BetterCode Skill 系统 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/skill/types.ts` | Skill 元数据、快照、诊断、执行和可见性类型 |
| 新建 | `src/skill/parser.ts` | YAML frontmatter 与参数化正文解析 |
| 新建 | `src/skill/script-tool.ts` | Node.js 专属工具进程适配 |
| 新建 | `src/skill/tool-loader.ts` | 目录型工具元信息、Schema 和脚本发现 |
| 新建 | `src/skill/loader.ts` | 三级目录扫描、覆盖和禁用名称 |
| 新建 | `src/skill/load-tool.ts` | 系统级 `load_skill` 工具 |
| 新建 | `src/skill/manager.ts` | 原子快照、激活、白名单、热更新和订阅 |
| 新建 | `src/skill/runner.ts` | 共享/独立执行和摘要回流 |
| 新建 | `src/skill/*.test.ts` | Skill 领域单元与集成测试 |
| 修改 | `src/tool/registry.ts` | 动态 owner、系统工具和按名称定义视图 |
| 修改 | `src/agent/loop.ts` | 每轮动态提醒、工具集合和独立结果转换 |
| 修改 | `src/agent/tool-scheduler.ts` | 执行前白名单与系统工具权限旁路 |
| 修改 | `src/prompt/types.ts`、`src/prompt/reminder.ts` | 可用 Skill 元信息和激活 SOP 置顶 |
| 修改 | `src/command/*` | 动态 Skill 命令和 review 迁移 |
| 修改 | `src/chat/manager.ts` | Skill 运行、主历史回流和 clear 生命周期 |
| 修改 | `src/ui/app.tsx` | 动态 registry、Skill 命令和状态展示 |
| 修改 | `src/index.tsx` | Skill 初始化、Provider resolver 和关闭 |
| 新建 | `skills/commit/SKILL.md` 等 | 三个内置样板 Skill |
| 修改 | `README.md` | Skill 格式、目录、执行方式和安全边界 |

## T1：定义 Skill 公共契约

**文件：** `src/skill/types.ts`
**依赖：** 无

1. 定义 scope、execution mode、metadata、definition、diagnostic 和 snapshot。
2. 定义 active skill、execution scope、visibility、load resolution 和 reload result。
3. 定义 Provider resolver 与运行回调接口，避免 manager 依赖 UI。

**验证：** `pnpm typecheck` 能独立解析新类型文件。

## T2：实现 Skill Markdown 解析

**文件：** `src/skill/parser.ts`、`src/skill/parser.test.ts`
**依赖：** T1

1. 拆分 frontmatter 和正文，使用 `yaml` 解析对象。
2. 严格校验字段、名称、说明、工具数组、模式、history 和 model 组合。
3. 实现 `{{args}}` 全量字面替换。
4. 覆盖 Unicode 正文、缺边界、未知字段、重复工具、空正文和共享模式非法字段。

**验证：** `pnpm exec tsx --test src/skill/parser.test.ts` 全绿。

## T3：扩展 ToolRegistry 动态能力

**文件：** `src/tool/registry.ts`、`src/tool/registry.test.ts`
**依赖：** T1

1. 保存 owner 和 system 本地元数据，但不泄漏到 API ToolDefinition。
2. 实现 `definitionsFor`，保持注册顺序并按名称、effect 过滤。
3. 实现 `replaceOwned`，先编译全部 Schema 再原子替换 owner 工具。
4. 暴露 `names()` 和 `isSystem()` 供启动校验与 scheduler 使用。
5. 保持现有 register、definitions、execute 行为兼容。

**验证：** registry 新旧单测全绿，动态替换失败时旧工具仍可执行。

## T4：实现 Node.js 专属工具适配器

**文件：** `src/skill/script-tool.ts`、`src/skill/script-tool.test.ts`
**依赖：** T1、T3

1. 用 `spawn(process.execPath, [script])` 启动，不启用 Shell。
2. stdin 写稳定 JSON，收集有界 stdout/stderr。
3. 校验退出码和结构化 ToolResult，映射非法输出与进程错误。
4. AbortSignal 触发时终止子进程并返回取消结果。
5. 用临时 `.mjs` fixture 覆盖成功、业务失败、非法 JSON、非零退出和取消。

**验证：** script-tool 测试全绿且无悬挂进程。

## T5：实现目录型专属工具加载

**文件：** `src/skill/tool-loader.ts`、`src/skill/tool-loader.test.ts`
**依赖：** T2、T4

1. 稳定扫描 `tools/*.tool.yaml`。
2. 解析名称、说明、schema、script、effect 和 permission。
3. 使用真实路径和目录前缀检查拒绝逃逸与悬空链接。
4. 读取 JSON Schema并创建 ScriptTool。
5. 将任一工具错误归到所属 Skill 诊断。

**验证：** 正常目录、路径穿越、外部符号链接、重复名称和非法 Schema 测试全绿。

## T6：实现三级发现与覆盖

**文件：** `src/skill/loader.ts`、`src/skill/loader.test.ts`
**依赖：** T2、T5

1. 计算内置、用户、项目目录，支持测试注入 userHome 和 builtinDir。
2. 扫描单文件和一级目录入口并保持稳定顺序。
3. 按规范名称和 scope 优先级选择候选。
4. 高层损坏时写 disabled name，不回退低层。
5. 单个损坏文件不影响其他名称。

**验证：** 三级覆盖、损坏遮蔽、混合文件形式和空目录测试全绿。

## T7：实现 SkillManager 原子快照

**文件：** `src/skill/manager.ts`、`src/skill/manager.test.ts`
**依赖：** T3、T6

1. 初始化时构建候选、注册动态工具并校验白名单。
2. 校验 Provider 名和保留命令 token；未知白名单在冷启动抛错。
3. 实现 list/get、共享激活、同名更新、多 Skill 稳定顺序和 clear。
4. 计算默认、共享和独立 scope 的工具可见集合。
5. 实现 reload 原子替换；失败保留旧 revision。
6. 实现目录指纹轮询、订阅和 close，timer 使用 `unref()`。

**验证：** manager 单测覆盖激活并集、专属工具隐藏、无效 reload 回滚和 watcher 生命周期。

## T8：实现系统加载工具

**文件：** `src/skill/load-tool.ts`、`src/skill/load-tool.test.ts`
**依赖：** T7

1. 定义稳定 `load_skill` Schema 和强化描述。
2. 共享模式激活并返回结构化确认。
3. 独立模式返回 runner 可识别但不泄漏脚本路径的 metadata。
4. 未知和禁用 Skill 返回明确 `TOOL_UNAVAILABLE`。
5. 注册为 system tool，确保不进入 Skill 白名单校验。

**验证：** load tool 定义、共享激活、独立标记和错误测试全绿。

## T9：接入 Prompt 两阶段内容

**文件：** `src/prompt/types.ts`、`src/prompt/reminder.ts`、`src/prompt/reminder.test.ts`
**依赖：** T7

1. 增加 availableSkills 类型和格式化。
2. 调整 reminder 顺序，让 activeSkills 位于最前。
3. 未激活目录只输出名称和说明。
4. 继续统一转义 system-reminder 边界。
5. 覆盖无正文泄漏、顺序、多 Skill 和参数边界测试。

**验证：** reminder 测试全绿，System Prompt 快照测试不变。

## T10：在 Agent Loop 强制工具视图

**文件：** `src/agent/types.ts`、`src/agent/loop.ts`、`src/agent/tool-scheduler.ts` 及测试
**依赖：** T3、T7、T8、T9

1. AgentLoop 接受动态 supplemental 与 SkillVisibility 来源。
2. 每轮重新获取工具集合并交给 ContextManager 和 Provider。
3. Plan Mode 对白名单结果继续过滤副作用工具并保留系统加载工具。
4. scheduler 对不可见已注册工具返回 `TOOL_UNAVAILABLE`，不执行、不计未知 streak。
5. system tool 跳过 PermissionManager，普通工具保持原流程。
6. 增加独立 load 结果转换 hook，为 runner 留出异步摘要替换点。

**验证：** Agent Loop 和 scheduler 新旧测试全绿，猜测隐藏工具的执行计数为 0。

## T11：实现共享与独立 SkillRunner

**文件：** `src/skill/runner.ts`、`src/skill/runner.test.ts`
**依赖：** T7、T10

1. 实现最近完整消息组选择，数量为 0 时不携带历史。
2. 创建临时 ContextManager/AgentLoop，注入目标 SOP 和独立工具视图。
3. 使用 Provider resolver 选择指定模型，完成后关闭临时资源。
4. 将最终文本作为摘要；取消、流错误和空结果转换为可观察事件。
5. 支持主 loop 中独立 `load_skill` 的工具结果替换。

**验证：** runner 测试断言 Provider、历史数量、工具列表、资源关闭和摘要内容。

## T12：接入 ChatManager 生命周期

**文件：** `src/chat/manager.ts`、`src/chat/manager.test.ts`
**依赖：** T10、T11

1. 构造时接收 SkillManager/Runner 并向主 loop 提供动态内容。
2. 增加 `runSkill`，共享模式复用主 start，独立模式只提交命令与摘要。
3. 独立工具过程不写主 history、session、memory extraction 或 file-history 对话索引。
4. clear 和 resume 清除共享激活状态。
5. close 等待独立运行结束并关闭 Skill 相关资源。

**验证：** ChatManager 测试覆盖 shared 持续、isolated 回流、clear/resume 和 session JSONL 内容。

## T13：生成动态 Skill 命令

**文件：** `src/command/types.ts`、`src/command/builtins.ts`、`src/command/registry.ts` 及测试
**依赖：** T7、T12

1. 控制器增加 `runSkill`。
2. 从内置命令移除固定 `/review` 提示词和相关构造函数。
3. 根据 Skill metadata 生成同名 prompt 命令，不生成别名。
4. 默认命令与 Skill 命令统一注册，冲突保持同步抛错。
5. 帮助和补全继续只读取当前 registry。

**验证：** 命令测试覆盖动态列表、参数透传、review 迁移和冲突。

## T14：接入 App 动态 registry 与状态

**文件：** `src/ui/app.tsx`、`src/ui/app.test.ts`
**依赖：** T12、T13

1. App 接收 SkillManager 并订阅 revision。
2. 每个 revision 原子创建 registry/dispatcher，输入回调读取当前实例。
3. 实现 `runSkill` 控制器桥接并复用 AgentEvent 渲染逻辑。
4. `/status` 增加激活 Skill 列表。
5. clear 后刷新状态和命令目录。

**验证：** UI 格式测试和类型检查通过，动态命令 handler 不依赖 Ink。

## T15：接入启动与 Provider resolver

**文件：** `src/index.tsx`、必要的 Provider 辅助文件及测试
**依赖：** T7、T12、T14

1. 从 AppConfig 构建按配置名惰性创建并缓存 Provider 的 resolver。
2. MCP 初始化后创建 SkillManager，传入完整工具 Registry、Provider 名集合和保留命令。
3. Skill 初始化完成后再创建 PermissionManager 和 ChatManager。
4. 将 manager 传给 App，并在 finally 中关闭。
5. 启动错误输出 Skill 名和原因，不泄漏正文或脚本内容。

**验证：** 类型检查通过，启动装配测试覆盖未知白名单和 Provider 解析。

## T16：添加内置样板 Skill

**文件：** `skills/commit/SKILL.md`、`skills/review/SKILL.md`、`skills/test/SKILL.md`、`skills/mew-spec/SKILL.md`
**依赖：** T2、T7

1. 编写 commit 共享 SOP，强调差异检查、验证和中文提交。
2. 编写 review 独立 SOP，默认 history 为 10，按严重度输出。
3. 编写 test 独立 SOP，history 为 0，按参数选择最小相关测试。
4. 更新现有 mew-spec frontmatter，使其符合新格式。
5. 确认白名单只引用启动时存在工具。

**验证：** loader 读取真实内置目录，四个 Skill 均有效，三个要求样板出现在命令列表。

## T17：实现热更新集成

**文件：** `src/skill/manager.test.ts`、`src/ui/app.test.ts`、相关实现
**依赖：** T7、T14、T16

1. 新建 Skill 后 revision 增加且命令可补全。
2. 修改说明、正文、白名单和专属脚本后下一请求采用新快照。
3. 删除已激活 Skill 后取消激活并移除命令。
4. 写入非法半成品时保留旧 snapshot；修复后再发布。
5. 活跃 Agent 使用当前轮次快照，下一轮才读取更新。

**验证：** 临时目录热更新测试全绿，无真实用户目录写入。

## T18：更新文档与全量验收

**文件：** `README.md`、`docs/skill-system/checklist.md`
**依赖：** T1-T17

1. 记录三级目录、frontmatter、目录工具协议、两种模式和安全边界。
2. 运行 Skill 定向测试。
3. 运行 `pnpm check` 和 `git diff --check`。
4. 扫描旧产品名称、英文新增注释和未完成占位符。
5. 按 checklist 记录证据并完成阶段提交。

**验证：** 全量测试通过、差异检查无输出、工作区提交后干净。

## 执行顺序

```text
T1 -> T2 -> T4 -> T5 -> T6 -> T7 -> T8
      T3 --------------------^       |
T7 -> T9 -> T10 -> T11 -> T12 -> T13 -> T14 -> T15
T2 + T7 -> T16 -> T17
全部 --------------------------------------> T18
```

## T: /skill 命令与面板

**文件：** `src/ui/skill-dialog.tsx`、`src/command/types.ts`、`src/command/builtins.ts`、`src/ui/app.tsx`

**步骤：**

1. `SkillDialog` 动态面板，数据来自 `skillManager.list()`。
2. 注册 `/skill` 命令、`CommandUIController.showSkillList`，App 中 Enter 后调用 `runSkill(name, '', '/name')`。
3. 测试覆盖 dialog、builtins/dispatcher、app 集成。

**验证：** `pnpm exec tsx --test src/ui/skill-dialog.test.ts src/ui/app.test.ts` 与全量 `pnpm check`。
