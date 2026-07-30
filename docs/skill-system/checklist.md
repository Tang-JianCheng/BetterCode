# BetterCode Skill 系统 Checklist

> 验收日期：2026-07-30。证据：`pnpm check` 通过，241/241 项测试通过；`git diff --check` 通过；定向 Skill、Agent、命令、热更新和真实子进程测试均通过。

## 定义与发现

- [x] 单文件和目录型 Skill 都能解析 frontmatter 与 Markdown 正文。（验证：parser/loader 临时目录测试）
- [x] 名称、说明、tools、mode、history、model 和空正文均被严格校验。（验证：字段矩阵单测）
- [x] `{{args}}` 在所有位置被字面替换，空参数得到空字符串。（验证：render 单测）
- [x] 项目级覆盖用户级和内置级，同层结果稳定排序。（验证：三级覆盖单测）
- [x] 高层损坏禁用同名 Skill 且不回退，其他 Skill 保持可用。（验证：损坏遮蔽单测）
- [x] 共享模式拒绝 history/model，独立模式默认 history 为 0。（验证：字段组合单测）
- [x] 不存在 Provider 只禁用对应独立 Skill 并产生诊断。（验证：manager 初始化测试）
- [x] 有效白名单引用未知工具时冷启动同步失败并指出 Skill 和工具名。（验证：manager 启动失败测试）

## 两阶段加载

- [x] 未激活请求只包含 Skill 名称和说明，不包含正文、白名单和脚本路径。（验证：Provider request 断言）
- [x] `load_skill` 始终出现在默认、共享、独立和 Plan Mode 工具集合中。（验证：工具定义矩阵测试）
- [x] 共享 Skill 激活后完整参数化 SOP 位于 reminder 最前并在每轮重建。（验证：两轮 Agent Loop 测试）
- [x] 再次激活同名 Skill 更新参数内容，不重复条目、不改变首次顺序。（验证：manager 激活测试）
- [x] 多个共享 Skill 同时注入且白名单取并集。（验证：manager + Agent Loop 集成测试）
- [x] 未知或禁用 Skill 返回结构化错误，Agent 可继续下一轮。（验证：load tool 恢复测试）
- [x] `/clear` 和会话恢复清空共享激活状态。（验证：ChatManager 生命周期测试）

## 独立执行

- [x] 独立 Skill 不进入主激活列表，完成后不影响后续主工具集合。（验证：runner 生命周期测试）
- [x] history 为 0 时不复制主历史，正数时只复制最近完整消息组。（验证：历史选择测试）
- [x] 工具调用与工具结果不会被截断或拆开。（验证：含多工具调用历史测试）
- [x] 指定 Provider 配置被实际使用；未指定时沿用当前 Provider。（验证：双 FakeProvider 调用计数）
- [x] 主历史只增加显示命令和最终摘要，不包含独立工具消息与内部提醒。（验证：ChatManager history 断言）
- [x] 主 session JSONL 和长期记忆输入不包含独立工具过程。（验证：临时会话存档与 extractor 输入测试）
- [x] 取消、流错误和空结果结束临时 Agent，资源被关闭且主历史保持一致。（验证：异常路径测试）

## 工具白名单

- [x] 无激活 Skill 时默认工具可见，全部专属工具隐藏。（验证：visibility 单测）
- [x] 有共享 Skill 时只暴露白名单并集和 `load_skill`。（验证：Provider tools 断言）
- [x] 模型猜测隐藏但已注册工具时返回 `TOOL_UNAVAILABLE`，实现执行次数为 0。（验证：scheduler 集成测试）
- [x] 不可见工具不计入未知工具连续次数。（验证：unknown streak 测试）
- [x] Plan Mode 对白名单继续过滤副作用工具。（验证：Plan Mode 测试）
- [x] `load_skill` 跳过 PermissionManager，普通工具仍按原权限流程。（验证：permission decider 调用计数）
- [x] 多 Skill 白名单并集不会包含未声明的默认或专属工具。（验证：集合精确相等断言）

## 专属工具

