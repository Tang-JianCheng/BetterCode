# 项目记忆与会话持久化 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。命令以 bun 工具链为准。

## 实现完整性

- [ ] `src/memory/instructions.ts` 导出 `loadInstructions(workDir)`、`discoverInstructions(workDir)`、`InstructionSource`，常量 `MAX_INCLUDE_DEPTH = 5`。
- [ ] `src/memory/manager.ts` 导出 `MemoryManager`，方法包含 `loadAll / getMemories / buildSystemReminder / rebuildIndex / clear / findRelevantMemories`；常量 `MAX_ENTRYPOINT_LINES = 200`、`MAX_ENTRYPOINT_BYTES = 25_000`。
- [ ] `src/memory/extractor.ts` 导出 `MemoryExtractor`，`extract` 是 `Promise<string[]>`，内部含 `inProgress` 与 `pendingContext` 合并并发字段。
- [ ] `src/session/session.ts` 导出 `newSessionId / saveMessage / saveCompactBoundary / loadSession / rebuildFromSession / listSessions / cleanExpiredSessions / getSessionFilePath`，以及 `COMPACT_BOUNDARY` 常量与对应 interface。
- [ ] `src/history/history.ts` 导出 `load / append`，`MAX_ENTRIES = 200`。
- [ ] `src/filehistory/filehistory.ts` 导出 `FileHistory` 类与 `Snapshot / Backup` interface，`MAX_SNAPSHOTS = 100`。
- [ ] `src/conversation/conversation.ts` 新增 `injectLongTermMemory(instructions, memories)` 与 `replaceWithCompacted(summary, keep)`，`ltmInjected` 守门为 idempotent。
- [ ] `src/prompt/builder.ts` 的 `BuildOptions` 增加 `customInstructions` / `memorySection`；非空时分别加入 `CustomInstructions`（priority 95）和 `Memory`（priority 100）分区。
- [ ] `src/agent/agent.ts` 的 `AgentConfig` 增加 `onLoopComplete?: (conv) => void`，在 loop 自然结束分支调用且异常被捕获。
- [ ] `src/commands/commands.ts` 注册 `resume`（别名 `r`，`local_ui`）、`memory`（`local`）、`rewind`（`local_ui`）三条内置命令。

## 集成

- [ ] `src/tui/app.tsx` 在 `initClient` 中：`fileHistoryRef.current = new FileHistory(...)`、`loadInstructions(workDir)`、`new MemoryManager(workDir).buildSystemReminder()`、`convRef.current.injectLongTermMemory(...)`、`convRef.current.addSystemReminder("IDENTITY OVERRIDE: ...")`、`setPromptHistory(historyMod.load(historyDir))` 都被调用，且顺序保证记忆先于身份硬注入。
- [ ] `handleSubmit` 中 `historyMod.append(historyDir, text)` 与 `sessionMod.saveMessage(workDir, sessionIdRef.current, { role:"user", ... })` 在每条用户消息后都调用。
- [ ] `runAgentLoop` 的 `loop_complete` 事件分支调用 `sessionMod.saveMessage(workDir, sessionIdRef.current, { role:"assistant", content: fullText, timestamp: new Date().toISOString() })`。
- [ ] `runAgentLoop` 的 `compact` 事件分支在 `event.boundary` 非空时调用 `sessionMod.saveCompactBoundary(workDir, sessionIdRef.current, event.boundary)`。
- [ ] `new Agent({...})` 时传入的 `onLoopComplete` 回调中：互斥检查 `memExtractingRef.current`、增量门槛 `conv.len() - memCursorRef.current < 2`、取最近 40 条切片为 summary、调 `MemoryExtractor.extract` 异步运行、成功 `setMessages` 追加 `💾 Memory saved: ...` 提示。
- [ ] `handleSlashCommand` 的 `case "resume"`：无参数列前 10、带参数构造新 `ConversationManager` → `injectLongTermMemory` → `rebuildFromSession` → `addUserMessage` / `addAssistantMessage` 回放、切换 `convRef`、`sessionIdRef`、`taskListRef.current.useStore(...)`、追加 `⟲ Resumed session ...` 系统消息。

## 编译与测试

