# BetterCode Skill 系统 Plan

## 架构概览

新增 `src/skill/` 作为 Skill 领域层。`SkillLoader` 扫描三级目录、解析 Markdown 和目录型工具；`SkillManager` 负责优先级覆盖、完整快照校验、共享激活状态、可见工具计算、热更新和订阅；`SkillScriptTool` 把 `.mjs` 实现适配为现有 `Tool` 接口；`LoadSkillTool` 提供模型按需激活入口；`SkillRunner` 编排共享和独立执行。

ToolRegistry 继续持有全部可执行工具，但 AgentLoop 不再直接暴露全部定义。每轮由 SkillManager 根据当前激活状态生成工具名称集合，AgentLoop 用该集合构建 Provider 请求，ToolScheduler 用同一集合做执行前二次校验。`load_skill` 标记为系统工具，始终加入集合并跳过人在回路。

Prompt 层增加可用 Skill 目录和动态激活内容。AgentLoop 每轮从函数读取最新补充内容，先放已激活完整 SOP，再放环境、模式、可用 Skill 元信息、自定义指令和长期记忆。System Prompt 与稳定工具定义格式不变。

CommandRegistry 增加 Skill 动态命令组。App 订阅 SkillManager 快照版本，在下一次渲染原子重建 registry 和 dispatcher。Skill 命令统一调用 `CommandUIController.runSkill`，共享和独立模式由 ChatManager/SkillRunner 决定。

## 目录约定

```text
内置: <bettercode-package>/skills/
用户: ~/.bettercode/skills/
项目: <project>/.bettercode/skills/

单文件:
  skills/release.md

目录型:
  skills/release/
    SKILL.md
    tools/
      inspect.tool.yaml
      inspect.schema.json
      inspect.mjs
```

同名覆盖先按 Skill frontmatter 的规范名称分组，再选择优先级最高的候选。最高优先级候选损坏时生成禁用占位，阻止低层回退。

## Skill 文件格式

```markdown
---
name: review
description: 审查代码并按严重程度报告问题
tools:
  - read_file
  - find_files
  - search_code
  - run_command
mode: isolated
history: 10
model: deepseek-v4
---

审查 {{args}}。
优先报告 bug、行为回归、安全风险和缺失测试。
最终输出可独立理解的简洁摘要。
```

| 字段 | 类型 | 规则 |
|------|------|------|
| `name` | string | 必填，`[a-z][a-z0-9-]*`，同时作为斜杠命令名 |
| `description` | string | 必填，单行非空说明 |
| `tools` | string[] | 必填、去重；允许空数组，`load_skill` 无需写入 |
| `mode` | `shared\|isolated` | 必填 |
| `history` | integer | 独立模式可选，默认 0；共享模式不得填写 |
| `model` | string | 独立模式可选，引用 Provider 配置名；共享模式不得填写 |

正文必须非空，所有 `{{args}}` 全量替换为调用参数。frontmatter 不支持任意扩展字段，拼写错误直接产生诊断。

## 专属工具格式

`tools/<name>.tool.yaml`：

```yaml
name: inspect_package
description: 读取并分析包元数据
schema: ./inspect.schema.json
script: ./inspect.mjs
effect: read_only
permission:
  targetKind: arguments
  risk: read
```

Schema 文件是标准 JSON Schema 对象。脚本由 `process.execPath` 直接启动，不经过 Shell；项目根是 cwd。stdin 接收一个 JSON 参数对象，stdout 返回一个结构化 ToolResult JSON，stderr 仅用于有界诊断。

## 核心数据结构

```typescript
export type SkillScope = 'builtin' | 'user' | 'project';
export type SkillExecutionMode = 'shared' | 'isolated';

export interface SkillMetadata {
  name: string;
  description: string;
  tools: readonly string[];
  mode: SkillExecutionMode;
  history: number;
  model?: string;
}

export interface SkillDefinition extends SkillMetadata {
  scope: SkillScope;
  entryPath: string;
  directory: string;
  body: string;
  dedicatedTools: readonly Tool[];
}

export interface SkillDiagnostic {
  scope: SkillScope;
  file: string;
  name?: string;
  code: string;
  message: string;
}

export interface SkillSnapshot {
  revision: number;
  skills: ReadonlyMap<string, SkillDefinition>;
  disabledNames: ReadonlySet<string>;
  diagnostics: readonly SkillDiagnostic[];
  dedicatedToolNames: ReadonlySet<string>;
}

export interface ActiveSkill {
  name: string;
  content: string;
  tools: readonly string[];
  activatedAt: number;
}
```