- [x] `.tool.yaml`、JSON Schema 和 `.mjs` 能组成可注册 Tool。（验证：tool-loader 正常测试）
- [x] 专属工具未激活时不进入 API 定义，激活后可执行。（验证：两阶段集成测试）
- [x] stdin 收到原始参数 JSON，stdout 成功结果被正确映射。（验证：真实 Node fixture）
- [x] 业务失败、非法 JSON、非零退出和超大 stderr 返回有界结构化错误。（验证：script-tool 错误矩阵）
- [x] 取消会终止子进程，测试结束无悬挂句柄。（验证：阻塞脚本取消测试）
- [x] Schema 或脚本路径穿越、悬空链接和外部符号链接被拒绝。（验证：真实路径矩阵测试）
- [x] ToolRegistry 动态替换原子完成，失败时旧工具继续可用。（验证：replaceOwned 回滚测试）
- [x] 专属工具继续经过参数校验、权限、超时、输出限制和 Plan Mode。（验证：Registry/Scheduler 集成测试）

## 命令与热更新

- [x] 每个有效 Skill 出现在 `/help` 和 Tab 补全，说明来自 metadata。（验证：动态 registry 测试）
- [x] Skill 参数原样传入 `{{args}}`，共享/独立命令调用对应 runner 路径。（验证：假控制器事件断言）
- [x] `/review` 已由内置 Skill 提供，不再依赖 TypeScript 固定提示词。（验证：源码扫描与命令测试）
- [x] Skill 与内置命令或别名冲突时冷启动失败。（验证：保留 token 测试）
- [x] 新增、修改、删除 Skill 后 revision 与命令列表原子更新。（验证：短轮询热更新测试）
- [x] 删除已激活 Skill 会取消激活并恢复正确工具集合。（验证：manager reload 测试）
- [x] 无效热更新保留旧 revision、旧命令和旧工具，修复后再发布。（验证：半成品写入测试）
- [x] watcher close 后 timer 清理，不阻止测试进程退出。（验证：句柄与 close 测试）

## 内置样板

- [x] `commit`、`review`、`test` 均由 `SKILL.md` 定义并成功加载。（验证：真实内置目录测试）
- [x] commit 使用共享模式并要求中文提交信息。（验证：metadata 与正文断言）
- [x] review 使用独立模式、默认携带最近 10 条消息并按严重度报告。（验证：metadata 与正文断言）
- [x] test 使用独立模式、默认不带历史并优先运行最相关测试。（验证：metadata 与正文断言）
- [x] 内置 Skill 白名单全部引用实际注册工具。（验证：真实启动 manager 测试）

## 缓存、安全与兼容

- [x] System Prompt 文本不因 Skill 目录或激活状态变化。（验证：builder 快照测试）
- [x] Skill 元信息和正文只通过 instruction 消息注入。（验证：Provider request 字段断言）
- [x] reminder 边界伪造标签被转义。（验证：恶意参数测试）
- [x] 专属脚本不通过 Shell 启动，cwd 固定为项目根。（验证：spawn 参数测试）
- [x] 现有 MCP、权限、上下文压缩、记忆、会话和核心工具测试无回归。（验证：全量测试）
- [x] 测试不读取真实 `~/.bettercode/skills`，不调用真实 API。（验证：依赖注入审阅与源码扫描）

## 编译与测试

- [x] `pnpm typecheck` 无错误。（验证：命令退出码 0）
- [x] Skill 定向测试全部通过。（验证：`pnpm exec tsx --test src/skill/*.test.ts`）
- [x] `pnpm test` 全部通过且无既有回归。（验证：测试汇总 fail 0）
- [x] `git diff --check` 无空白错误。（验证：命令无输出）
- [x] 本章文件无旧产品名称、未完成占位符或英文新增源码注释。（验证：`rg` 扫描）

## 端到端场景

- [x] 场景 1：启动后普通任务请求只看到 Skill 目录；模型调用 `load_skill(commit)` 后下一轮看到 commit SOP 和收窄工具。（验证：FakeProvider 两轮请求快照）
- [x] 场景 2：依次运行两个共享 Skill，状态显示二者均激活，工具为白名单并集；`/clear` 后全部清除。（验证：ChatManager 集成测试）
- [x] 场景 3：运行 `/review src/chat`，指定独立 Agent 收到最近 10 条完整消息，主历史只保存命令和摘要。（验证：双 Provider + session fixture）
- [x] 场景 4：项目 Skill 覆盖内置同名；把项目文件写坏后该命令禁用且不会执行内置版本。（验证：三级临时目录测试）
- [x] 场景 5：目录型 Skill 激活后执行 `.mjs` 工具；未激活、Plan Mode 或白名单移除时脚本均不执行。（验证：文件哨兵计数）
- [x] 场景 6：运行中新增 Skill 后补全出现新命令；写入非法更新时旧命令继续工作；修复后采用新正文。（验证：watcher 集成测试）
