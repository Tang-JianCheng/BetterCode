# BetterCode 会话上下文交接文档

> 生成日期：2026-08-05
> 用途：给新会话（Codex / Claude Code 等）接手本仓库时快速恢复完整上下文
> 阅读顺序：先读本文件，再读 `AGENTS.md`、`README.md`，动手前先运行 `pnpm check`

## 0. 一句话现状

- 系统名是 **BetterCode**（历史叫 MewCode，文档或代码里残留的 MewCode 都是旧名，不要改）。
- 项目已完成从“纯聊天 TUI”到“完整终端代码 Agent”的全部主体能力：工具系统、Agent Loop、系统提示词、权限、MCP 客户端、上下文管理、记忆、斜杠命令、Skill、Hook、子 Agent、Worktree、团队协作、cc-switch 适配和现代化 UI。
- 当前分支 `main` 工作区干净，最新提交 `1fdf7b4 增加 Apple Terminal 系统级崩溃提示`。
- 最近一次 `pnpm check` 全量通过：类型检查通过，550 项测试全部通过。

## 1. 项目与运行

| 项 | 值 |
|---|---|
| 项目路径 | `/Users/tangjiancheng/Desktop/Bettercode Agent` |
| 包名 | `bettercode`，版本 `0.1.0` |
| 技术栈 | TypeScript + Ink 5 / React 18 终端 TUI，Node ESM，`tsx` 运行 |
| 启动 | `pnpm start` |
| 指定供应商启动 | `pnpm start --provider <name>` |
| 类型检查 | `pnpm typecheck` |
| 测试 | `pnpm test` |
| 全量验证 | `pnpm check`（= typecheck + test） |
| 运行依赖 | `ink`、`react`、`yaml`、`zod`、`marked`、`fast-glob`、`minimatch`、`string-width`、`ajv`、`@modelcontextprotocol/sdk` |

## 2. 硬性协作约束（来自 AGENTS.md）

1. 提交代码时使用中文注释，Git 提交信息必须中文。
2. 系统名统一叫 BetterCode。
3. 每完成一个大型 Plan，提交一次 Git 作为阶段性检查点。
4. 新功能/模块/系统性优化必须在 `docs/<主题>/` 下创建 `spec.md`、`plan.md`、`task.md`、`checklist.md` 四份文档。
5. 已有功能的补充、兼容或局部优化不新建重复文档，在对应的四份原文档中按增量章节补充。
6. 文档直接写入仓库供用户查阅，不要把完整文档拆成多段逐段确认。
7. 涉及候选列表的交互命令（如 `/session`、`/model`）必须实现为动态命令面板：方向键选择、Enter 确认、Esc 退出。
8. 面板内命令/名称左对齐，说明/描述右对齐；选中项整行高亮。
9. 描述保持简短，超过宽度时选中项可展开；候选超过一页支持滚动并显示剩余数量。
10. 面板渲染必须流畅，与普通文本区分，体现动态交互内容。

## 3. 架构总览

```
src/
├── index.tsx                  # 入口：runtime error 日志、worker host、Ink render
├── bootstrap/                 # 应用装配：createApplication、参数解析
├── provider/                  # LLM Provider（Anthropic / OpenAI，SSE 流式）
├── config/                    # YAML 配置加载、校验、${ENV} 展开
├── prompt/                    # 稳定系统提示词 + 运行期指令/提醒
├── chat/                      # ChatManager：对话历史管理
├── tool/                      # 六大内置工具 + Registry + 执行状态/缓存
│   └── tools/                 # read/write/edit file、run command、find files、search code
├── agent/                     # Agent Loop、事件流、流收集器、工具调度器
├── permission/                # 黑名单、沙箱、规则引擎、权限模式、人工确认
├── mcp/                       # MCP 客户端：stdio / Streamable HTTP、Tool 适配
├── context/                   # 上下文估算、轻量落盘、重量摘要、熔断
├── memory/                    # 项目指令加载、长期记忆提取与恢复
├── session/                   # 会话 JSONL 存档、摘要、恢复
├── command/                   # 斜杠命令注册、解析、分发、本地面板
├── skill/                     # Skill 两阶段加载、shared/isolated 执行、脚本工具
├── hook/                      # 生命周期 Hook：事件+条件+动作
├── subagent/                  # agent 工具、定义式/Fork 式、后台任务
├── worktree/                  # Git Worktree 隔离、初始化、清理
├── team/                      # 长期团队、成员后端、任务/邮箱/审批、合并
├── cc-switch/                 # cc-switch 桌面版 Claude 供应商导入
├── filehistory/               # 文件检查点历史
├── history/                   # 输入历史
├── markdown/                  # Markdown 解析与终端渲染
├── presentation/              # 展示模型（通知、面板、命令结果等）
├── runtime/                   # 项目运行时状态
└── ui/                        # Ink 组件：App、输入框、面板、横幅、主题、能力检测
```