- [ ] `tsc --noEmit` 无错误（项目根执行 `bun run typecheck` 或直接 `tsc --noEmit`）。
- [ ] `bun test tests/session.test.ts` 全绿（含 `save/load round-trip`、`skips malformed and empty-content lines`、`labels a session by its first user message`、`rebuilds the compacted state from the last compact_boundary` 等用例）。
- [ ] `bun test tests/memory.test.ts` 全绿（含 `MemoryExtractor` 解析 + 双路落盘、`NONE` 静默两条用例）。
- [ ] `bun test` 全部测试通过，且未引入针对其他模块的回归（`tests/conversation.test.ts`、`tests/agent.test.ts`、`tests/compact.test.ts` 等保持绿色）。
- [ ] 启动 `bun run src/main.tsx` 正常进入 provider 选择 / 聊天界面，控制台无红色错误。

## 端到端场景

- [ ] 场景 1（首次冷启动）：删掉项目根 `BETTERCODE.md`、`.bettercode/memory/`、`~/.bettercode/memory/`，`bun run src/main.tsx`；TUI 正常出现 → 输入 "你好" → 模型回复 → `cat .bettercode/sessions/*.jsonl` 至少两行（user + assistant），每行 `bun -e "console.log(JSON.parse(...))"` 能解析；退出后 `.jsonl` 文件保留。
- [ ] 场景 2（项目指令生效）：在项目根创建 `BETTERCODE.md` 写"所有回复必须以「喵~」开头"，重启 → 输入"你好" → 模型回复以"喵~"开头；再在 `~/.bettercode/BETTERCODE.md` 写"回复使用英文"，重启 → 验证项目根指令优先级压过用户全局（注意：当前实现是越靠后越优先，本地覆盖 `BETTERCODE.local.md` 才是最强；按需手动测两层叠加效果）。
- [ ] 场景 3（@include 展开）：项目根 `BETTERCODE.md` 写 `@./rules/style.md`，`rules/style.md` 写"代码块必须带语言标记" → 启动 → 输入"写一个 hello world" → 模型输出的代码块带语言标记；`loadInstructions(workDir)` 的返回串中能找到 `<!-- included from ./rules/style.md -->`。
- [ ] 场景 4（@include 循环检测）：A 写 `@./B.md`、B 写 `@./A.md` → 启动后不死循环，B 中对 A 的第二次引用保持原 `@` 行。
- [ ] 场景 5（@include fenced code block 跳过）：BETTERCODE.md 中在 ` ``` ` 代码块里写 `@./not-real.md` → 该行原样出现在最终注入内容里，无文件读取错误。
- [ ] 场景 6（会话存档 + 工具调用）：输入"读取 package.json" → 模型调 ReadFileTool → 回复内容 → `.jsonl` 至少四行（user → assistant 回复 → ...）；最终 assistant 文本入库；`grep '"role":"user"' .bettercode/sessions/*.jsonl` 与 `grep '"role":"assistant"' .bettercode/sessions/*.jsonl` 各至少命中一次。
- [ ] 场景 7（`/resume` 列表）：进行两次会话各 `/exit`，重新启动 → `/resume`（不带参数）→ TUI 中出现 `Sessions (use /resume <id> to restore):` 前缀，列出两条带 firstMessage 的会话。
- [ ] 场景 8（`/resume <id>` 恢复）：`/resume <id>` 选其中一条 → TUI 回放历史消息、最后追加 `⟲ Resumed session <id> (N messages).`；之后输入新消息 → `wc -l .bettercode/sessions/<id>.jsonl` 行数比恢复前多。
- [ ] 场景 9（坏行容错）：手工在某 `.jsonl` 中间插入一行 `{ not valid json` 并保存 → 启动 → `/resume <id>` → 加载消息数 = 有效行数 - 1（坏行被跳过）。
- [ ] 场景 10（压缩边界 + 恢复）：配置一个偏小的 `context_window`（如 `BETTERCODE_BYPASS_PERMISSIONS=1 ... model: ...`，或代码中临时改），对话数轮触发自动压缩 → `grep '"type":"compact_boundary"' .bettercode/sessions/*.jsonl` 至少命中一次；退出并 `/resume <id>` → 首条恢复消息是中文 summary 包装（含"本次会话延续自之前的对话"），随后是 keep 与边界后增量。
- [ ] 场景 11（自动笔记触发）：输入"以后回复都用简体中文" → 等 2-3 秒（异步提取）→ `ls ~/.bettercode/memory/` 或 `ls .bettercode/memory/` 出现 `.md` 文件；TUI 出现 `💾 Memory saved: ...`；`cat .bettercode/memory/MEMORY.md` 中能找到该 `name` 摘要行。
- [ ] 场景 12（双路路由）：手工让对话产生 project 与 user 两类笔记 → `ls .bettercode/memory/` 包含 project 类、`ls ~/.bettercode/memory/` 包含 user 类。
- [ ] 场景 13（提取合并并发）：连续快速发两条短消息，使两轮 loop 几乎相邻完成 → `MemoryExtractor` 只发起两次 LLM 调用（不会因为抖动堆出 3+ 次）；可用 console.log 临时插桩验证 `inProgress`、`pendingContext` 切换。
- [ ] 场景 14（索引重建）：手工往 `.bettercode/memory/` 与 `~/.bettercode/memory/` 各放两条 `.md`（带顶层 `name / description / type` frontmatter）→ 程序内调用 `new MemoryManager(workDir).rebuildIndex()` 后 `cat .bettercode/memory/MEMORY.md` 含四行 `- [name](relPath) — description`，按 name 大小写不敏感字母序排列。
- [ ] 场景 15（过期清理）：手工执行 `touch -d "31 days ago" .bettercode/sessions/old.jsonl` → 启动 BetterCode → 后台 `cleanExpiredSessions` 跑完后 `ls .bettercode/sessions/` 不再含 `old.jsonl`；同时刚创建的 sessionId `.jsonl` 仍存在。
- [ ] 场景 16（prompt 历史）：在 TUI 输入框按方向键上下 → 能回溯到上一次启动时输入过的命令；`cat .bettercode/prompt_history.jsonl` 每行是 `{"text":"..."}`，最多 200 行。
- [ ] 场景 17（FileHistory 回滚）：让 Agent 修改一个文件 → `/rewind` → 选最早 snapshot → "Restore code and conversation" → 文件内容被回滚、`conv.truncateTo` 把 conversation 截短、TUI 出现 `⟲ Rewound to checkpoint. Restored N file(s)...`。
- [ ] 场景 18（身份硬注入）：在 conversation 首条 system-reminder 后还能看到第二条独立的 `IDENTITY OVERRIDE: 你是 BetterCode...` system-reminder（确保身份覆盖即使在长期记忆段之后也独立存在）。

## 增量：记忆治理

- [x] `src/memory/governor.ts` 导出 `MemoryGovernor`，含 `maybeRun / run / state / checkIndexOverflow`；`MemoryGovernanceOptions` 常量默认 24h / 10min / 5 会话 / 30min 锁。
- [x] 门控顺序正确：目录不存在、距上次整理 < 24h、距上次尝试 < 10min、会话数 < 5、锁占用时 `maybeRun` 均返回 `{ran:false}` 且不调 LLM。
- [x] `.governance.json` 状态持久化：`lastAttemptAt` 每次触发更新、`lastGovernedAt`/`runCount` 成功整理后更新；解析失败回退空状态。
- [x] 治理锁：`flag:'wx'` 排他创建；陈旧锁（>30min）删除重试；获取失败静默返回。
- [x] 四阶段 prompt + JSON 清单解析：只取首个 `{}`，解析失败整轮静默。
- [x] 安全校验：`targets` 排除 `MEMORY.md` / 隐藏 / 未知文件；`merge` 需 `into`+`content`、`update` 需 `content` 且单目标；非法操作忽略并计数。
- [x] 执行正确：`delete` 删目标、`merge` 写 `into`（沿用源作用域）删源、`update` 覆盖目标、`keep` 计数；被处理文件原文先归档到 `.archive/<ts>/`。
- [x] 索引超限提示：超 200 行 / 25KB 时结果携带 `indexOverflow` 与被截断名单。
- [x] `ChatManager.scheduleMemoryGovernance`：onLoopComplete 后台任务调 `maybeRun(provider)`，失败静默；默认会话数 < 5 时不新增 LLM 调用。
- [x] `/memory` 面板展示治理状态（上次整理 / 整理次数 / 索引截断提示）。
- [x] `pnpm check`（602 通过，1 项为既有基线失败）、`git diff --check` 干净。