```typescript
export interface SkillExecutionRequest {
  name: string;
  args: string;
  displayText: string;
  currentProvider: LLMProvider;
  mode: AgentMode;
  signal: AbortSignal;
  permissionDecider?: PermissionDecider;
}

export interface SkillVisibility {
  names: ReadonlySet<string>;
  restricted: boolean;
}

export interface SkillProviderResolver {
  has(name: string): boolean;
  resolve(name: string): LLMProvider;
}
```

## 模块设计

### `src/skill/parser.ts`

- 拆分入口 Markdown 的 frontmatter 和正文。
- 使用 `yaml` 严格校验字段与组合。
- 返回规范化 metadata、原始正文和诊断。
- `renderSkillBody` 只做 `{{args}}` 字面替换，边界转义由 reminder 统一处理。

### `src/skill/tool-loader.ts`

- 只读取入口同目录 `tools/*.tool.yaml`。
- 校验工具元信息、JSON Schema、effect 和 permission。
- Schema 与脚本真实路径必须保持在 Skill 目录内。
- 构造 `SkillScriptTool`，单个专属工具错误使所属 Skill 失效。

### `src/skill/script-tool.ts`

- 通过 `spawn(process.execPath, [scriptPath])` 启动，不启用 Shell。
- stdin 写稳定 JSON；stdout/stderr 分别使用有限缓冲。
- 监听 AbortSignal 并终止子进程。
- JSON、退出码或结果结构非法时返回 `EXECUTION_ERROR`。
- 权限、外层超时和总输出限制继续交给 ToolRegistry。

### `src/skill/loader.ts`

- 内置目录通过 `import.meta.url` 定位，用户目录和项目目录允许测试注入。
- 每层稳定查找根目录 `.md` 和一级子目录 `SKILL.md`。
- 先提取可识别名称用于遮蔽，再完整解析最高优先级候选。
- 返回 Skill、禁用名称和诊断，不直接修改 ToolRegistry。

### `src/skill/manager.ts`

`SkillManager` 持有原子快照和共享激活状态，主要接口：

```typescript
initialize(): void;
reload(): SkillReloadResult;
startWatching(): void;
subscribe(listener: (snapshot: SkillSnapshot) => void): () => void;
list(): SkillMetadata[];
get(name: string): SkillDefinition | undefined;
activateShared(name: string, args: string): ActiveSkill;
clearActive(): void;
promptContent(scope?: SkillExecutionScope): SupplementalSkillContent;
visibleTools(scope?: SkillExecutionScope): SkillVisibility;
resolveLoad(name: string, args: string): SkillLoadResolution;
close(): Promise<void>;
```

初始化先扫描候选、解析专属工具、检查工具冲突、注册 `load_skill`、校验完整白名单、Provider 引用和命令保留名，再发布 revision 1。未知白名单或命令冲突使冷启动失败；普通解析错误与无效 Provider 只禁用单个 Skill。

热更新先在内存构建完整替换计划，所有校验通过后才替换动态工具与快照。失败保留旧 revision。仍存在的共享 Skill 按原参数重新渲染，删除的 Skill 取消激活。目录变化用 `unref()` 的定时指纹扫描检测，避免递归 `fs.watch` 的平台差异。

### `src/skill/load-tool.ts`

稳定工具名为 `load_skill`，参数为 `name` 和可选 `args`。共享 Skill 立即激活并返回确认；独立 Skill 返回 runner 可识别的内部 metadata。未知或禁用 Skill 返回 `TOOL_UNAVAILABLE`，不泄漏正文和脚本路径。

### `src/skill/runner.ts`

- 共享命令激活后复用主 ChatManager Agent 流。
- 独立命令从主历史尾部选择不拆分工具组的最近 N 条消息。
- 创建临时 ContextManager 和 AgentLoop，只注入目标 Skill 并使用目标白名单。
- 使用指定 Provider 或当前 Provider，完成后关闭临时资源。
- 主 ChatManager 只追加显示命令与最终摘要。
- 主 loop 调用独立 `load_skill` 时，用摘要替换该工具结果后继续 Agent Loop。

### `src/tool/registry.ts`

增加动态工具和系统工具本地元数据：

```typescript
interface ToolRegistrationOptions {
  owner?: string;
  system?: boolean;
}

register(tool: Tool, options?: ToolRegistrationOptions): void;
replaceOwned(owner: string, tools: readonly Tool[]): void;
definitionsFor(names: ReadonlySet<string>, effect?: ToolEffect): ToolDefinition[];
names(): string[];
isSystem(name: string): boolean;
```

`replaceOwned` 先编译全部新 Schema，再原子替换同 owner 工具。现有 core/MCP 调用保持兼容。

### `src/agent/loop.ts` 与 `src/agent/tool-scheduler.ts`