`docs/<主题>/` 下按章节保存四份设计文档；`changelogs/*.md` 是团队/历史变更记录；`skills/`、`agents/` 是仓库内内置 Skill 与角色定义。

## 4. 已实现模块与状态

### 4.1 基础对话与 Provider（已完成）

- 统一 `LLMProvider` 接口，支持 Anthropic 与 OpenAI 两种 SSE 协议；DeepSeek 走 OpenAI 协议。
- `config.yaml` 多供应商管理，`--provider` > `default: true` > 交互选择。
- 关键文件：`src/provider/*`、`src/config/*`、`src/chat/manager.ts`。

### 4.2 工具系统（已完成）

- 六大核心工具：`read_file`、`write_file`、`edit_file`、`run_command`、`find_files`、`search_code`。
- 统一 `Tool` 接口、注册中心、结构化错误、执行超时、路径沙箱（限制在项目根内，符号链接安全）。
- `edit_file` 按唯一原文匹配替换，匹配不到/多次匹配返回清晰错误。
- 关键文件：`src/tool/*`、`src/tool/tools/*`；文档：`docs/tool-system/`。

### 4.3 Agent Loop（已完成）

- ReAct 模式自主循环：模型请求 → 工具执行 → 结果回灌，直到模型不再要工具。
- 停止条件：模型完成、迭代上限、用户取消、连续未知工具、流错误；默认迭代上限已解除（`7223970`），显式 `maxIterations` 仍生效。
- 异步事件流：文本、工具调用、工具结果、Token 用量、进度；流收集器双路：实时推 UI + 攒完整响应。
- 多工具调度：读类工具并发、副作用串行；Plan Mode 只放开读类工具（`/plan`、`/do`）。
- 关键文件：`src/agent/*`；文档：`docs/agent-loop/`。

### 4.4 系统提示词（已完成）

- 固定模块按优先级拼装：身份、系统约束、任务模式、动作执行、工具使用、语气风格、文本输出、环境信息；可选模块：自定义指令、已激活 Skill、长期记忆。
- 稳定 System Prompt 和工具定义保持不变，动态补充指令通过带特殊标签的消息在运行期注入，不污染缓存。
- 关键文件：`src/prompt/*`；文档：`docs/system-prompt/`（含 `manual-evaluation.md`）。

### 4.5 权限系统（已完成核心能力）

- 五层防御：危险命令黑名单（不可配置放开）、路径沙箱、规则引擎、权限模式（strict/default/allow）、人工确认。
- 规则格式：`Bash(git *)` 式 `工具名(模式)`，allow/deny 两种结果；用户级、项目级、本地级 YAML 三层，越靠近项目优先级越高。
- 权限拒绝不终止 Agent Loop，结果回灌让模型调整策略。
- 关键文件：`src/permission/*`；文档：`docs/permission-system/`。
- 尚未做（Spec 明确留后续）：网络请求限制、资源配额、审计日志。

### 4.6 MCP 客户端与配置桥接（已完成）

- 支持 stdio 子进程和 Streamable HTTP 两种传输，JSON-RPC 2.0 请求/响应按 id 配对。
- 会话流程：初始化握手 → 列出工具 → 调用工具；远端工具适配为 BetterCode `Tool` 并注册进工具中心。
- 多 Server 缓存与生命周期管理，单个 Server 挂了不影响其他；用户级、项目级配置两层合并。
- 已增加“通用配置桥接层”，解决 MCP 工具正确配置但没有桥接层可直接使用的问题（提交 `415cf70`）。
- 当前 `.mcp.json` 配置了 `context7` HTTP Server。
- 关键文件：`src/mcp/*`；文档：`docs/mcp-client/`。
- 尚未做：MCP 资源、提示词、采样、Server 健康检查与自动重连。

