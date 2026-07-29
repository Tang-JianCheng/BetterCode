# 项目记忆与会话持久化 Tasks

> 所有模块在 `src/` 下，运行时为 bun + TypeScript 5.x；新建文件均以 `.ts` 后缀；测试位于 `tests/` 下、以 `*.test.ts` 命名。

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/memory/instructions.ts` | `loadInstructions`、`discoverInstructions`、`@include` 展开、git root 路径发现 |
| 新建 | `src/memory/manager.ts` | `MemoryManager`、`buildSystemReminder`、`rebuildIndex`、`findRelevantMemories`、`parseFrontmatter` |
| 新建 | `src/memory/extractor.ts` | `MemoryExtractor`、`extract`、合并并发 |
| 新建 | `src/session/session.ts` | `newSessionId`、`saveMessage`、`saveCompactBoundary`、`loadSession`、`rebuildFromSession`、`listSessions`、`cleanExpiredSessions` |
| 新建 | `src/history/history.ts` | `load`、`append`（prompt_history.jsonl 读写） |
| 新建 | `src/filehistory/filehistory.ts` | `FileHistory`、`trackEdit`、`makeSnapshot`、`rewind` |
| 修改 | `src/conversation/conversation.ts` | 新增 `injectLongTermMemory`、`replaceWithCompacted` |
| 修改 | `src/prompt/builder.ts` | `BuildOptions` 新增 `customInstructions` / `memorySection` |
| 修改 | `src/agent/agent.ts` | `AgentConfig.onLoopComplete` 钩子 |
| 修改 | `src/commands/commands.ts` | 注册 `/resume`、`/memory`、`/rewind` |
| 修改 | `src/tui/app.tsx` | `initClient` 注入指令和记忆、`handleSubmit` 写 JSONL、`handleSlashCommand` 派发 resume/rewind、`runAgentLoop` 持久化 boundary、`onLoopComplete` 驱动 `MemoryExtractor` |
| 新建 | `tests/session.test.ts` | save/load 往返、坏行跳过、`rebuildFromSession` 边界重建 |
| 新建 | `tests/memory.test.ts` | `MemoryExtractor` 解析与双路落盘、`NONE` 静默 |

## T1: Session JSONL 基础读写**文件：** `src/session/session.ts`
**依赖：** 无
**步骤：**
1. 定义 `SessionMessage` / `KeptMessage` / `CompactBoundaryPayload` / `SessionInfo` / `RestoredMessage` interfaces；导出 `COMPACT_BOUNDARY = "compact_boundary"` 常量。
2. 实现 `sessionsDir(workDir)` 返回 `<workDir>/.bettercode/sessions`；`getSessionFilePath(workDir, sessionId)` 返回 `<sessionsDir>/<sessionId>.jsonl`。
3. 实现 `newSessionId()`：`Date.now().toString(36) + "-" + randomBytes(4).toString("hex")`。
4. 实现 `saveMessage(workDir, sessionId, msg)`：`mkdirSync({ recursive: true })` 后 `writeFileSync(filePath, JSON.stringify(msg) + "\n", { flag: "a", encoding: "utf-8" })`。
5. 实现 `saveCompactBoundary(workDir, sessionId, payload)`：调用 `saveMessage` 写一条 `role:"system"`、`type: COMPACT_BOUNDARY`、`content: JSON.stringify(payload)`、`timestamp: new Date().toISOString()` 的记录。
6. 实现 `loadSession(workDir, sessionId)`：逐行 `JSON.parse`，跳过失败的行；跳过 `m.content` 为空字符串的普通消息（边界记录因 content 含 payload JSON 字符串而非空，自动保留）。

**验证：** `tsc --noEmit` 通过；`bun test tests/session.test.ts` 中 round-trip 与坏行测试通过。

## T2: Session 列表与压缩重建**文件：** `src/session/session.ts`（同 T1 文件）
**依赖：** T1
**步骤：**
1. 实现 `listSessions(workDir)`：扫描 `.jsonl`、对每个文件统计 `messageCount`、提取第一条 `role === "user"` 且 content 非空消息的前 100 字符为 `firstMessage`、`statSync` 拿 size 和 mtime；按 `modTime` 倒序返回。
2. 实现 `rebuildFromSession(saved)`：
   - 反向扫描找最后一条 `type === COMPACT_BOUNDARY`。
   - 命中：`JSON.parse` payload；首条 push `{role:"user", content: "本次会话延续自之前的对话，因上下文空间不足进行了压缩。以下是早期对话的摘要：\n\n" + payload.summary + (payload.keep.length>0 ? "\n\n近期消息已原样保留。" : "")}`；随后 push `payload.keep` 中 role 为 user/assistant 的项；最后逐条 push 边界之后的普通 user/assistant 消息。
   - 未命中：全量过滤 push role/content 非空的 user/assistant 消息。
3. 实现 `cleanExpiredSessions(workDir)`：遍历 `.jsonl`，对 `mtimeMs` 距今超过 `SESSION_EXPIRY_DAYS = 30` 天的执行 `unlinkSync`；统计删除数返回；单文件失败静默跳过。

**验证：** `bun test tests/session.test.ts` 中 `listSessions` 与 `rebuildFromSession` 两组用例通过。

## T3: 项目指令加载器**文件：** `src/memory/instructions.ts`
**依赖：** 无
**步骤：**
1. 常量 `MAX_INCLUDE_DEPTH = 5`；导出 `InstructionSource` interface。
2. 实现 `findGitRoot(start)` 向上找 `.git` 目录；`projectInstructionDirs(workDir)` 返回 git root → workDir 路径上的目录列表，无 git root 时回退 `[workDir]`。
3. 实现 `discoverInstructions(workDir)`：按顺序对 `~/.bettercode/BETTERCODE.md`、`~/.bettercode/AGENTS.md`、每个项目目录的 `BETTERCODE.md` / `AGENTS.md`、`<workDir>/.bettercode/INSTRUCTIONS.md`、`<workDir>/BETTERCODE.local.md` 调 `addSource`。
4. 实现 `addSource(out, seen, filePath)`：`resolve` 绝对路径、`existsSync` 判断、`readFileSync` 读取；加入 `seen` 后 `expandIncludes(data, dirname(abs), seen, 0)`。
5. 实现 `expandIncludes(content, baseDir, seen, depth)`：`depth > MAX_INCLUDE_DEPTH` 时返回原文；维护 `inCode` 跳过 fenced code block；对 `parseInclude(trimmed)` 返回非空的行 `resolveInclude(p, baseDir)` 得绝对路径、检查 `seen` 避免循环，命中后插入 `<!-- included from <originalPath> -->` 注释，再递归展开被引用内容。
6. 实现 `parseInclude(trimmed)`：以 `@` 开头但不是 `@@`，无空白，且 `slice(1)` 以 `./` / `../` / `~/` / `/` 开头时返回路径，否则返回 `""`。
7. 实现 `resolveInclude(p, baseDir)`：`~/` 替换为 `homedir()` 拼接、绝对路径直接返回、相对路径 `join(baseDir, p)`。
8. 实现 `loadInstructions(workDir)`：调 `discoverInstructions`，每条用 `Contents of <相对路径或绝对路径>:\n\n<content 去除尾部换行>` 包装，多条用 `\n\n---\n\n` 连接。

**验证：** `tsc --noEmit` 通过。手动验证：
- 在 git root 放 `BETTERCODE.md` 写 `@./sub/rules.md`，`sub/rules.md` 写 "rule body" → `loadInstructions(workDir)` 输出含 `<!-- included from ./sub/rules.md -->` 与 `rule body`。
- 在 ` ``` ` 块内写 `@./x.md` → 该行原样保留。
- 构造 A→B→A 循环 → 第二次引用保留原 `@` 行。

