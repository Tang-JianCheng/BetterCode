# BetterCode Plan

## 架构概览

BetterCode 采用分层架构，从上到下分为四层：

```
┌──────────────────────────────────────┐
│            UI 层 (Ink/React)          │  TUI 界面，处理用户输入和渲染
├──────────────────────────────────────┤
│           Chat 层 (Manager)           │  管理对话上下文，编排调用
├──────────────────────────────────────┤
│         Provider 层 (抽象接口)         │  统一的 LLM 调用接口
│    ┌──────────┐  ┌──────────┐        │
│    │Anthropic │  │  OpenAI  │  ...   │  具体实现
│    └──────────┘  └──────────┘        │
├──────────────────────────────────────┤
│          Config 层 (配置管理)          │  读取 YAML，选择供应商
└──────────────────────────────────────┘
```

各层职责：

| 层 | 职责 |
|-----|------|
| **UI** | 终端界面渲染。输入框接收用户问题，消息列表流式展示 AI 回复。支持 `/exit`、`/quit`、Ctrl+C 退出 |
| **Chat** | 持有消息列表 `Message[]`。每轮对话追加 user/assistant 消息。调用 Provider 时将完整历史传入 |
| **Provider** | 统一接口 `LLMProvider`。`chat(messages, onEvent)` 方法接收消息历史和回调，内部处理 SSE 流式解析，每收到一个 token 就调用 `onEvent({type: 'text_delta', content})` |
| **Config** | 读取 `config.yaml`，校验字段，解析 `${ENV_VAR}` 环境变量占位。根据优先级规则选出使用的 provider 配置 |

### Spec 覆盖关系

| Spec 需求 | 架构映射 |
|-----------|---------|
| F1 TUI 界面 | UI 层 (Ink) |
| F2 流式输出 | Provider 层 SSE 解析 + UI 层 setState 逐 token 渲染 |
| F3 多轮对话 | Chat 层持有 Message[] 历史，每次请求传入完整历史 |
| F4 YAML 配置 | Config 层 |
| F5 双后端 | Provider 层 Anthropic + OpenAI 两个实现 |
| F6 Extended Thinking | Anthropic Provider 请求体中追加 thinking 参数 |
| F7 Provider 抽象 | `LLMProvider` 接口 |

---

## 核心数据结构

### Config 层类型

```typescript
// src/config/types.ts

/** 单个供应商配置，与 config.yaml 中每个 provider 条目一一对应 */
interface ProviderConfig {
  name: string;                     // 供应商标识名
  protocol: 'anthropic' | 'openai'; // 协议类型
  model: string;                    // 模型名
  base_url: string;                 // API 地址
  api_key: string;                  // 认证密钥（支持 ${ENV_VAR} 占位）
  thinking?: boolean;               // 是否启用 extended thinking，默认 false
  default?: boolean;                // 是否为默认供应商，默认 false
}

/** config.yaml 顶层结构 */
interface AppConfig {
  providers: ProviderConfig[];
}
```

### Provider 层类型 & 接口

```typescript
// src/provider/types.ts

/** 一条对话消息 */
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/** Provider 在流式返回时实时发出的事件 */
interface StreamEvent {
  type: 'text_delta' | 'thinking_delta' | 'error' | 'done';
  content: string;  // token 文本（error/done 时承载错误信息或为空）
}

/** 所有 LLM 后端必须实现的统一接口 */
interface LLMProvider {
  readonly name: string;
  readonly model: string;

  /**
   * 发送消息并流式接收回复
   * @param messages  完整对话历史
   * @param onEvent   每收到一个 token 或事件时回调
   * @param signal    可选的 AbortSignal，用于取消请求（这一步暂不使用，预留）
   */
  chat(
    messages: Message[],
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}
```

### Chat 层

```typescript
// src/chat/manager.ts

class ChatManager {
  /**
   * @param systemPrompt 可选的系统提示词，放入 messages[0] (role: 'system')
   */
  constructor(systemPrompt?: string);

  /** 获取当前完整对话历史 */
  getHistory(): Message[];

  /**
   * 发送用户消息，内部调用 provider.chat()，
   * 流式收集 assistant 回复并追加到 history
   * @returns 最终拼接完整的 assistant 回复文本
   */
  async send(
    userInput: string,
    provider: LLMProvider,
    onThinkingDelta: (token: string) => void,
    onTextDelta: (token: string) => void,
    onError: (err: string) => void,
  ): Promise<string>;

  /** 清空对话历史（/clear 命令） */
  clear(): void;
}
```

### UI 状态

```typescript
// App 组件内部状态

interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;   // thinking 内容（如有）
}

interface AppState {
  messages: DisplayMessage[];     // 所有已展示的消息
  currentStreaming: string;       // 当前正在流式输出的文本（逐 token 追加）
  currentThinking: string;        // 当前 thinking 内容（如有）
  isThinking: boolean;            // 是否正在展示 thinking
  isStreaming: boolean;           // 是否正在等待 AI 回复
  providerName: string;           // 当前使用的供应商名
}
```

### 配置文件示例