### 4.7 上下文管理（已完成）

- 两层压缩：轻量预防（单条工具结果超阈值落盘到 `.bettercode/context/`，对话留预览和路径）+ 重量兜底（接近窗口上限时 LLM 生成结构化摘要，保留近期约 10K token / 至少 5 条原文，用户消息原文保留）。
- 近似 Token 估算：以 API usage 为锚点，增量按字符估算；自动触发留 13K 安全余量，手动 `/compact` 留 3K。
- 摘要 Prompt 禁止调工具、先写草稿再正式摘要；摘要失败 3 次熔断。
- 关键文件：`src/context/*`；文档：`docs/context-management/`。

### 4.8 记忆系统（已完成）

- 启动按层级加载 `BETTERCODE.md`、`AGENTS.md`、`.bettercode/INSTRUCTIONS.md`、`BETTERCODE.local.md`，支持 `@path` 引用，通过运行期指令消息注入。
- 会话实时写入 `.bettercode/sessions/<id>.jsonl`，支持 `/session` 查看/恢复。
- Agent 完成后后台提取长期记忆：项目知识 → `.bettercode/memory/`，用户偏好 → `~/.bettercode/memory/`，索引 `MEMORY.md`。
- `/memory` 查看两级记忆；`/rewind` 回滚文件/对话检查点；输入历史保存在 `.bettercode/prompt_history.jsonl`，方向键回看最近 200 条。
- 关键文件：`src/memory/*`、`src/session/*`、`src/filehistory/*`；文档：`docs/memory-system/`。

### 4.9 命令系统（已完成）

- 注册中心、解析器、分发器；别名、Tab 补全、大小写不敏感；未命中带 `/help` 引导。
- 命令类型：本地操作、影响界面、预设提示词（Skill 命令）。
- 内置命令见第 6 节；`/session`、`/model` 等候选列表命令已改为动态命令面板。
- 关键文件：`src/command/*`；文档：`docs/command-system/`、`docs/command-menu/`。

### 4.10 Skill 系统（已完成）

- Markdown + YAML frontmatter（name、description、tools 白名单、mode、history、model）。
- 三级存放：项目 > 用户 > 内置；两阶段加载：启动只注入名字和说明，`load_skill` 或同名斜杠命令再加载完整指令。
- `shared` 复用主对话；`isolated` 开独立对话跑完回流摘要；目录型 Skill 支持专属 Node 脚本工具。
- 内置样板：`commit`、`review`、`test`；仓库还有 `mew-spec` Skill。
- 关键文件：`src/skill/*`、`skills/`；文档：`docs/skill-system/`。
- 尚未做：Skill 市场分发和版本管理。

### 4.11 Hook 系统（已完成）

- `event + if + action` 三要素；会话、轮次、消息、工具、系统事件共 10 个。
- 四种动作：`command`、`prompt`、`http`、`agent`（子 Agent 动作已真实实现，提交 `239610c`）。
- `pre_tool_use` 可拦截并返回 `{decision:"deny",reason}`，拒绝原因作为 `HOOK_DENIED` 结果回灌模型。
- 支持 `once`、`background`、`timeout_ms`；Hook 失败只记日志不中断主流程；配置 YAML 用户级/项目级/本地级。
- 关键文件：`src/hook/*`；文档：`docs/hook-system/`。
- 尚未做：`once` 持久化、Hook 显式执行顺序优先级。

### 4.12 子 Agent 系统（已完成）

- 统一 `agent` 工具，`type: defined | fork`；定义式从空白对话 + 角色启动，Fork 式继承父上下文（利用 prompt cache）。
- 角色 Markdown + frontmatter（工具白/黑名单、模型、最大轮次、权限模式）；项目 > 用户 > 内置 > 插件加载。
- 运行时状态隔离（消息、权限、读缓存、token 计数），基础设施共享；后台任务管理器、`/tasks` 查看。
- 前台超时默认 120 秒可自动转后台；`Ctrl+B` 手动转后台；Fork 强制后台。
- 工具过滤多层防线，防止无限嵌套；后台结果异步通知并在下一次自然请求注入。
- 关键文件：`src/subagent/*`；文档：`docs/subagent-system/`。
- 尚未做：后台任务跨会话持久化、Worktree 默认隔离（Worktree 系统已单独实现）。