## T4: 记忆笔记管理器**文件：** `src/memory/manager.ts`
**依赖：** 无
**步骤：**
1. 常量 `MAX_ENTRYPOINT_LINES = 200`、`MAX_ENTRYPOINT_BYTES = 25_000`、`MEMORY_INDEX_NAME = "MEMORY.md"`；定义 `MemoryFile`、`MemoryHeader`、`RelevantMemory` interface。
2. 实现 `parseFrontmatter(content)`：以 `---` 开头时找下一个 `---` 截取 YAML、`yaml.load` 解析；优先读顶层 `type`、回退 `metadata.type`；返回 `{ name?, description?, type?, body }`。
3. `MemoryManager` 构造函数：`userDir = ~/.bettercode/memory`、`projectDir = <workDir>/.bettercode/memory`。
4. 实现 `loadAll()`：遍历 `[userDir, projectDir]`，每个目录列 `.md`（排除 `MEMORY.md`），读 frontmatter，组装 `MemoryFile`；末尾调一次 `rebuildIndex`。
5. 实现 `getMemories()` 直接转调 `loadAll()`。
6. 实现 `buildSystemReminder()`：拿 `loadAll()`，空则返回 `""`；否则每条 `- [<name>] (<type>): <description>`，统一前缀 `"Active memories:\n"`。
7. 实现 `rebuildIndex()`：扫两级目录、按 `name` 大小写不敏感字母序排序、生成 `- [<name>](<relPath>) — <description>` 行；先按行截断到 `MAX_ENTRYPOINT_LINES`，再按 `Buffer.byteLength` 截断到 `MAX_ENTRYPOINT_BYTES` 最近换行；`mkdirSync(projectDir)` 后 `writeFileSync(MEMORY.md)`。
8. 实现 `clear()` 删除两级目录里的所有 `.md`。
9. 实现 `scanMemoryHeaders(dir, scope)` 与 `formatMemoryManifest(memories)` 辅助函数；前者按 mtime 倒序排，封顶 `MAX_ENTRYPOINT_LINES` 个。
10. 实现 `findRelevantMemories(query, client, recentTools, alreadySurfaced)`：收集两级 headers、过滤 `alreadySurfaced`、`formatMemoryManifest` 构造文本、用 `new ConversationManager()` 包含 selector system prompt 与 manifest 调 `client.stream(conv, [])`、累积返回文本、`extractJSONObject` 提取第一个 `{}` 后 `JSON.parse`、按 `selected_memories` 名字映射回 headers 返回 `RelevantMemory[]`。

