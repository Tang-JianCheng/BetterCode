# 项目记忆与会话持久化 Plan## 技术栈

- 运行时：bun（`bun run src/main.tsx`、`bun test`）
- 语言：TypeScript 5.x，`tsc --noEmit` 做类型检查
- TUI：Ink 5（React 18 渲染到终端），`useInput` 处理键盘事件
- LLM SDK：`@anthropic-ai/sdk`、`openai`，通过 `LLMClient` 接口统一封装
- markdown frontmatter：`js-yaml` 解析顶层 YAML
- 文件 I/O：`node:fs` 同步 API（`writeFileSync` 追加、`readFileSync` 全量读、`statSync` 取 mtime）
- 加密：`node:crypto` 的 `randomBytes`（session ID 随机后缀）和 `createHash`（filehistory 文件名）
- 测试：`bun test`（`bun:test` runtime）

## 架构概览

本章在已有目录上新增四块独立子模块，加上对 TUI 与 conversation 的窄幅集成：

| 新增/已存在 | 模块 | 职责 |
|------|------|------|
| 新增 | `src/memory/instructions.ts` | 多层 BETTERCODE.md / AGENTS.md 加载 + `@include` 展开 |
| 新增 | `src/memory/manager.ts` | 笔记扫描、MEMORY.md 索引重建、按需 selector 检索 |
| 新增 | `src/memory/extractor.ts` | LLM 提取笔记、双路路由、合并并发 |
| 新增 | `src/session/session.ts` | JSONL 读写、会话列表、压缩边界、过期清理 |
| 新增 | `src/history/history.ts` | 命令行 prompt 历史（`prompt_history.jsonl`） |
| 新增 | `src/filehistory/filehistory.ts` | 文件快照与回滚 |
| 修改 | `src/conversation/conversation.ts` | 新增 `injectLongTermMemory` 与 `replaceWithCompacted` |
| 修改 | `src/prompt/builder.ts` | `buildSystemPrompt` 接受 `customInstructions` / `memorySection` |
| 修改 | `src/agent/agent.ts` | `onLoopComplete` 钩子在 loop 结束时回调宿主 |
| 修改 | `src/tui/app.tsx` | 注入指令和记忆、注册 `/resume`、写入 JSONL、驱动 `MemoryExtractor` |
| 修改 | `src/commands/commands.ts` | 注册 `resume` / `memory` 内置命令 |
| 修改 | `src/compact/compact.ts` | `CompactResult.boundary` 暴露 `CompactBoundaryPayload` |

## 数据流

```
[App.initClient]
   ├─ loadInstructions(workDir)             ── 拼接所有 BETTERCODE.md/AGENTS.md（含 @include 展开）
   ├─ new MemoryManager(workDir)
   │     └─ buildSystemReminder()           ── 扫两级 memory 目录，生成摘要文本
   ├─ conv.injectLongTermMemory(...)        ── 写入 conversation 首条 <system-reminder>
   ├─ conv.addSystemReminder("IDENTITY...") ── 紧贴其后追加身份硬注入
   └─ new FileHistory(workDir, sessionId)    ── 准备文件回滚目录

[App.handleSubmit("hello")]
   ├─ historyMod.append(historyDir, "hello")          ── prompt_history.jsonl
   ├─ conv.addUserMessage(expandAtRefs("hello"))
   └─ sessionMod.saveMessage(workDir, id, {role:"user",...})
                                                       └─ .jsonl 追加一行

[Agent.run() — loop_complete 事件]
   ├─ saveMessage(workDir, id, {role:"assistant", content: fullText, ...})
   └─ onLoopComplete(conv)
         └─ MemoryExtractor.extract(slice40Summary)    ── 后台任务，inProgress 合并
               ├─ doExtract → LLM → 解析 MEMORY_* 块
               ├─ writeFileSync 到 user/project 目录
               └─ MemoryManager.rebuildIndex()         ── 重写 MEMORY.md

[App "/resume <id>"]
   ├─ sessionMod.loadSession(workDir, id) → SessionMessage[]
   ├─ new ConversationManager() → injectLongTermMemory(...)
   ├─ rebuildFromSession(saved) → RestoredMessage[]
   │     └─ 命中 COMPACT_BOUNDARY 时拼接 summary + keep[] + 边界后追加
   ├─ 依次 addUserMessage/addAssistantMessage
   └─ sessionIdRef.current = id; TaskList.useStore(new TaskStore(workDir, id))

[forceCompact / Agent 内部 manageContext]
   └─ 触发 compact 事件携带 boundary
         └─ TUI 收到 → sessionMod.saveCompactBoundary(workDir, id, payload)
                        └─ .jsonl 追加 type:"compact_boundary" 行
```