### 4.13 Worktree 系统（已完成）

- 基于 Git Worktree 的隔离目录：同一仓库多工作目录、各自分支，目录在仓库内不追踪位置。
- 名称严格校验（字符集、长度、拒绝 `.`/`..`、允许斜杠嵌套）。
- 完整生命周期：创建（含快速恢复）、进入、退出、删除；退出时未提交/未推送默认拒绝删除。
- 初始化复制本地配置、配置 hooks、软链大型依赖目录、补必需忽略文件；工具显式传 cwd，缓存以绝对路径为 key。
- 子 Agent 角色 frontmatter `isolation: worktree` 可声明隔离需求。
- 关键文件：`src/worktree/*`；文档：`docs/worktree-system/`。
- 尚未做：Worktree 间合并策略、跨目录代码同步、多 Agent 并行编排（由团队章节接管）。

### 4.14 团队系统（已完成）

- 长期小组对象：名称、负责人、成员花名册、持久化位置；成员可指定角色、工作目录、运行后端、是否审批。
- 成员运行后端：独立终端窗格（iTerm2/tmux/WezTerm/进程 Worker）或同进程协程。
- 协作工具：共享任务列表（增删查改 + 依赖字段）、点对点邮箱；主入口和普通子 Agent 看不到团队工具。
- 审批流程：需要审批的队员先发计划，Lead 用结构化回复批准/驳回。
- Lead 发起：拆分任务、派生成员、完成后 git 合并各目录，解决不了就回滚上报。
- `coordinator` 模式：能力开关 + 环境变量两把锁，开启后 Lead 只保留读工具、shell、派人/终止/发消息/合并代码。
- 关键文件：`src/team/*`；文档：`docs/team-system/`。
- 尚未做：跨机器分布式团队、成员实时流式通信、复杂任务依赖约束。

### 4.15 UI 与交互（已完成）

- **启动横幅**：启动时展示一次用户指定的 BETTERCODE 像素横幅（橘色渲染，含逐行动画、居中、ASCII 降级）；不再使用虚拟形象（用户要求移除）。
- **Markdown 渲染**：助手最终回复、命令结果、通知统一走终端 Markdown 渲染；流式期间纯文本，停止后解析一次；支持标题、列表、代码块、表格（窄屏降级）、链接文本化；HTML/ANSI 安全处理。
- **动态命令面板**：输入 `/` 自动打开，候选实时过滤；命令名左对齐、描述右对齐，选中项整行高亮，超一页可滚动并显示剩余数量；Tab 补全、Esc 收起、输入框显示光标。
- **`/session`**：动态面板按会话摘要展示（不再是首条任务），方向键选择、Enter 恢复、Delete 删除、Esc 退出。
- **`/model`**：动态面板列出供应商，cc-switch Provider 显示档位（Sonnet/Opus/Fable/Haiku）和上下文窗口（含 `[1M]`）。
- **`/context`**：上下文占用格子 + 分类汇总（System prompt / System tools / MCP tools / Skills / Messages / Free space），格子按图例分类着色，分类明细在方格下方按 `├` 树形展开，token 数值弱化；每格约 5K token，窗口动态变化。
- **底部状态栏已移除**：模型/模式/权限/Token 不再常驻终端底部，改为 `/status` 按需查询。
- **思考过程不再展示**：`thinking_delta` 在流收集器被丢弃，UI 无思考分区（提交 `97bd6c4`）。
- **Apple Terminal 加固**：破折号族 ASCII 替换、长文本硬换行、低重绘帧率、稳定性提示。
- 关键文件：`src/ui/*`、`src/markdown/*`、`src/presentation/*`；文档：`docs/ui-system/`、`docs/markdown-rendering/`、`docs/context-command/`。

### 4.16 cc-switch 适配（已完成）