**验证：** `tsc --noEmit` 通过；手动用 `MemoryManager.rebuildIndex` 写两条笔记后检查 `MEMORY.md` 输出按字母序、含相对路径。

## T5: 后台记忆提取**文件：** `src/memory/extractor.ts`
**依赖：** T4
**步骤：**
1. 类成员：`private client`、`private workDir`、`private inProgress = false`、`private pendingContext: string | null = null`。
2. `extract(conversationSummary)`：若 `inProgress`，写 `pendingContext = conversationSummary` 立即返回 `[]`；否则进入 `runExtraction`。
3. `runExtraction(conversationSummary)`：置 `inProgress = true`；`try { result = await doExtract(...) } finally { inProgress=false; const pending=this.pendingContext; this.pendingContext=null; if (pending!==null) { const trailing = await this.runExtraction(pending); result = [...result, ...trailing]; } }`；返回 `result`。
4. `doExtract`：构造 `ConversationManager`，往里 `addUserMessage` 一段固定 prompt（要求模型按 `MEMORY_NAME: ... MEMORY_TYPE: ... MEMORY_DESC: ... MEMORY_BODY: ... ---` 多块输出，无内容时回 `NONE`），后跟会话摘要。`client.stream(conv, [])` 收集全部 `text_delta` 拼成 `response`。若 trimmed === `"NONE"` 或 `!response.includes("MEMORY_NAME:")` 返回 `[]`。
5. 解析：`response.split("---").filter(b => b.includes("MEMORY_NAME:"))`，对每块 `extractField(block, "MEMORY_NAME" | "MEMORY_TYPE" | "MEMORY_DESC" | "MEMORY_BODY")`；缺 name 或 body 跳过；否则 `type === "project" || type === "reference"` 写 `<workDir>/.bettercode/memory/<name>.md`，否则写 `~/.bettercode/memory/<name>.md`；frontmatter 顶层 `name / description / type`，正文 `body + "\n"`。
6. 全部块写完后若 `saved.length > 0`，`new MemoryManager(workDir).rebuildIndex()` 同步索引；返回 `saved`。