```yaml
# config.yaml
providers:
  - name: claude-sonnet
    protocol: anthropic
    model: claude-sonnet-5-20251001
    base_url: https://api.anthropic.com
    api_key: ${ANTHROPIC_API_KEY}
    thinking: false
    default: true

  - name: gpt-4o
    protocol: openai
    model: gpt-4o
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}
```

---

## 模块设计

### 模块 A: Config（配置管理）

**职责：** 读取 YAML，校验字段，替换环境变量，按优先级选出供应商配置。

**对外接口：**
```typescript
// src/config/loader.ts
function loadConfig(path?: string): AppConfig

// src/config/resolver.ts
function resolveProvider(
  config: AppConfig,
  cliProviderName?: string,
): Promise<ProviderConfig>  // 如果无 default 且无 CLI 参数，则交互式选择
```

**依赖：** `yaml` npm 包、Node.js 内置 `fs`、`readline`。

**校验规则：**
- `name` 非空字符串，同一文件中不能重复
- `protocol` 必须为 `"anthropic"` 或 `"openai"`
- `model`、`base_url`、`api_key` 非空字符串
- `api_key` 中的 `${VAR}` 占位替换后不能仍含 `${...}`（环境变量未设置）

### 模块 B: Provider（LLM 后端）

**职责：** 实现 `LLMProvider` 接口，将统一消息格式转换为各厂商 API 格式，处理 SSE 流式响应，解析为 `StreamEvent` 回调。

**对外接口：**
```typescript
// src/provider/factory.ts
function createProvider(config: ProviderConfig): LLMProvider
```

**子模块：**

| 文件 | 职责 |
|------|------|
| `src/provider/anthropic.ts` | Anthropic Messages API 实现。构造请求体（含 `messages`、`model`、`stream: true`、`thinking` 块），解析 Anthropic SSE 事件（`content_block_delta` → `text_delta` / `thinking_delta`） |
| `src/provider/openai.ts` | OpenAI Chat Completions API 实现。构造请求体（含 `messages`、`model`、`stream: true`），解析 OpenAI SSE 事件（`choices[0].delta.content` → `text_delta`） |

**依赖：** Node.js 内置 `fetch` + `ReadableStream`，不引入第三方 HTTP 库。

**Anthropic SSE 解析要点：**
```
event: content_block_start  → 判断是 text 块还是 thinking 块
event: content_block_delta  → 提取 delta.text 或 delta.thinking
event: message_delta        → 可选的 usage 信息
event: message_stop         → 流结束，发送 done 事件
```

**OpenAI SSE 解析要点：**
```
data: {"choices":[{"delta":{"content":"你好"}}]}
data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}
data: [DONE]
```

### 模块 C: Chat（对话管理）

**职责：** 维护对话历史 `Message[]`，编排一次完整的问答流程（发送历史 → 流式接收 → 追加到历史）。

**对外接口：**
```typescript
// src/chat/manager.ts
class ChatManager {
  constructor(systemPrompt?: string);
  getHistory(): Message[];
  async send(userInput, provider, callbacks): Promise<string>;
  clear(): void;
}
```

**依赖：** `LLMProvider` 接口（不依赖具体实现）。

**send() 执行流程：**
1. 将 `{ role: 'user', content: userInput }` 追加到 history
2. 调用 `provider.chat(history, onEvent)`
3. 在 onEvent 中转发：`thinking_delta` → `onThinkingDelta`，`text_delta` → `onTextDelta`，`error` → `onError`
4. 收集所有 text_delta 拼接为完整回复
5. 将 `{ role: 'assistant', content: fullReply }` 追加到 history
6. 返回完整回复

### 模块 D: UI（终端界面）

**职责：** 渲染 TUI，管理用户输入状态和消息展示状态。

**组件树：**
```
<App>
  <MessageList messages={[...]} currentStreaming={...} currentThinking={...} />
  <InputBox onSubmit={sendMessage} disabled={isStreaming} />
</App>
```

**依赖：** Ink（`render`, `Box`, `Text`, `Static`, `useInput`, `useApp`），ChatManager，LLMProvider。

**命令支持：**
| 命令 | 行为 |
|------|------|
| `/exit`, `/quit` | 退出程序 |
| `/clear` | 清空对话历史 |
| `/help` | 显示帮助信息 |
| Ctrl+C | 退出程序 |

---

## 模块交互

### 一次对话的调用链