- AgentLoop 每轮重新读取 supplemental 和 SkillVisibility。
- Provider 工具列表使用 `definitionsFor`；Plan Mode 再按 `read_only` 过滤，系统 `load_skill` 始终保留。
- ToolScheduler 接收 `allowedToolNames`，不可见已注册工具返回 `TOOL_UNAVAILABLE`，不计未知 streak。
- system tool 跳过 PermissionManager，普通工具维持现有流程。
- 独立 load 结果通过 runner hook 转成摘要后再写主历史。

### `src/prompt/types.ts` 与 `src/prompt/reminder.ts`

增加 `AvailableSkill { name, description }`。Reminder 顺序固定为：已激活 Skill、环境信息、当前任务模式、可用 Skill、自定义指令、长期记忆。未激活目录只输出 `- name: description`。

### `src/command/` 与 `src/ui/app.tsx`

- 从硬编码 builtins 移除 `/review`，由内置 Skill 提供。
- `CommandUIController` 增加 `runSkill(name, args, displayText)`。
- App 订阅 Skill revision，用默认命令加 Skill 命令原子创建 registry/dispatcher。
- 帮助和补全读取当前 registry；`/status` 增加激活 Skill 名称。

### `src/chat/manager.ts` 与 `src/index.tsx`

- ChatManager 接收 SkillManager/Runner，向主 loop 提供动态提醒和可见工具。
- 增加 `runSkill`；`clear()` 与 `resumeSession()` 清除共享激活状态。
- Index 在 MCP 发现后初始化 SkillManager，再创建 PermissionManager 和 ChatManager。
- 从全部 ProviderConfig 构建惰性 Provider resolver，当前 Provider 复用现有实例。
- finally 关闭 ChatManager、SkillManager 和 MCP Manager。

## 模块交互

```text
启动
  -> MCP 工具注册
  -> SkillLoader 扫描三级目录
  -> SkillManager 注册专属工具 + load_skill
  -> 校验白名单/Provider/命令
  -> 普通请求只注入 Skill 名称与说明

load_skill(shared)
  -> 激活完整 SOP
  -> 下一轮 reminder 置顶 SOP
  -> 工具切为白名单并集 + load_skill

/review src/chat
  -> 动态 Skill 命令
  -> 临时 AgentLoop 使用最近 N 条历史
  -> 丢弃临时工具历史
  -> 主历史追加命令与最终摘要
```

## 文件组织

```text
src/skill/
  types.ts
  parser.ts
  script-tool.ts
  tool-loader.ts
  loader.ts
  load-tool.ts
  manager.ts
  runner.ts
  *.test.ts
skills/
  commit/SKILL.md
  review/SKILL.md
  test/SKILL.md
```

同时修改 `src/tool/registry.ts`、`src/agent/loop.ts`、`src/agent/tool-scheduler.ts`、`src/prompt/*`、`src/command/*`、`src/chat/manager.ts`、`src/ui/app.tsx`、`src/index.tsx`、README 和对应测试。

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 总体架构 | SkillManager + 运行期工具视图 | 复用现有 Registry、Prompt、Agent Loop 和 Command 边界 |
| 高层损坏覆盖 | 禁用名称且不回退 | 防止静默执行用户未预期的低层 SOP |
| 白名单组合 | 多个激活 Skill 取并集 | 每个已激活能力仍能使用自身工具 |
| 独立历史 | 最近完整消息条数 | 行为直观并保持工具协议完整 |
| 指定模型 | Provider 配置名，仅独立模式 | 协议、地址和密钥必须成套选择 |
| 独立生命周期 | 一次性，不持续激活 | 保持主上下文和工具集合隔离 |
| 短命令 | 直接加载并运行 | 响应确定，不增加模型选择轮次 |
| 专属脚本 | Node.js `.mjs` + JSON 协议 | 与运行时一致，无需 Shell |
| 工具注册 | 全部注册、按激活状态隐藏 | 启动可校验白名单，模型仍按需看到工具 |
| 热更新 | 轮询指纹 + 原子快照 | 覆盖目录新建并避免 watcher 平台差异 |
| 无效热更新 | 保留上个有效快照 | 编辑半成品不破坏运行中会话 |

## Spec 覆盖

F1-F8 由 parser、tool-loader 和 loader 覆盖；F9-F16 由 manager、runner、prompt 和 ChatManager 覆盖；F17-F24 由 ToolRegistry、AgentLoop、ToolScheduler 和 ScriptTool 覆盖；F25-F30 由 command、App 和 manager watcher 覆盖；F31-F34 由 `skills/` Markdown 样板覆盖。不存在未归属需求。