**验证：** `bun test tests/memory.test.ts` 通过 `MockClient` 用例（project + reference 路由到 workDir，NONE 返回空）。

## T6: prompt_history 与 FileHistory**文件：** `src/history/history.ts`、`src/filehistory/filehistory.ts`
**依赖：** 无
**步骤：**

`history.ts`：
1. 常量 `MAX_ENTRIES = 200`、`FILENAME = "prompt_history.jsonl"`。
2. `load(dir)`：`existsSync` 判断、按 `\n` split、对每行 `JSON.parse({text})` 失败时跳过，返回 `text` 数组。
3. `append(dir, text)`：先 `mkdirSync`，加载已有条目，若与最后一条相同则不写；否则 push，超 `MAX_ENTRIES` 时从头 shift；最后 `writeFileSync(filePath, lines.map(t => JSON.stringify({text: t})).join("\n") + "\n", "utf-8")` 全量覆盖。

`filehistory.ts`：
1. 常量 `MAX_SNAPSHOTS = 100`；定义 `Backup`、`Snapshot` interface。
2. `backupName(filePath, version)`：`sha256(filePath).slice(0,16) + "@v<version>"`。
3. 构造函数：`sessionDir = <baseDir>/.bettercode/file-history/<sessionID>`，`mkdirSync({ recursive: true })`。
4. `trackEdit(path)`：取版本、`+1`；文件存在时 `readFileSync` 后 `writeFileSync(join(sessionDir, backupName))`；版本号写回 `trackedFiles` Map。
5. `makeSnapshot(msgIndex, userText)`：label 超 60 字符加省略号；遍历 `trackedFiles` 构造 `backups` Record，缺备份但当前文件存在时补写一次；push 新 `Snapshot`；超 `MAX_SNAPSHOTS` 时切尾保留最新 100。
6. `rewind(snapshotIndex)`：遍历目标 snapshot 的 `backups`：备份缺失 → 当前文件存在则 `unlinkSync`；备份存在则 `readFileSync` 比对 → 不同则 `writeFileSync`；记录 changed 路径。回滚后 `snapshots = snapshots.slice(0, snapshotIndex+1)` 并把 `trackedFiles` 版本号回填到 snapshot 状态；返回 changed 数组。
7. `getSnapshots / hasSnapshots / save` 直接实现。

**验证：** `tsc --noEmit` 通过；快速本地脚本验证 trackEdit→makeSnapshot→rewind 能恢复内容。

## T7: Conversation 注入与压缩替换**文件：** `src/conversation/conversation.ts`
**依赖：** 无
**步骤：**
1. 类新增 `private ltmInjected = false`。
2. 实现 `injectLongTermMemory(instructions, memories)`：若 `ltmInjected` 直接返回；否则按 `# bettercodeMd` / `# autoMemory` / `# currentDate` 三段非空拼成 body，外面再包 `<system-reminder>\nAs you answer ... IMPORTANT: this context may or may not be relevant ...\n</system-reminder>`；通过 `this.history.unshift({role:"user", content:wrapped})` 写到首条；置 `ltmInjected=true`。当三段都为空时直接返回不写入。
3. 实现 `replaceWithCompacted(summaryContent, keep)`：`this.history = [{role:"user", content:summaryContent}, ...keep]`。
4. 已有的 `addUserMessage` 等不动。

**验证：** `tsc --noEmit` 通过；快速验证：连续两次 `injectLongTermMemory("x","y")` 后 `history[0]` 仅出现一次。

