# BetterCode 会话上下文总结

> 生成日期: 2026-07-21 | 用途: 迁移到其他 AI 编码工具（如 Codex）时快速恢复上下文

## 项目概述

从零构建终端 AI 编程助手 BetterCode（类 Claude Code），使用 **TypeScript + Ink (React TUI)**。第一步里程碑：纯对话，不做 tool use。

## 当前状态

✅ **已完成**，在 DeepSeek V4 Pro 上实测通过，流式对话正常。

---

## 技术架构（四层）

```
UI 层 (Ink/React) → Chat 层 (Manager) → Provider 层 (抽象接口) → Config 层 (YAML)
```

| 层 | 路径 | 核心文件 | 职责 |
|-----|------|---------|------|
| Config | `src/config/` | `loader.ts`, `resolver.ts`, `types.ts` | YAML 读取校验 + ENV 替换，三选一供应商选择 |
| Provider | `src/provider/` | `types.ts`, `anthropic.ts`, `openai.ts`, `factory.ts` | 统一 `LLMProvider` 接口，SSE 流式解析 |
| Chat | `src/chat/` | `manager.ts` | `Message[]` 对话历史管理 |
| UI | `src/ui/` | `app.tsx`, `message-list.tsx`, `input-box.tsx` | Ink 终端界面 |

## 关键设计决策

- **HTTP/SSE**: 零依赖，用 Node.js 内置 `fetch` + `ReadableStream` 自解析 SSE
- **Provider 接口**: `chat(messages: Message[], onEvent: (e: StreamEvent) => void)` — 回调发 `text_delta | thinking_delta | error | done` 四种事件
- **DeepSeek**: 走 OpenAI 协议（API 完全兼容），`base_url=https://api.deepseek.com`，`model=deepseek-v4-pro`
- **配置格式**: YAML，6 字段 (`name`/`protocol`/`model`/`base_url`/`api_key`/`thinking`)，支持 `${ENV_VAR}` 占位
- **供应商选择优先级**: `--provider` 命令行 > `default: true` 标记 > 交互式选择
- **依赖**: 3 运行时 (`ink`, `react`, `yaml`) + 4 开发 (`typescript`, `tsx`, `@types/react`, `@types/node`)，总计 1037 行代码

## 核心接口定义

```typescript
// src/provider/types.ts

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface StreamEvent {
  type: 'text_delta' | 'thinking_delta' | 'error' | 'done';
  content: string;
}

interface LLMProvider {
  readonly name: string;
  readonly model: string;
  chat(messages: Message[], onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void>;
}

// src/config/types.ts

interface ProviderConfig {
  name: string;
  protocol: 'anthropic' | 'openai';
  model: string;
  base_url: string;
  api_key: string;
  thinking?: boolean;
  default?: boolean;
}

interface AppConfig {
  providers: ProviderConfig[];
}
```

## 配置文件 (`config.yaml`)

```yaml
providers:
  - name: deepseek-v4
    protocol: openai
    model: deepseek-v4-pro
    base_url: https://api.deepseek.com
    api_key: sk-xxx
    default: true
  - name: claude-sonnet
    protocol: anthropic
    model: claude-sonnet-5-20251001
    base_url: https://api.anthropic.com
    api_key: ${ANTHROPIC_API_KEY}
    thinking: false
  - name: gpt-4o
    protocol: openai
    model: gpt-4o
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}
```

## 修复过的 Bug

| Bug | 文件 | 修复方式 |
|-----|------|---------|
| JSX `>` 转义 | `input-box.tsx` | `> ` → `{'>'} ` |
| 闭包过期导致 thinking 丢失 | `app.tsx` | `currentThinking` 改为 `useRef` 追踪 streaming 期间累积值 |
| ENV 替换过于严格 | `loader.ts` | `${VAR}` 未设置时 warn + 保留原值，而非直接抛异常 |

## 已支持命令

`/help`, `/clear`, `/exit`, `/quit`, `Ctrl+C`

## 启动方式

```bash
pnpm install && pnpm start            # 使用默认 provider
pnpm start --provider claude-sonnet   # 指定 provider
pnpm typecheck                        # 类型检查
```

## 文件结构

```
bettercode/
├── config.yaml              # 默认配置模板（含 DeepSeek key）
├── package.json             # 3 deps + 4 devDeps
├── tsconfig.json            # strict 模式
├── docs/
│   ├── spec.md              # 需求文档
│   ├── plan.md              # 技术设计
│   ├── task.md              # 任务拆解
│   ├── checklist.md         # 验收清单
│   └── context-summary.md   # 本文件
└── src/                     # 1037 行
    ├── index.tsx            # 入口 (CLI + 串联启动)
    ├── config/
    │   ├── types.ts         # ProviderConfig, AppConfig
    │   ├── loader.ts        # YAML 读取 + 校验 + ENV 替换
    │   └── resolver.ts      # 三选一供应商选择
    ├── provider/
    │   ├── types.ts         # Message, StreamEvent, LLMProvider
    │   ├── anthropic.ts     # Anthropic SSE 流式
    │   ├── openai.ts        # OpenAI SSE 流式 (DeepSeek 复用)
    │   └── factory.ts       # 工厂函数
    ├── chat/
    │   └── manager.ts       # 对话历史管理
    └── ui/
        ├── app.tsx          # App 主组件 (状态 + 编排)
        ├── message-list.tsx # 消息列表 + 流式渲染
        └── input-box.tsx    # 输入框组件
```

## 下一步（未做，留给后续里程碑）

- tool use / function calling
- 文件操作和代码编辑
- 会话持久化（目前纯内存，退出即丢）
- Markdown 富文本渲染
- 流式中断 / 重新生成 / 编辑消息
- 多会话管理