## 核心数据结构与接口### `src/memory/instructions.ts`

```typescript
/** @include 最大递归深度 */
const MAX_INCLUDE_DEPTH = 5;

export interface InstructionSource {
  path: string;     // 加载源的绝对路径
  content: string;  // 已展开 @include 的内容
}

/** 拼接 ~/.bettercode、git root → workDir 路径上每一层、本地覆盖等所有指令文件。 */
export function loadInstructions(workDir: string): string;

/** 仅返回 InstructionSource[]，不做拼接。 */
export function discoverInstructions(workDir: string): InstructionSource[];
```

### `src/memory/manager.ts`

```typescript
export interface MemoryFile {
  path: string;
  name: string;
  description: string;
  type: string;          // user / feedback / project / reference
  content: string;       // frontmatter 之后的正文
}

export interface MemoryHeader {
  filename: string;
  filePath: string;
  scope: string;         // "user" / "project"
  mtimeMs: number;
  description: string;
  type: string;
}

export interface RelevantMemory {
  path: string;
  mtimeMs: number;
}

export class MemoryManager {
  constructor(workDir: string);

  loadAll(): MemoryFile[];
  getMemories(): MemoryFile[];

  /** 生成 "Active memories:\n- [name] (type): description" 文本。 */
  buildSystemReminder(): string;

  /** 重写 <workDir>/.bettercode/memory/MEMORY.md。 */
  rebuildIndex(): void;

  /** 清空两级 memory 目录里的所有 .md。 */
  clear(): void;

  /** selector 模式：让 LLM 在候选 headers 中选最多 5 条。 */
  findRelevantMemories(
    query: string,
    client: LLMClient,
    recentTools?: string[],
    alreadySurfaced?: Set<string>
  ): Promise<RelevantMemory[]>;
}
```

### `src/memory/extractor.ts`

```typescript
/**
 * MemoryExtractor 实现后台记忆提取。
 *  - inProgress 标志防止并发；
 *  - pendingContext 队列暂存抖动期间的请求；
 *  - 当前提取完成后自动用最新上下文执行尾部运行。
 */
export class MemoryExtractor {
  constructor(client: LLMClient, workDir: string);

  /** 提取入口：返回新写入的笔记名数组；与正在进行的提取自动合并。 */
  extract(conversationSummary: string): Promise<string[]>;
}
```

### `src/session/session.ts`

```typescript
export const COMPACT_BOUNDARY = "compact_boundary";

export interface SessionMessage {
  role: string;            // user / assistant / system
  content: string;         // 普通消息正文；compact_boundary 时是 payload JSON 字符串
  timestamp: string;       // ISO-8601
  type?: string;           // "compact_boundary" 或空
  toolUseId?: string;
}

export interface KeptMessage {
  role: string;            // user / assistant
  content: string;         // 纯文本
}

export interface CompactBoundaryPayload {
  summary: string;
  keep: KeptMessage[];
}

export interface SessionInfo {
  id: string;
  firstMessage: string;    // 第一条 user 消息前 100 字符
  messageCount: number;
  size: number;
  modTime: Date;
}

export interface RestoredMessage {
  role: "user" | "assistant";
  content: string;
}

export function newSessionId(): string;
export function getSessionFilePath(workDir: string, sessionId: string): string;

export function saveMessage(workDir: string, sessionId: string, msg: SessionMessage): void;
export function saveCompactBoundary(
  workDir: string,
  sessionId: string,
  payload: CompactBoundaryPayload
): void;

export function loadSession(workDir: string, sessionId: string): SessionMessage[];
export function rebuildFromSession(saved: SessionMessage[]): RestoredMessage[];
export function listSessions(workDir: string): SessionInfo[];
export function cleanExpiredSessions(workDir: string): number;
```

