# BetterCode 运行过程图解

> 基于 `src/` 实际实现整理的架构与单次对话时序图，供快速理解整体运行链路。

## 一、整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 入口 src/index.tsx                                                          │
│   render(<App/>) ──── 全局异常/未处理Promise → .bettercode/logs/            │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                 │ createApplication()
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 装配层 src/bootstrap/application.ts                                         │
│   loadConfig(config.yaml) ──${ENV}展开──► provider 解析(cc-switch 导入)      │
│   ├─ ToolRegistry        核心6工具 + AgentTool + MCP工具 + 团队工具          │
│   ├─ SkillManager        skills/ 两阶段加载                                  │
│   ├─ AgentDefinitionManager  agents/ 角色定义                               │
│   ├─ PermissionManager   strict/default/allow + 规则 + 沙箱                 │
│   ├─ WorktreeManager     worktrees/ 隔离 + 清理调度                          │
│   ├─ TeamCoordinator     团队 + 后端(iTerm2/tmux/协程)                       │
│   ├─ HookManager         hooks.yaml → 编译 → 运行期事件分发                  │
│   ├─ MemoryManager       memory/ 提取与恢复                                  │
│   ├─ MemoryGovernor      memory/ 后台治理(去重合并/过期清理/矛盾解决)          │
│   └─ ChatManager         对话中枢(持 AgentLoop)                             │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ UI 层 src/ui/app.tsx                                                        │
│   StartupBrand → MessageList(历史/流式)                                     │
│   InputBox(raw解析:粘贴/光标/Shift+Enter) → onSubmit → dispatch             │
│   /statusline 状态行  ·  /context 网格  ·  工具轨迹折叠  ·  权限/会话/模型面板 │
└───────────────────────────────┬─────────────────────────────────────────────┘
```

## 二、单次对话的完整时序

```
 用户输入 "帮我写个函数"
   │
   ▼ InputBox
 键盘事件(RawInputParser) ─► onEmptyEnter(空Enter→切换工具轨迹) / onShiftTab(循环权限)
   │ 非空 → handleSubmit
   ▼
 CommandDispatcher.dispatch(input)
   │
   ├─ 以 "/" 开头 → 解析命令 → 注册表 handler
   │     ├─ /plan /do /session /model /permission ... (本地操作/UI面板)
   │     ├─ /review /commit ... (Skill 命令 → SkillRunner)
   │     └─ 未命中 → /help 引导
   │
   └─ 普通消息 ───────────────► ChatManager.run(content, provider, {mode,signal,permissionDecider})
                                    │
                                    ▼
                           ① 记录输入历史(prompt_history.jsonl)
                           ② Hook: turn_start / user_message
                           ③ FileHistory.makeSnapshot()  ← 文件回滚快照点
                           ④ 持久化 user 消息 → sessions/<id>.jsonl
                           ⑤ history.push(user)
                                    │
                                    ▼
                          AgentLoop.execute()  ── ReAct 循环 ──┐
                                    │                          │
        ┌───────────────────────────┼────────────────────┐     │
        │  每轮迭代:                 ▼                    │     │
        │  ① collectEnvironment + buildSystemReminder    │     │
        │     ├─ 环境信息(根目录/OS/日期/时区/模式)         │     │
        │     ├─ 当前任务模式(plan/act)                    │     │
        │     ├─ 自定义指令(项目指令文件)                   │     │
        │     ├─ 长期记忆(memory/MEMORY.md)               │     │
        │     ├─ 已激活Skill / Hook指令 / 可用Skill       │     │
        │  ② 组装请求:                                     │     │
        │     systemPrompt = 静态提示(sections.ts)         │     │
        │     tools        = Plan过滤后的工具定义           │     │
        │     messages     = [history...] + [system-reminder] │  │
        │  ③ ContextManager.manage()                      │     │
        │     ├─ 估算Token, 接近上限→轻量落盘/重量摘要     │     │
        │     └─ 产出 ProviderRequest                     │     │
        │  ④ Provider.chat(SSE) → StreamCollector         │     │
        │     ├─ text_delta → UI 流式文本                  │     │
        │     ├─ thinking_delta → 丢弃(不展示)             │     │
        │     └─ tool_calls → 交给 ToolScheduler           │     │
        │  ⑤ ToolScheduler.executeBatch                   │     │
        │     ├─ plan模式 && 副作用工具 → 拒绝             │     │
        │     ├─ PermissionManager:                        │     │
        │     │   黑名单→沙箱→规则→strict直接拒/default确认/allow放行 │
        │     ├─ 读类工具并发 / 副作用串行                  │     │
        │     ├─ Hook: pre_tool_use / post_tool_use       │     │
        │     └─ 结果 → UI 工具轨迹折叠 + 回灌 history     │     │
        │  ⑥ 有 tool_calls → 回到 ① 继续迭代              │     │
        └───────────────────────────┼────────────────────┘     │
                                    ▼                          │
                      无工具调用 / 达到停止条件 ──► finish        │
                                    │                          │
                            ┌───────┴────────┐                 │
                            ▼                ▼                 │
                     FileHistory       hook: end_turn          │
                     检查点快照          turn_end               │
                            │                │                 │
                            ▼                ▼                 │
                     后台任务(不阻塞):                          │
                     ├─ MemoryExtractor → memory/ 项目知识     │
                     ├─ 用户偏好 → ~/.bettercode/memory/       │
                     ├─ MemoryGovernor.maybeRun() ─ 门控后治理 │
                     │    ├─ 有记忆 & ≥24h & ≥10min & 会话≥5 & 拿锁 │
                     │    ├─ 四阶段LLM: 定位→信号→整理→修剪索引 │
                     │    ├─ 去重merge / 删delete / 矛盾update │
                     │    └─ 归档.archive + 重建MEMORY.md+超限提示 │
                     ├─ SessionSummarizer → 会话摘要           │
                     └─ 持久化 assistant 消息 → sessions/*.jsonl│
                                    │                          │
                                    ▼                          │
                         UI: 停止通知 + 最终Markdown渲染 ◄──────┘
```

## 三、关键流程要点

1. **七来源组装**发生在每轮迭代的 `②`：`systemPrompt`(静态) + `tools` + `messages`(history + 含环境/记忆/指令/模式/换行的 `<system-reminder>`)，由 `ContextManager.buildRequest` 统一打包给 Provider。
2. **一次 turn = 一条用户输入到 Agent 停止**，内部多次模型迭代不重复触发 turn 级 Hook，但每轮都重建 system-reminder。
3. **工具回灌**是闭环关键：工具结果写入 history 的 `role:'tool'` 消息，下一轮迭代模型能看到。
4. **全部旁路副作用**(文件历史/记忆提取/会话存档)都在 finally/后台异步做，不阻塞主回复。

## 四、记忆治理（MemoryGovernor）

> 自动笔记是"只进不出"，治理器在后台定期整理记忆库，避免重复、过时与矛盾条目无限积累。详见 `docs/memory-system/spec.md` 增量章节（F40–F50）。

### 触发门控（`maybeRun`，任一不满足即跳过、不调 LLM）

```
有记忆文件 ─► 距上次成功整理 ≥24h ─► 距上次尝试 ≥10min
          ─► 会话存档(.jsonl)数 ≥5 ─► 获取 .governance.lock ─► 后台整理
```

- 状态存 `.bettercode/memory/.governance.json`（lastAttemptAt / lastGovernedAt / runCount / lastError）。
- 锁用 `flag:'wx'` 排他创建，>30min 视为陈旧锁删除重试；防并发。

### 整理流程（`run`）

```
枚举全部记忆(name/type/desc/mtime/正文截断)
  → 一次无工具 LLM 调用，prompt 引导四阶段：定位 → 收集信号 → 整理 → 修剪索引
  → 输出 JSON 操作清单 {"actions":[{action,targets,into,content,reason}]}
  → 安全校验：targets 排除 MEMORY.md / 隐藏 / 未知文件；merge/update 必填字段校验
  → 归档：被删/覆盖原文备份到 .archive/<时间戳>/<name>.md.bak（.bak 避开扫描）
  → 执行：delete 删 / merge 写 into 删源(沿用源作用域) / update 覆盖 / keep 计数
  → 重建 MEMORY.md，按 200 行/25KB 规则预计算被截断名单 → indexOverflow 提示
```

### 接入与展示

- `ChatManager.scheduleMemoryGovernance`：挂在 Agent 每轮自然完成的 `onLoopComplete` 后台任务（与记忆提取同位置），默认开启，失败静默。
- `/memory` 面板展示治理状态：上次整理时间、整理次数、索引截断提示（超出 200 行/25KB 被挤掉的记忆名）。