- 启动时读取 `~/.cc-switch/cc-switch.db`（Claude Code 线），导入全部 Claude 供应商，当前激活项作为默认；数据库不可用时回退 `~/.claude/settings.json` 的当前激活 env。
- 支持 `ANTHROPIC_AUTH_TOKEN` Bearer / `ANTHROPIC_API_KEY` x-api-key；`base_url` `/v1` 归一化。
- 档位模型（Sonnet/Opus/Fable/Haiku）与 `[1M]` 上下文标记解析；`/model` 会话内切换。
- 只读不写回 cc-switch；失败不崩溃，显示诊断并回退原配置；诊断不泄露 key。
- 已移除代码中硬编码的 DeepSeek API Key（提交 `1363ebb`），改为 `${DEEPSEEK_API_KEY}` + cc-switch 凭据。
- 关键文件：`src/cc-switch/*`；文档：`docs/cc-switch/`。

## 5. 当前配置

`config.yaml`：

```yaml
providers:
  - name: deepseek-v4          # 默认：DeepSeek flash 正式版
    protocol: openai
    model: deepseek-v4-flash
    context_window: 128000
    base_url: https://api.deepseek.com
    api_key: ${DEEPSEEK_API_KEY}
    default: true
  - name: claude-sonnet        # Anthropic 协议示例
    protocol: anthropic
    model: claude-sonnet-5-20251001
    context_window: 200000
    base_url: https://api.anthropic.com
    api_key: ${ANTHROPIC_API_KEY}
    thinking: false
  - name: gpt-4o
    protocol: openai
    model: gpt-4o
    context_window: 128000
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}
worktrees:
  retention_days: 7
  cleanup_interval_ms: 3600000
cc_switch:
  enabled: true
```

`.mcp.json`：注册 `context7` HTTP Server（`https://mcp.context7.com/mcp`）。

运行时目录（已 gitignore）：`.bettercode/memory/`、`sessions/`、`context/`、`file-history/`、`worktrees/`、`worktree-state/`、`logs/`、`permissions.local.yaml`、`hooks.local.yaml`、`prompt_history.jsonl`。

## 6. 命令清单

| 命令 | 作用 |
|---|---|
| `/help [命令]` | 命令目录/单条帮助，别名 `h`、`?` |
| `/compact` | 手动压缩较早上下文 |
| `/clear` | 清空当前会话和界面（别名 `reset`），同时清理会话上下文文件 |
| `/plan` | 进入只读计划模式（别名 `p`） |
| `/do` | 返回执行模式（别名 `d`） |
| `/session [ID]` | 动态面板查看/恢复/删除历史会话（别名 `s`、`resume`、`r`） |
| `/model` | 动态面板切换模型/档位 |
| `/memory` | 查看长期记忆状态（别名 `m`） |
| `/permission [strict\|default\|allow]` | 查看/切换权限模式（别名 `permissions`、`perm`） |
| `/tasks [ID]` | 查看子 Agent 后台任务 |
| `/status` | Provider、模式、权限、Token、会话、记忆状态（别名 `st`） |
| `/context` | 上下文占用与分类明细（别名 `ctx`） |
| `/team ...` | 团队管理：list/create/use/status/archive/restore |
| `/rewind` | 回滚文件或对话检查点 |
| `/exit` `/quit` | 退出 |
| Skill 命令 | `/commit`、`/review`、`/test`、`/mew-spec` 等自动注册 |

## 7. 最近对话完成的工作（重点时间线）

1. **Agent Loop 迭代上限解除**：默认不再限制 10 轮（`7223970`），复杂任务可持续执行。
2. **Markdown 渲染落地**：助手回复与命令结果统一渲染（`37cbe94`、`6d6052e`、`557bb1e`）。
3. **UI 视觉与交互升级**：终端视觉交互系统设计（`77d6c4a`），横幅、动态命令面板、选中高亮、光标、颜色体系、ASCII 降级等（`744ebe4` 到 `2bbdbcd` 一系列提交）。
4. **启动横幅定型**：多轮设计后确定为“用户指定模板原样输出的 BETTERCODE 像素横幅”，不再尝试自动拼接字母（`58ae884`、`4949278`），后续也不再改。
5. **Apple Terminal 加固**：排查并修复 Terminal.app 崩溃（`fcaf8b1`、`2762309`）：破折号族替换、硬换行、低重绘。
6. **`/session` 交互化**：会话摘要展示、动态选择、Delete 删除（`2762309`）。
7. **cc-switch 桌面版适配**：自动导入 Claude 供应商（`0669c1d`），启用导入（`e09e716`），修复用户目录未传导致跳过（`d5d9155`），移除硬编码 API Key（`1363ebb`）。
8. **`/model` 命令**：运行时切换模型，逐步支持全部 cc-switch 供应商、档位与 1M 上下文（`1632c52` → `6572645`）。
9. **`/context` 命令**：新增上下文占用展示，并经过多轮格式化迭代：分类明细树形展开、按分类着色、每格 5K、方格与明细分离（`38f5bfd` → `9764cf5`）。
10. **移除思考过程展示**：Agent 不再把 `thinking_delta` 透传给 UI（`97bd6c4`）。
11. **Apple Terminal 系统级崩溃提示**：最新提交 `1fdf7b4`，在 Apple Terminal 启动时展示稳定性提示（AppKit 菜单更新崩溃风险，建议改用 iTerm2 / VS Code 终端 / Warp）。