### `src/conversation/conversation.ts`（修改）

```typescript
export class ConversationManager {
  // ... 已有方法 ...

  /** 把指令文本和记忆摘要合并成首条 <system-reminder>，幂等注入一次。 */
  injectLongTermMemory(instructions: string, memories: string): void;

  /** 压缩后用 summary + 保留尾部整体替换 history。 */
  replaceWithCompacted(summaryContent: string, keep: Message[]): void;
}
```

### `src/prompt/builder.ts`（修改）

```typescript
export interface BuildOptions {
  skillSection?: string;
  customInstructions?: string;  // priority 95
  memorySection?: string;       // priority 100
}

export function buildSystemPrompt(env: EnvironmentContext, opts?: BuildOptions): string;
```

### `src/agent/agent.ts`（修改）

```typescript
export interface AgentConfig {
  // ... 已有字段 ...
  onLoopComplete?: (conversation: ConversationManager) => void;
}
```

### `src/history/history.ts`

```typescript
const MAX_ENTRIES = 200;
const FILENAME = "prompt_history.jsonl";

export function load(dir: string): string[];
export function append(dir: string, text: string): void;  // 去重相邻 + 容量上限
```

### `src/filehistory/filehistory.ts`

```typescript
export interface Backup {
  backupPath: string;
  version: number;
  time: string;
}

export interface Snapshot {
  messageIndex: number;
  userText: string;
  backups: Record<string, Backup>;
  timestamp: string;
}

export class FileHistory {
  constructor(baseDir: string, sessionID: string);

  trackEdit(path: string): void;
  makeSnapshot(msgIndex: number, userText: string): void;
  rewind(snapshotIndex: number): string[];

  getSnapshots(): Snapshot[];
  hasSnapshots(): boolean;
  save(): void;
}
```

## 模块设计### `src/memory/instructions.ts`

- 职责：发现并拼接所有 BETTERCODE.md / AGENTS.md，递归展开 `@include`，写出供 `ConversationManager.injectLongTermMemory` 用的纯文本。
- 对外接口：`loadInstructions(workDir)`、`discoverInstructions(workDir)`。
- 关键内部函数：
  - `projectInstructionDirs(workDir)` 用 `findGitRoot` 向上找 `.git/`，返回 git root → workDir 路径上的目录列表；无 git 时回退到 `[workDir]`。
  - `addSource(out, seen, filePath)` 解析绝对路径、`existsSync` 后 `readFileSync`，加入 `seen` 集合并调 `expandIncludes`。
  - `expandIncludes(content, baseDir, seen, depth)` 逐行扫描，跨越 fenced code block 边界时设 `inCode`；`parseInclude(trimmed)` 解析 `@./`、`@../`、`@~/`、`@/` 四种前缀；命中后用同一个 `seen` 集合递归。
- 依赖：`node:fs`、`node:path`、`node:os.homedir`。

### `src/memory/manager.ts`

- 职责：扫描两级 memory 目录（user 全局与 project 本地），生成系统级摘要、重建 `MEMORY.md` 索引、为按需检索提供 selector。
- 对外接口：`loadAll`、`getMemories`、`buildSystemReminder`、`rebuildIndex`、`clear`、`findRelevantMemories`。
- 关键细节：
  - `parseFrontmatter` 兼容顶层 `type` 与 `metadata.type` 嵌套（旧版本写法），`name / description / type` 任意缺失都用回退值。
  - `rebuildIndex` 排序用 `localeCompare(... { sensitivity: "base" })` 保证大小写不敏感。
  - `MAX_ENTRYPOINT_LINES = 200`、`MAX_ENTRYPOINT_BYTES = 25_000`，先按行截断再按字节截断到最近的换行边界。
  - `findRelevantMemories` 用 `scanMemoryHeaders` 按 mtime 倒序拿候选，然后用一个完整的 `ConversationManager` + `client.stream` 发出 selector 调用；返回 `extractJSONObject` 提取第一个 `{}` 后 `JSON.parse`。
- 依赖：`js-yaml`、`node:fs`、`ConversationManager`、`LLMClient`。