## T8: buildSystemPrompt 选项扩展**文件：** `src/prompt/builder.ts`
**依赖：** 无
**步骤：**
1. `BuildOptions` 新增 `customInstructions?: string;` 与 `memorySection?: string;` 字段。
2. 在 `buildSystemPrompt(env, opts = {})` 中，`skillSection` 装配后追加：
   - `opts.customInstructions` 非空 → `b.add({ name: "CustomInstructions", priority: 95, content: opts.customInstructions })`
   - `opts.memorySection` 非空 → `b.add({ name: "Memory", priority: 100, content: opts.memorySection })`
3. 不破坏现有调用——TUI 不传时两段都为空，输出与之前一致。

**验证：** `tsc --noEmit` 通过；现有 `tests/agent.test.ts`、`tests/conversation.test.ts` 等通过。

## T9: Agent.onLoopComplete 钩子**文件：** `src/agent/agent.ts`
**依赖：** 无
**步骤：**
1. `AgentConfig` 新增 `onLoopComplete?: (conversation: ConversationManager) => void;`。
2. 私有字段 `private onLoopComplete?: ...`，构造函数赋值。
3. 在 `run()` 内的 loop 自然结束分支（模型无工具调用、`stopReason === "end_turn"`、`looping = false`）末尾调用 `this.onLoopComplete?.(this.conversation)`；包在 `try { ... } catch { /* swallow */ }` 内，确保回调异常不影响 stream 完结。

**验证：** `tsc --noEmit` 通过；现有 `tests/agent.test.ts` 通过；新增冒烟：用 mock client 跑一次 `agent.run()`，回调被触发一次。

## T10: commands 注册 resume / memory / rewind**文件：** `src/commands/commands.ts`
**依赖：** 无
**步骤：**
1. `createDefaultRegistry()` 中 `registry.register` 三条：
   - `{ name: "resume", aliases: ["r"], type: "local_ui", description: "Resume a previous session", handler: () => "resume" }`
   - `{ name: "memory", aliases: [], type: "local", description: "Show memory status", handler: () => "memory" }`
   - `{ name: "rewind", aliases: [], type: "local_ui", description: "Rewind to a checkpoint", handler: () => "rewind" }`

**验证：** `tsc --noEmit` 通过；`tests/command-loader.test.ts` 不报错。

## T11: TUI 集成（initClient + handleSubmit）**文件：** `src/tui/app.tsx`
**依赖：** T1、T3、T4、T6、T7
**步骤：**
1. 顶部 import 补齐：
   ```typescript
   import { loadInstructions } from "../memory/instructions.js";
   import { MemoryManager } from "../memory/manager.js";
   import { MemoryExtractor } from "../memory/extractor.js";
   import * as sessionMod from "../session/session.js";
   import * as historyMod from "../history/history.js";
   import { FileHistory } from "../filehistory/filehistory.js";
   ```
2. 组件内新增 refs：
   ```typescript
   const sessionIdRef = useRef(sessionMod.newSessionId());
   const fileHistoryRef = useRef<FileHistory | null>(null);
   const memCursorRef = useRef(0);
   const memExtractingRef = useRef(false);
   const [promptHistory, setPromptHistory] = useState<string[]>([]);
   ```
3. `initClient(provider)` 在 `createClient` 与 hooks 装配之间插入：
   - `fileHistoryRef.current = new FileHistory(workDir, sessionIdRef.current);`
   - `const instructions = loadInstructions(workDir);`
   - `const memMgr = new MemoryManager(workDir);`
   - `const memReminder = memMgr.buildSystemReminder();`
   - `convRef.current.injectLongTermMemory(instructions, memReminder);`
   - `convRef.current.addSystemReminder("IDENTITY OVERRIDE: ...");`（保留已有身份硬注入）
   - `setPromptHistory(historyMod.load(historyDir));`
4. `handleSubmit(text)` 入口先 `historyMod.append(historyDir, text)`、`setPromptHistory(prev => [...prev, text])`；slash command 未命中时 `convRef.current.addUserMessage(expandAtRefs(text, workDir))` 之后 `sessionMod.saveMessage(workDir, sessionIdRef.current, { role:"user", content:text, timestamp:new Date().toISOString() })`。
5. `runAgentLoop` 内 `loop_complete` 事件分支：若 `fullText` 非空 → `sessionMod.saveMessage(workDir, sessionIdRef.current, { role:"assistant", content:fullText, timestamp:new Date().toISOString() })`。
6. `runAgentLoop` 内 `compact` 事件分支：若 `event.boundary` 存在 → `sessionMod.saveCompactBoundary(workDir, sessionIdRef.current, event.boundary)`；并在 TUI 上追加 `⊙ <message>` 系统消息。