## 8. 已知问题与注意事项

- **Apple Terminal.app 崩溃**：崩溃发生在系统 `Terminal.app` 的 AppKit 菜单快捷键更新逻辑（`NSMenuShortcutUpdater` / `NSLocalizedKeyboardShortcuts`），切换输入法等系统事件会触发 PAC 异常并杀掉整个终端进程，BetterCode 应用层无法修复；已加启动稳定性提示，建议改用 iTerm2、VS Code 终端或 Warp。
- **cc-switch 变更需重启**：cc-switch 中新增/删除供应商后需要重启 BetterCode；已导入供应商可随时用 `/model` 切换。
- **文档 checklist 状态不等于实现状态**：部分系统文档（如 `context-management`、`memory-system`、`mcp-client`、`worktree-system`、`team-system` 等）的 checklist 仍保留大量未勾选项，但这些模块的实际代码、测试和提交已经存在。以 `src/` 代码、`pnpm check`、`README.md` 和 git 提交为准。
- **README 局部描述偏旧**：例如终端界面一节仍写“小码”品牌区，实际启动画面已是 BETTERCODE 像素横幅；阅读时以 `src/ui/` 实现为准。
- **日志**：运行期异常写入 `.bettercode/logs/runtime-errors.log`；Hook 失败写入 `.bettercode/logs/hooks.jsonl`。
- **系统命名**：文档/代码中出现 MewCode 属于旧名残留，不要全局重命名，也不要按 MewCode 称呼系统。

## 9. 未完成 / 未来方向

按各章节 Spec 明确留给后续的内容，当前仍未做：

- 权限系统：网络请求限制、资源配额、审计日志。
- MCP：资源、提示词、采样等非工具能力，Server 健康检查与自动重连。
- 上下文管理：精确 tokenizer、摘要策略的机器学习优化。
- Skill：市场分发与版本管理。
- Hook：`once` 标记持久化、Hook 显式执行顺序优先级。
- 子 Agent / Worktree：后台任务跨会话持久化、Worktree 合并策略、跨目录代码同步。
- 团队：跨机器分布式团队、成员实时流式通信、复杂任务依赖约束。
- 后续若用户提出新的功能/优化，遵循 AGENTS.md：新主题写四份文档，已有主题增量补充。

## 10. 文档体系

仓库 `docs/` 下每个主题均有 `spec.md`、`plan.md`、`task.md`、`checklist.md`：

`tool-system`、`agent-loop`、`system-prompt`、`permission-system`、`mcp-client`、`context-management`、`memory-system`、`command-system`、`command-menu`、`skill-system`、`hook-system`、`subagent-system`、`worktree-system`、`team-system`、`markdown-rendering`、`ui-system`、`cc-switch`、`model-command`、`context-command`，以及根目录早期四份基础文档。

## 11. 给新 AI 的接手建议

1. 先读 `AGENTS.md` 和 `README.md`，再按本文件定位相关模块。
2. 改动前先运行 `pnpm check` 确认基线，改动后再跑一遍全量验证和 `git diff --check`。
3. 遵循四份文档工作流：新功能写四份文档并等用户确认后再实现；局部优化在既有文档增量补充。
4. 所有 Git 提交使用中文信息；代码注释使用中文；系统名始终写 BetterCode。
5. 涉及候选列表的命令改动必须保持动态命令面板交互（方向键/Enter/Esc、左命令右描述、整行高亮、滚动）。
6. 当前没有正在进行的开放任务；下一件事由用户新会话提出。