### `src/memory/extractor.ts`

- 职责：在 Agent loop 结束后调用一次 LLM，按固定模板提取若干笔记并落盘；具备合并并发的能力。
- 对外接口：`extract(conversationSummary)`。
- 内部状态：`inProgress: boolean`、`pendingContext: string | null`。
- 关键细节：
  - `runExtraction` 在 `finally` 检查 `pendingContext`，非空时递归执行尾部运行，输出累加。
  - `doExtract` 用 `client.stream(conv, [])` 不传任何工具定义，确保模型只输出文本。
  - 返回 `NONE` 或不含 `MEMORY_NAME:` 时跳过；否则用 `split("---")` 切块，每块独立 `extractField` 提取。
  - 双路：`type === "project" || "reference"` 写 `<workDir>/.bettercode/memory/<name>.md`；否则写 `~/.bettercode/memory/<name>.md`。
  - 写完一批后立即 `new MemoryManager(workDir).rebuildIndex()` 同步索引。
- 依赖：`MemoryManager`、`ConversationManager`、`LLMClient`、`node:fs`。

### `src/session/session.ts`

- 职责：JSONL 读写、压缩边界落盘、列出会话、按边界重建消息序列、过期清理。
- 关键细节：
  - `sessionsDir(workDir) = <workDir>/.bettercode/sessions`，所有路径在该函数内集中。
  - `newSessionId` = `Date.now().toString(36) + "-" + randomBytes(4).toString("hex")`。
  - `saveMessage` 用 `writeFileSync(filePath, line, { flag: "a", encoding: "utf-8" })`，无独立锁——多进程并发场景不在本期范围。
  - `loadSession` 跳过 `JSON.parse` 失败的行、跳过 `content` 为空字符串的行。
  - `rebuildFromSession` 从尾向头扫描，找到最后一个 `type === COMPACT_BOUNDARY`：命中则反序列化 payload，把 summary 包装成一段中文 user 消息（前缀"本次会话延续自之前的对话，因上下文空间不足进行了压缩……"，`keep` 非空时追加"近期消息已原样保留。"），随后 push `keep[]`，最后 push 边界之后的普通 user/assistant 行。未命中时按 role 过滤全量重放。
  - `listSessions` 按 `modTime` 倒序排列，每个文件单独 try/catch 隔离错误。
  - `cleanExpiredSessions` 用 `SESSION_EXPIRY_DAYS = 30` 作为 mtime 距今的阈值。
- 依赖：`node:fs`、`node:path`、`node:crypto.randomBytes`。

### `src/history/history.ts`

- 职责：用户在 TUI 输入的 prompt 文本以 JSONL 形式持久化到 `<workDir>/.bettercode/prompt_history.jsonl`，便于上下方向键回溯。
- 对外接口：`load(dir)`、`append(dir, text)`。
- 关键细节：
  - 加载时单行 `JSON.parse({ text })`，失败的行跳过；
  - 写入时全量读出去重最后相邻、追加新条目、超 `MAX_ENTRIES = 200` 截前，统一 `writeFileSync` 全量覆盖。

### `src/filehistory/filehistory.ts`

- 职责：Agent 每次工具触发的文件改动前后做快照，TUI `/rewind` 可回滚。
- 关键细节：
  - 备份目录 `<baseDir>/.bettercode/file-history/<sessionID>/`；备份文件名 `sha256(path).slice(0,16) + "@v<version>"`。
  - `trackEdit(path)` 自增版本号；文件不存在时只升版本不做备份（代表"快照时刻文件还不存在"）。
  - `makeSnapshot(msgIndex, userText)` 把当前所有 trackedFiles 的最新版本号封装成 `Snapshot`；超过 `MAX_SNAPSHOTS = 100` 时滑动丢弃头部。
  - `rewind(idx)` 用每个 backup 还原文件；备份缺失代表"快照时刻该文件不存在"，删除当前文件。回滚后截掉 `snapshots[idx+1..]`、把 `trackedFiles` 版本号回填到快照状态。

### `src/conversation/conversation.ts`（修改）