**验证：** `tsc --noEmit` 通过；启动 BetterCode，对话一轮，`cat .bettercode/sessions/*.jsonl` 看到至少两行。

## T12: TUI 集成（onLoopComplete 驱动 MemoryExtractor）**文件：** `src/tui/app.tsx`
**依赖：** T5、T9、T11
**步骤：**
1. 在 `runAgentLoop` 构造 `new Agent({...})` 时，传入 `onLoopComplete: (conv) => { ... }` 回调：
   - `if (!clientRef.current || memExtractingRef.current) return;`
   - `if (conv.len() - memCursorRef.current < 2) return;`
   - 拿 `slice(-40)` 中每条 `[role]: content` 拼成 `summary`，过滤掉长度小于 12 的行；
   - 置 `memExtractingRef.current = true`、记录 `cursor = conv.len()`；
   - `new MemoryExtractor(clientRef.current, workDir).extract(summary).then(saved => { memCursorRef.current = cursor; if (saved.length > 0) setMessages(prev => [...prev, { role:"system", content: `💾 Memory saved: ${saved.join(", ")}` }]); }).catch(() => {}).finally(() => { memExtractingRef.current = false; });`

**验证：** `tsc --noEmit` 通过；冒烟：在 BetterCode 中说一句"记住简体中文回复"，等 2-3 秒后 `ls .bettercode/memory/` 或 `~/.bettercode/memory/` 出现新文件，TUI 看到 `💾 Memory saved: <name>` 提示。

## T13: TUI 集成（/resume 派发）**文件：** `src/tui/app.tsx`
**依赖：** T2、T10、T11
**步骤：**
1. `handleSlashCommand(text)` 中查到 `cmd` 后，在 `cmd.type === "local_ui"` 的 switch 分支增加 `case "resume": { ... }`：
   - `const arg = parsed.args.trim();`
   - 若 `arg` 为空：`const sessions = sessionMod.listSessions(workDir);` 若 `sessions.length === 0` 推送 `"No sessions found."` 系统消息；否则取前 10 条拼成 `  <id> (<n> msgs) — <firstMessage>` 列表，推送 `"Sessions (use /resume <id> to restore):\n<list>"` 系统消息。
   - 若 `arg` 非空：`const saved = sessionMod.loadSession(workDir, arg);` 空则推送 `"Session \"<arg>\" not found or empty."`；否则：
     - `const conv = new ConversationManager();`
     - `conv.injectLongTermMemory(loadInstructions(workDir), new MemoryManager(workDir).buildSystemReminder());`
     - `const restored = sessionMod.rebuildFromSession(saved);`
     - 遍历 `restored`：`m.role === "user" ? conv.addUserMessage(m.content) : conv.addAssistantMessage(m.content)`。
     - `convRef.current = conv; sessionIdRef.current = arg; taskListRef.current.useStore(new TaskStore(workDir, arg));`
     - `const resumedMessages: ChatMessage[] = [...restored, { role:"system", content: `⟲ Resumed session ${arg} (${restored.length} messages).` }];`
     - `committedIndexRef.current = resumedMessages.length; setMessages(resumedMessages);`

**验证：** 启动 BetterCode → 对话两轮 → `/exit` → 重新启动 → `/resume` 列表中能看到上次的 session id → `/resume <id>` → 旧消息被重放、`⟲ Resumed session ...` 系统消息出现 → 再输入一条消息，`wc -l` 旧 `.jsonl` 行数递增。

