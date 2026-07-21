# BetterCode Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `package.json` | 项目元信息 + 依赖 + 脚本 |
| 新建 | `tsconfig.json` | TypeScript 严格模式配置 |
| 新建 | `config.yaml` | 默认配置文件模板 |
| 新建 | `src/config/types.ts` | ProviderConfig, AppConfig 类型 |
| 新建 | `src/provider/types.ts` | Message, StreamEvent, LLMProvider 接口 |
| 新建 | `src/config/loader.ts` | YAML 读取 + 校验 + ENV 替换 |
| 新建 | `src/config/resolver.ts` | 三选一供应商选择逻辑 |
| 新建 | `src/provider/anthropic.ts` | Anthropic Provider 实现 |
| 新建 | `src/provider/openai.ts` | OpenAI Provider 实现 |
| 新建 | `src/provider/factory.ts` | Provider 工厂函数 |
| 新建 | `src/chat/manager.ts` | ChatManager 对话管理 |
| 新建 | `src/ui/message-list.tsx` | 消息列表展示 |
| 新建 | `src/ui/input-box.tsx` | 输入框组件 |
| 新建 | `src/ui/app.tsx` | App 主组件 |
| 新建 | `src/index.tsx` | 入口：CLI 解析 + 串联启动 |

---

## T1: 项目骨架初始化

**文件：** `package.json`, `tsconfig.json`, `config.yaml`, 目录结构
**依赖：** 无

**步骤：**
1. 创建 `package.json`，设置 `name: "bettercode"`，添加 dependencies（ink, react, yaml）和 devDependencies（typescript, tsx, @types/react, @types/node）
2. 添加 scripts: `"start": "tsx src/index.tsx"`, `"typecheck": "tsc --noEmit"`
3. 创建 `tsconfig.json`，开启 `strict: true`, `target: "ES2022"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `jsx: "react-jsx"`
4. 创建 `config.yaml` 模板（包含 claude-sonnet 和 gpt-4o 两个示例条目）
5. 创建目录结构: `src/config/`, `src/provider/`, `src/chat/`, `src/ui/`
6. 运行 `pnpm install`

**验证：** `pnpm install` 成功，`pnpm typecheck` 无错误

---

## T2: 类型定义

**文件：** `src/config/types.ts`, `src/provider/types.ts`
**依赖：** T1

**步骤：**
1. 定义 `ProviderConfig` 接口（name, protocol, model, base_url, api_key, thinking?, default?）
2. 定义 `AppConfig` 接口（providers: ProviderConfig[]）
3. 定义 `Message` 接口（role: 'user' | 'assistant', content: string）
4. 定义 `StreamEvent` 接口（type: 'text_delta' | 'thinking_delta' | 'error' | 'done', content: string）
5. 定义 `LLMProvider` 接口（name: string, model: string, chat(messages, onEvent, signal?)）

**验证：** `pnpm typecheck` 通过

---

## T3: Config 加载器

**文件：** `src/config/loader.ts`
**依赖：** T2

**步骤：**
1. 实现 `loadConfig(path)` 函数：`fs.readFileSync` + `yaml.parse()`
2. 校验每个 provider: name 非空且不重复、protocol 必须为 'anthropic' 或 'openai'、model/base_url/api_key 非空
3. 正则替换 `api_key` 中的 `${VAR}` → `process.env[VAR]`，替换后仍含 `${...}` 则报错
4. 校验失败抛 Error 带中文描述

**验证：** `pnpm typecheck` 通过；用临时脚本验证读取和报错逻辑

---

## T4: Config 解析器

**文件：** `src/config/resolver.ts`
**依赖：** T3

**步骤：**
1. 实现 `resolveProvider(config, cliProviderName?)` 函数
2. 优先级：`--provider` > `default: true` > 交互式选择
3. `--provider` 按 name 精确匹配，找不到抛 Error
4. 多个 provider 标记 `default: true` 时抛 Error
5. 交互式选择：用 `readline` 展示列表，用户输入序号选择

**验证：** `pnpm typecheck` 通过

---

## T5: Anthropic Provider

**文件：** `src/provider/anthropic.ts`
**依赖：** T2

**步骤：**
1. 实现 `AnthropicProvider` 类，实现 `LLMProvider` 接口
2. 构造函数接收 `ProviderConfig`，保存 name、model、base_url、api_key、thinking
3. 实现 `chat(messages, onEvent)` 方法：
   - 构造 Anthropic Messages API 请求体（`model`, `messages`, `stream: true`, `max_tokens: 4096`）
   - 若 `thinking: true`，追加 `thinking: { type: "enabled", budget_tokens: 4000 }`
   - `fetch(url, { method: 'POST', headers: { 'x-api-key', 'anthropic-version', 'content-type' }, body })`
   - 读取 `response.body` ReadableStream，逐行解析 SSE 事件
   - 事件分发：`content_block_delta` (text) → `text_delta`，`content_block_delta` (thinking) → `thinking_delta`，`message_stop` → `done`
   - HTTP 非 2xx → 读取 body 发 `error` 事件，网络异常 catch → 发 `error` 事件

**验证：** `pnpm typecheck` 通过

---

## T6: OpenAI Provider

**文件：** `src/provider/openai.ts`
**依赖：** T2

**步骤：**
1. 实现 `OpenAIProvider` 类，实现 `LLMProvider` 接口
2. 构造函数接收 `ProviderConfig`
3. 实现 `chat(messages, onEvent)` 方法：
   - 构造 OpenAI Chat Completions API 请求体（`model`, `messages`, `stream: true`）
   - `fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ...', 'Content-Type' }, body })`
   - 读取 ReadableStream，逐行解析 `data: {...}` 格式
   - `choices[0].delta.content` 非空 → `text_delta`
   - `choices[0].finish_reason === "stop"` → `done`
   - `data: [DONE]` → 忽略
   - 错误处理同 Anthropic