- 新增 `injectLongTermMemory(instructions, memories)`：用 `ltmInjected` 守门，把 `# bettercodeMd`、`# autoMemory`、`# currentDate` 三段拼成首条 `<system-reminder>` `history.unshift`。
- 新增 `replaceWithCompacted(summaryContent, keep)`：让压缩流程整体替换 history 为 `[summaryUserMsg, ...keep]`。

### `src/prompt/builder.ts`（修改）

- `BuildOptions` 新增两个可选字段；当 `customInstructions` 非空时在 `priority 95` 的 `CustomInstructions` 分区填入，`memorySection` 非空时在 `priority 100` 的 `Memory` 分区填入。两者均通过 `PromptBuilder.add({ name, priority, content })` 进入排序后的总输出。

### `src/agent/agent.ts`（修改）

- `AgentConfig` 暴露 `onLoopComplete?: (conv) => void`，在 `run()` 的 loop 自然结束分支调用一次（不抛错的纯回调）。
- TUI 在该回调里启动 `MemoryExtractor.extract`，把 conversation 的尾部 40 条切片为提取上下文。

### `src/tui/app.tsx`（关键集成点）

- `initClient` 阶段：
  - `const instructions = loadInstructions(workDir);`
  - `const memMgr = new MemoryManager(workDir); const memReminder = memMgr.buildSystemReminder();`
  - `convRef.current.injectLongTermMemory(instructions, memReminder);`
  - `convRef.current.addSystemReminder("IDENTITY OVERRIDE: ...");`
  - `setPromptHistory(historyMod.load(historyDir));`
  - `fileHistoryRef.current = new FileHistory(workDir, sessionIdRef.current);`
- 用户输入：`handleSubmit` 中 `historyMod.append(historyDir, text)`、`sessionMod.saveMessage(...)`、`convRef.current.addUserMessage(expandAtRefs(text, workDir))`。
- 流式回复：`runAgentLoop` 的 `loop_complete` 事件分支调 `sessionMod.saveMessage` 写入 assistant；`onLoopComplete` 回调驱动 `MemoryExtractor`。
- 压缩事件：`runAgentLoop` 收到 `compact` 事件后 `sessionMod.saveCompactBoundary(workDir, sessionId, event.boundary)`；TUI 的 `/compact` 命令直接调 `forceCompact` 后也走同一路径。
- `/resume`：在 `handleSlashCommand` 中 `case "resume"` 分支：不带参数 `sessionMod.listSessions` 列前 10；带参数 `sessionMod.loadSession + rebuildFromSession` 重建。

### `src/commands/commands.ts`（修改）

- 注册三个 `local_ui` 命令：`resume`（别名 `r`）、`memory`、`rewind`，处理函数返回一个字符串 token（"resume" / "memory" / "rewind"），由 `handleSlashCommand` 内 switch 派发到具体逻辑。

## 模块交互### 启动流程

```
main()
  ├─ loadConfig()
  ├─ render(<App providers mcpServers hooks />)
  └─ App.initClient(provider)
        ├─ buildSystemPrompt(env)
        ├─ createClient(provider, systemPrompt)
        ├─ new FileHistory(workDir, sessionId)
        ├─ instructions = loadInstructions(workDir)
        ├─ memReminder = new MemoryManager(workDir).buildSystemReminder()
        ├─ conv.injectLongTermMemory(instructions, memReminder)
        ├─ conv.addSystemReminder("IDENTITY OVERRIDE: ...")
        ├─ setPromptHistory(historyMod.load(historyDir))
        └─ ...（hooks、skills、MCP、teams 等已有装配）
```

### 写入 JSONL 时序

```
用户输入 "hello"
  → conv.addUserMessage(expandAtRefs("hello", workDir))
  → saveMessage(workDir, id, {role:"user", content:"hello", timestamp:"..."})
      → 追加 {"role":"user","content":"hello","timestamp":"..."} 到 <id>.jsonl

Agent 回复 "hi!"（loop_complete 事件）
  → conv.addAssistantMessage（由 Agent 内部维护）
  → saveMessage(workDir, id, {role:"assistant", content:"hi!", timestamp:"..."})
      → 追加 {"role":"assistant","content":"hi!","timestamp":"..."} 到 <id>.jsonl

压缩触发（Agent loop 内 manageContext 或用户 /compact）
  → forceCompact 返回 { compacted:true, boundary:{summary, keep[]} }
  → saveCompactBoundary(workDir, id, payload)
      → 追加 {"role":"system","content":"<payload JSON>","timestamp":"...","type":"compact_boundary"} 到 <id>.jsonl
```