## T14: TUI 集成（/rewind 与 FileHistory）**文件：** `src/tui/app.tsx`、`src/tui/rewind-dialog.tsx`
**依赖：** T6、T10、T11
**步骤：**
1. `handleSlashCommand` 的 `case "rewind"`：若 `fileHistoryRef.current` 无快照 → 推送 "No checkpoints to rewind to."；否则 `setRewindSnapshots(fh.getSnapshots())` + `setRewindDialogActive(true)`。
2. 新建 `RewindDialog` 组件：上下键选 snapshot、enter 进入 phase 1 选 "restore code+conv" / "conv only" / "code only" / "never mind"，回调把 `RewindAction` 报给 `App.handleRewindAction`。
3. `handleRewindAction` 根据 action 类型调 `fh.rewind(idx)` 与/或 `convRef.current.truncateTo(snap.messageIndex)`，并把改动文件清单作为系统消息回显。

**验证：** `tsc --noEmit` 通过；本地跑一次完整流程：让 Agent 编辑文件 → `/rewind` → 选最早 snapshot → 文件被还原。

## T15: 测试**文件：** `tests/session.test.ts`、`tests/memory.test.ts`
**依赖：** T1、T2、T5
**步骤：**

`tests/session.test.ts`：
1. `session save/load round-trip` → save 两条 (user/assistant) → `loadSession` 返回正确数量与内容。
2. `skips malformed and empty-content lines` → 手工写一行 `{ not valid json`、一行 `content: ""` 的 JSON、两行正常 → 只返回有效消息。
3. `labels a session by its first user message` → 先 save system 再 save user → `listSessions` 的 `firstMessage` 是 user 的内容。
4. `rebuilds the compacted state from the last compact_boundary` → save 3 条原始消息 → `saveCompactBoundary({summary, keep:[user, assistant]})` → save 2 条边界后消息 → `rebuildFromSession` 输出首条是中文 summary 包装、然后 keep、然后 post-boundary。
5. `replays everything when no boundary present` → save 多条 → 全量回放。

`tests/memory.test.ts`：
1. 用 `MockClient` 注入 `text_delta` 文本含两个 MEMORY 块（project + reference）→ `extract` 返回两个 name，对应 `<workDir>/.bettercode/memory/<name>.md` 存在、frontmatter 顶层正确。
2. `MockClient` 返回 `NONE` → `extract` 返回 `[]`，目录不变。

**验证：** `bun test tests/session.test.ts tests/memory.test.ts` 全绿。

## T16: 启动清理**文件：** `src/tui/app.tsx`
**依赖：** T2、T11
**步骤：**
1. 在 `initClient` 内部启动一个 `Promise.resolve().then(() => sessionMod.cleanExpiredSessions(workDir)).catch(() => {})`，让 30 天以上未修改的 `.jsonl` 在后台被清理；不阻塞 init 流程。
2. 失败静默吞掉（`sessionMod.cleanExpiredSessions` 自己已 best-effort，这里只是不挂起 init）。

**验证：** 手动创建一个 mtime 设置为 31 天前的 `.jsonl`（`touch -d "31 days ago"`），启动 BetterCode → `ls .bettercode/sessions/` → 该文件被删。

## 执行顺序

```text
T1 (Session JSONL 基础) ─────┐
T3 (项目指令加载)     ───────┤
T4 (笔记管理器)       ───────┤── 独立基础模块，可并行
T6 (history + filehistory) ─┤
T7 (Conversation 注入)─────┤
T8 (prompt 选项)      ──────┤
T9 (Agent onLoopComplete) ──┤
T10 (commands 注册)   ──────┘

T2 (Session 列表 + 重建) ── 依赖 T1
T5 (MemoryExtractor)     ── 依赖 T4
T11 (TUI initClient + handleSubmit) ── 依赖 T1/T3/T4/T6/T7
T12 (TUI onLoopComplete 驱动提取)    ── 依赖 T5/T9/T11
T13 (TUI /resume 派发)              ── 依赖 T2/T10/T11
T14 (TUI /rewind + FileHistory)     ── 依赖 T6/T10/T11
T15 (测试)                           ── 依赖 T1/T2/T5
T16 (启动清理)                       ── 依赖 T2/T11
```