```
用户输入 "你好" 并按 Enter
    │
    ▼
┌─ UI: InputBox.onSubmit("你好")
│   1. setState({ isStreaming: true, currentThinking: '', currentStreaming: '' })
│   2. 追加 user 消息到 messages 列表
│   3. 调用 chatManager.send("你好", provider, callbacks)
│        │
│        ▼
│   ┌─ Chat: ChatManager.send()
│   │   1. 追加 { role: 'user', content: '你好' } 到 history
│   │   2. 调用 provider.chat(history, onEvent)
│   │        │
│   │        ▼
│   │   ┌─ Provider: AnthropicProvider.chat()
│   │   │   1. 构造 Anthropic API 请求体 (messages + model + stream: true + thinking)
│   │   │   2. fetch(url, { method: 'POST', body, headers }) → Response.body (ReadableStream)
│   │   │   3. reader.read() 循环，逐行解析 SSE
│   │   │   4. content_block_delta (text) → onEvent({ type: 'text_delta', content: '你' })
│   │   │      content_block_delta (thinking) → onEvent({ type: 'thinking_delta', content: '...' })
│   │   │       ...
│   │   │      message_stop → onEvent({ type: 'done', content: '' })
│   │   │        │
│   │   │        ▼ (每个 token)
│   │   │   ┌─ UI: onTextDelta('你')
│   │   │   │   setState({ currentStreaming: prev + '你' })  ← 逐字渲染
│   │   │   └────────────────────────────────────────────
│   │   └─────────────────────────────────────────────
│   │   3. 将完整的 assistant 回复追加到 history
│   │   4. 返回完整回复文本
│   └─────────────────────────────────────────────
│   4. setState({ isStreaming: false })
│   5. 将完整回复追加到 messages 列表，清空 currentStreaming
└──────────────────────────────────────────────
```

### 启动流程

```
bin/bettercode 启动
    │
    ▼
1. 解析 CLI 参数: util.parseArgs({ options: { provider: { type: 'string' } } })
    │
    ▼
2. config/loader.loadConfig('./config.yaml')
   → yaml.parse() → 校验字段 → 正则替换 ${ENV_VAR}
    │
    ▼
3. config/resolver.resolveProvider(config, cliProviderName)
   ├─ 有 --provider → 按 name 匹配
   ├─ 无，但有 default:true → 直接用
   └─ 都无 → 交互式 readline 列表选择
    │
    ▼
4. provider/factory.createProvider(selectedConfig)
   → protocol === 'anthropic' → new AnthropicProvider(config)
   → protocol === 'openai'    → new OpenAIProvider(config)
    │
    ▼
5. new ChatManager() + render(<App provider={...} chatManager={...} />)
    │
    ▼
6. 用户进入对话界面，等待输入
```

---

## 文件组织

```
bettercode/
├── src/
│   ├── index.tsx               — 入口：解析 CLI、加载配置、启动 TUI
│   ├── config/
│   │   ├── types.ts            — ProviderConfig, AppConfig 类型定义
│   │   ├── loader.ts           — loadConfig(): YAML 读取 + 校验 + ENV 替换
│   │   └── resolver.ts         — resolveProvider(): 三选一逻辑
│   ├── provider/
│   │   ├── types.ts            — Message, StreamEvent, LLMProvider 接口
│   │   ├── factory.ts          — createProvider(): 工厂函数
│   │   ├── anthropic.ts        — AnthropicProvider 类实现
│   │   └── openai.ts           — OpenAIProvider 类实现
│   ├── chat/
│   │   └── manager.ts          — ChatManager 类
│   └── ui/
│       ├── app.tsx             — App 主组件（状态管理 + 布局）
│       ├── message-list.tsx    — 消息展示列表组件
│       ├── input-box.tsx       — 输入框组件
│       └── provider-select.tsx — 交互式供应商选择组件
├── config.yaml                  — 默认配置文件
├── package.json
├── tsconfig.json
└── README.md
```

---

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| **运行时** | Node.js 18+ | `fetch` + `ReadableStream` 内置，无需引入第三方 HTTP 库处理 SSE |
| **TUI 框架** | Ink 5.x | Spec 已指定，React 范式在终端渲染，组件化开发效率高 |
| **YAML 解析** | `yaml` (npm) | 社区最活跃的 JS YAML 库，同时支持 parse 和 stringify |
| **HTTP 客户端** | 内置 `fetch` | Node 18+ 原生支持，ReadableStream 天然适合 SSE 流式读取。零额外依赖 |
| **SSE 解析** | 自实现轻量解析器 | Anthropic 和 OpenAI 的 SSE 事件格式不同，轻封装即可，不需要引入 `eventsource` 包 |
| **构建工具** | `tsx` + `tsc` | `tsx` 用于开发热运行（无需编译），`tsc --noEmit` 做类型检查 |
| **CLI 参数** | Node.js 内置 `util.parseArgs` | 目前只有 `--provider` 一个参数，内置 API 足够，不引入 commander/yargs |
| **包管理** | `pnpm` | AC1 中已约定 `pnpm start` |
| **环境变量替换** | 自实现 `${VAR}` 正则替换 | 简单正则 + `process.env` 读取即可，不引入模板引擎 |
| **TypeScript** | Strict 模式 | 开启 `strict: true`，利用类型系统减少运行时错误 |
| **项目初始化** | 手动初始化 | 不使用 `create-ink-app` 脚手架，从零安装 Ink + React，保持最小依赖 |

### 依赖清单

```json
{
  "dependencies": {
    "ink": "^5.x",
    "react": "^18.x",
    "yaml": "^2.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "@types/react": "^18.x",
    "@types/node": "^22.x"
  }
}
```

总计 **3 个运行时依赖** + **4 个开发依赖**。