### `/resume` 恢复流程

```
TUI 用户输入 "/resume"
  ├─ parseCommand → { name:"resume", args:"" }
  ├─ cmdRegistry.find("resume") → handler 返回 "resume"
  └─ App.handleSlashCommand case "resume":
        if (!args):
            sessions = listSessions(workDir)
            列出前 10 项作为 system 消息回显
        else:
            saved = loadSession(workDir, arg)
            if saved.length === 0: 系统消息"not found or empty"
            else:
                conv = new ConversationManager()
                conv.injectLongTermMemory(loadInstructions(workDir),
                                          new MemoryManager(workDir).buildSystemReminder())
                restored = rebuildFromSession(saved)
                for m of restored:
                    if m.role==="user" → conv.addUserMessage(m.content)
                    else               → conv.addAssistantMessage(m.content)
                convRef.current = conv
                sessionIdRef.current = arg
                taskListRef.current.useStore(new TaskStore(workDir, arg))
                追加 system 消息 "⟲ Resumed session <arg> (N messages)"
                committedIndexRef = resumedMessages.length
```

### `MemoryExtractor` 提取并发合并

```
loop_complete 事件 #1
  → onLoopComplete(conv) → extractor.extract(s1)
  → inProgress=true, 启动 LLM 调用 …

loop_complete 事件 #2 （前一次还在跑）
  → extractor.extract(s2)
  → 命中 inProgress=true → pendingContext=s2 → 立即返回 []

LLM #1 返回
  → doExtract 写文件、rebuildIndex
  → finally: pendingContext=s2 → runExtraction(s2) 自动执行尾部运行
```

## 文件组织