**验证：** `pnpm typecheck` 通过

---

## T7: Provider 工厂

**文件：** `src/provider/factory.ts`
**依赖：** T5, T6

**步骤：**
1. 实现 `createProvider(config: ProviderConfig): LLMProvider`
2. `protocol === 'anthropic'` → `new AnthropicProvider(config)`
3. `protocol === 'openai'` → `new OpenAIProvider(config)`
4. 不支持的 protocol → 抛 Error

**验证：** `pnpm typecheck` 通过

---

## T8: Chat Manager

**文件：** `src/chat/manager.ts`
**依赖：** T2

**步骤：**
1. 实现 `ChatManager` 类
2. `constructor(systemPrompt?)`: 初始化空 `messages: Message[]`
3. `getHistory()`: 返回 messages 副本
4. `send(userInput, provider, callbacks)`:
   - 追加 `{ role: 'user', content: userInput }` 到 history
   - 调 `provider.chat(history, onEvent)`，在 onEvent 中转发到对应回调
   - 收集所有 `text_delta` 拼接为完整回复
   - 追加 `{ role: 'assistant', content: fullReply }` 到 history
   - 返回完整回复
5. `clear()`: 清空 history

**验证：** `pnpm typecheck` 通过

---

## T9: UI — MessageList 组件

**文件：** `src/ui/message-list.tsx`
**依赖：** T2

**步骤：**
1. 实现 `MessageList` 组件，接收 props: `messages: DisplayMessage[]`, `currentStreaming: string`, `currentThinking: string`, `isThinking: boolean`
2. 遍历渲染历史消息：user 消息带 `> ` 前缀，assistant 消息正常展示
3. thinking 内容用灰色渲染（`<Text color="grey">`）
4. 末尾追加 currentStreaming 文本

**验证：** `pnpm typecheck` 通过

---

## T10: UI — InputBox 组件

**文件：** `src/ui/input-box.tsx`
**依赖：** T1

**步骤：**
1. 实现 `InputBox` 组件，接收 props: `onSubmit: (input: string) => void`, `disabled: boolean`
2. 用 `useInput` 捕获键盘输入
3. 维护内部 `input` state：Backspace 删除、Enter 提交、普通字符追加
4. 提交时调 `onSubmit(input)` 并清空输入
5. disabled 时不响应
6. 渲染 `> {input}` 提示行

**验证：** `pnpm typecheck` 通过

---

## T11: UI — App 主组件

**文件：** `src/ui/app.tsx`
**依赖：** T8, T9, T10

**步骤：**
1. 实现 `App` 组件，接收 props: `provider: LLMProvider`, `chatManager: ChatManager`
2. 管理 AppState（messages, currentStreaming, currentThinking, isThinking, isStreaming, providerName）
3. 实现 `sendMessage(input: string)`:
   - `/exit`、`/quit` → `process.exit(0)`
   - `/clear` → `chatManager.clear()` + 清空 messages state
   - `/help` → 追加 help 消息到 messages
   - 其他 → 调 `chatManager.send()`，回调中 `setState` 逐 token 更新
4. 布局：`<Box flexDirection="column">` 全屏，上部 MessageList，下部 InputBox
5. Ctrl+C → `useApp().exit()` 退出

**验证：** `pnpm typecheck` 通过

---

## T12: 入口文件

**文件：** `src/index.tsx`
**依赖：** T3, T4, T7, T8, T11

**步骤：**
1. `import { parseArgs } from 'node:util'` 解析 `--provider` 参数
2. `loadConfig('./config.yaml')` 读取配置
3. `resolveProvider(config, args.values.provider)` 选出供应商
4. `createProvider(selectedConfig)` 创建 provider 实例
5. `new ChatManager()` 创建对话管理器
6. `render(<App provider={...} chatManager={...} />)` 启动 TUI

**验证：** `pnpm typecheck` 通过，`pnpm start` 能启动

---

## T13: tmux 端到端验收

**依赖：** T12

**步骤：**
1. 设置有效 API key 环境变量
2. 在 tmux 中启动 BetterCode: `pnpm start`
3. 验证对话界面正常显示
4. 输入 "你好"，验证流式逐字返回
5. 输入 "我叫小明" → "我叫什么名字？"，验证多轮记忆
6. 验证 `/help`, `/clear`, `/exit` 命令
7. 用 `--provider` 切换供应商
8. 对照 checklist.md 逐项验收

**验证：** checklist.md 全部通过

---

## 执行顺序

```
T1 (项目骨架)
 │
 ├─→ T2 (类型定义)
 │     │
 │     ├─→ T3 (Config 加载器)
 │     │     └─→ T4 (Config 解析器)
 │     │
 │     ├─→ T5 (Anthropic) ─┬─→ T7 (工厂)
 │     └─→ T6 (OpenAI)    ─┘
 │
 ├─→ T8 (Chat Manager)
 │
 ├─→ T9 (MessageList) ─┐
 └─→ T10 (InputBox)   ─┼─→ T11 (App) ─→ T12 (入口) ─→ T13 (E2E)
```

T5/T6 可并行，T9/T10 可并行。