```text
src/
├── memory/
│   ├── instructions.ts   # loadInstructions、@include 展开、git root 路径发现
│   ├── manager.ts        # MemoryManager、rebuildIndex、findRelevantMemories
│   └── extractor.ts      # MemoryExtractor、合并并发、双路路由
├── session/
│   └── session.ts        # newSessionId、saveMessage、loadSession、rebuildFromSession、listSessions、cleanExpiredSessions、saveCompactBoundary
├── history/
│   └── history.ts        # prompt_history.jsonl 读写
├── filehistory/
│   └── filehistory.ts    # FileHistory、Snapshot、trackEdit、rewind
├── conversation/
│   └── conversation.ts   # injectLongTermMemory、replaceWithCompacted（修改）
├── prompt/
│   └── builder.ts        # customInstructions/memorySection 分区（修改）
├── agent/
│   └── agent.ts          # onLoopComplete 回调（修改）
├── commands/
│   └── commands.ts       # /resume、/memory、/rewind 注册（修改）
└── tui/
    └── app.tsx           # initClient 注入、handleSubmit 落盘、handleSlashCommand 调度（修改）
tests/
├── session.test.ts       # JSONL 读写、压缩边界重建、坏行跳过
└── memory.test.ts        # MemoryExtractor 解析与落盘
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 指令文件格式 | 手写 Markdown（BETTERCODE.md / AGENTS.md / BETTERCODE.local.md / INSTRUCTIONS.md） | 用户直接编辑、可纳入 git；多个候选文件名让不同项目能各自约定 |
| 指令发现策略 | git root → workDir 沿路径每层 + 用户全局 + 本地覆盖 | 与 monorepo 多层级配置兼容；越靠后的层级覆盖力越强 |
| @include 深度上限 | `MAX_INCLUDE_DEPTH = 5` | 覆盖正常的模块化需求，又能在误配时静默截断而非递归爆栈 |
| @include 行格式 | `@./`、`@../`、`@~/`、`@/` 四种前缀，行首匹配 | 利用 `@` 作为 sigil 与 Markdown 的常规链接区分；`@@` 转义、`@username` 跳过避免误识别 |
| Fenced code block 跳过 | 维护 `inCode` 切换 | 写 Markdown 时常常需要在代码块里展示 `@xxx` 字面量，避免误展开 |
| 会话存储格式 | JSONL 追加写 | 写入快、崩溃只丢最后一行、无需维护索引文件；`flag: "a"` 即可原子追加 |
| 压缩落盘 | 内联式 `compact_boundary` 记录（summary + keep 一同序列化） | 恢复时只读最后一个边界即可重建状态，避免"边界之后回头找 keep"的物理位置问题；与 `replaceWithCompacted` 在 conversation 层的语义对齐 |
| Session ID 格式 | `<base36 of Date.now()>-<8 hex>` | base36 天然按时间可排序、字符紧凑；8 hex 随机后缀防同毫秒碰撞 |
| 笔记类型 | 四类（user / feedback / project / reference） | 双路路由依据简单：project/reference 跟项目走、user/feedback 跨项目通用 |
| 索引重建时机 | 每次写入新笔记后立即 `rebuildIndex` | 索引始终新鲜；扫描+排序成本对 200 条以内可忽略 |
| 索引上限 | 200 行 / 25KB | 控制注入到 conversation 首条 system-reminder 的 token 占比 |
| 提取触发点 | `Agent.onLoopComplete` 回调 + TUI 的 `memCursorRef` 增量门槛 | 用最自然的"一轮完整结束"节奏触发；增量门槛防止短回复频繁触发 |
| 提取并发合并 | `inProgress` 标志 + `pendingContext` 暂存 | 多次连续 loop 抖动时只会做"当前一次 + 一次尾部"两次，不会无限堆积 |
| 提取请求工具集 | 空数组（`client.stream(conv, [])`） | 提取是纯文本输入/输出，不允许模型调工具，简化解析 |
| Conversation 长期记忆注入 | `injectLongTermMemory(instructions, memories)` + `ltmInjected` 守门 | 一次性写到首条 system-reminder；同一 `ConversationManager` 不重复注入；恢复会话时新建实例自然再次注入 |
| `/resume` 列表上限 | 前 10 条 | 命令行回显场景下 10 条足够辨识；超出走列目录直接看 |
| 命令派发 | `commands.ts` 注册 `local_ui` 类型 + handler 返回 token | 既能复用统一的命令注册管道，又把具体的 UI 状态变更集中在 `App.handleSlashCommand` 内，便于读 stream/state |

## 增量：记忆治理（MemoryGovernor）

### 架构概览

新增 `src/memory/governor.ts`，独立于提取器，专做记忆库的整理与淘汰。治理是"尽力而为"的后台动作：门控决定是否跑、一次 LLM 调用产出操作清单、代码校验后落盘执行、归档原文、重建索引并报告截断。

| 新增 | 模块 | 职责 |
|------|------|------|
| 新增 | `src/memory/governor.ts` | 门控（时间/扫描/会话/锁）、四阶段 prompt、操作解析与安全校验、执行（删除/合并/更新）、归档、索引修剪与超限提示 |
| 修改 | `src/chat/manager.ts` | 每轮自然完成后的后台任务里调用 `governor.maybeRun(provider)` |
| 修改 | `src/command/presenters.ts` | `/memory` 面板展示治理状态（可选） |

### 数据流

```
[AgentLoop onLoopComplete]
   └─ ChatManager.scheduleMemoryGovernance(provider)
         └─ governor.maybeRun(provider)
               ├─ 记忆目录存在?  → no → {ran:false}
               ├─ 距上次成功整理 < 24h?  → yes → {ran:false}   // 时间门
               ├─ 距上次尝试 < 10min?  → yes → {ran:false}     // 扫描节流
               ├─ sessions/*.jsonl 数 < 5? → yes → {ran:false}  // 会话门
               ├─ 获取 .governance.lock 失败? → yes → {ran:false} // 防并发
               ├─ 更新 lastAttemptAt → 后台 run(provider)
               │     ├─ 枚举全部记忆 → 构造四阶段 prompt
               │     ├─ LLM 输出 {"actions":[...]}
               │     ├─ 安全校验（排除 MEMORY.md/隐藏/未知文件）
               │     ├─ 归档 .archive/<ts>/*.md
               │     ├─ 执行 delete / merge / update / keep
               │     ├─ rebuildIndex() → 检查超限 → indexOverflow
               │     └─ 更新 lastGovernedAt / runCount
               └─ finally 释放锁
```

### 核心数据结构

```typescript
export interface MemoryGovernanceOptions {
  minIntervalMs?: number;    // 距上次成功整理最小间隔，默认 24h
  scanThrottleMs?: number;   // 距上次触发尝试的节流，默认 10min
  minSessionCount?: number;  // 会话门，默认 5
  lockTimeoutMs?: number;    // 锁过期，默认 30min
  maxCandidates?: number;    // 传给 LLM 的记忆上限，默认 60
}

export interface GovernancePlanAction {
  action: 'keep' | 'delete' | 'merge' | 'update';
  targets: string[];         // 被处理的文件名（不含 .md）
  into?: string;             // merge 的目标文件名
  description?: string;
  content?: string;          // merge/update 的新正文
  reason: string;
}

export interface GovernanceState {
  lastGovernedAt?: string;
  lastAttemptAt?: string;
  runCount: number;
  lastError?: string;
}

export interface GovernanceResult {
  ran: boolean;
  reason?: string;
  actions?: readonly GovernancePlanAction[];
  executed: { deleted: string[]; merged: string[]; updated: string[]; kept: string[] };
  ignored: number;
  archiveCount: number;
  indexOverflow?: { overflow: boolean; droppedNames: string[] };
}

export class MemoryGovernor {
  constructor(manager: MemoryManager, options?: MemoryGovernanceOptions);
  maybeRun(provider: LLMProvider): Promise<GovernanceResult>;
  run(provider: LLMProvider): Promise<GovernanceResult>;
  state(): GovernanceState;
}
```

### 模块设计

- **状态文件** `.bettercode/memory/.governance.json`（600）：`loadState` 解析失败回退空状态；`maybeRun` 先写 `lastAttemptAt`（保证节流生效），成功整理后写 `lastGovernedAt` / `runCount`。
- **治理锁** `.governance.lock`：`writeFileSync(path, data, { flag: 'wx' })`；`ENOENT` 目录不存在由上层门控挡住；`EEXIST` 读锁内容判断是否陈旧（超过 `lockTimeoutMs` 则删除重试一次）；任何其他异常都视为"获取失败"返回。
- **四阶段 prompt**：系统提示写明四个阶段与输出约束；用户消息把每篇记忆编码为 `[name] (type) mtime=<ISO> description=<desc> content=<前 5000 字符>`；候选超过 `maxCandidates` 时按 mtime 倒序取前 `maxCandidates`。
- **解析**：复用 `findRelevantMemories` 的 JSON 提取模式（`indexOf('{')` 到 `lastIndexOf('}')` → `JSON.parse`），失败静默返回空动作。
- **执行**：先按文件收集待归档集合（delete 目标、merge 源、update 目标）统一归档到 `.archive/<时间戳>/`；随后逐条执行，每步 try/catch 隔离；`merge` 写 `into`（作用域沿用 `targets[0]`）、删源；`update` 覆盖 `targets[0]`；`keep` 仅计数。
- **索引超限**：重建索引前按 `MAX_ENTRYPOINT_LINES / MAX_ENTRYPOINT_BYTES` 预计算排序后能收录的条数，超限的尾部记忆名进入 `droppedNames`。

### 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 触发接入点 | `ChatManager.scheduleMemoryGovernance`（onLoopComplete 后台任务） | 与记忆提取同生命周期、同门控模式，最贴合"积累会话→整理" |
| 门控顺序 | 目录 → 24h → 10min → 会话数 → 锁 | 先低成本条件、后高成本（锁文件）与 LLM 调用，尽早返回 |
| 治理执行 | 一次 LLM 调用 + 结构化 JSON 清单，代码校验后落盘 | 可单测、可控、失败可隔离；不引入子 Agent 异步黑盒 |
| 归档 | `.archive/<时间戳>/` 保留原文 | 治理可能误判，归档提供手动恢复 |
| 作用域保持 | merge/update 沿用源记忆作用域 | 不破坏 project/user 双路路由 |
| 索引超限提示 | 预计算 droppedNames 返回 | 让"静默截断"变成可见提示，用户可手动精简 |
