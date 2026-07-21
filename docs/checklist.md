# BetterCode Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] **Config 类型定义** — `ProviderConfig`、`AppConfig` 类型已导出 (验证: `pnpm typecheck` 通过且 import 无报错)
- [ ] **Provider 接口** — `Message`、`StreamEvent`、`LLMProvider` 已导出 (验证: `pnpm typecheck` 通过)
- [ ] **Config 加载器** — `loadConfig()` 能正确读取 YAML 并校验字段 (验证: 用有效/无效 config.yaml 分别运行，正确/报错)
- [ ] **Config 解析器** — `resolveProvider()` 三种路径均可工作 (验证: 分别模拟三种场景运行)
- [ ] **Anthropic Provider** — `AnthropicProvider` 实现 `LLMProvider` 接口，能发起流式请求 (验证: `pnpm typecheck` 通过)
- [ ] **OpenAI Provider** — `OpenAIProvider` 实现 `LLMProvider` 接口，能发起流式请求 (验证: `pnpm typecheck` 通过)
- [ ] **Provider 工厂** — `createProvider()` 按 protocol 正确分发 (验证: 传入不同 protocol，返回正确实例)
- [ ] **Chat Manager** — `ChatManager` 正确维护对话历史和编排流式调用 (验证: `pnpm typecheck` 通过)
- [ ] **MessageList 组件** — 正确渲染历史消息和流式输出 (验证: `pnpm typecheck` 通过)
- [ ] **InputBox 组件** — 正确捕获输入和提交 (验证: `pnpm typecheck` 通过)
- [ ] **App 主组件** — 串联 MessageList + InputBox，支持 `/exit`、`/clear`、`/help` 命令 (验证: `pnpm typecheck` 通过)
- [ ] **入口文件** — 正确串联 CLI → Config → Provider → Chat → TUI 启动链路 (验证: `pnpm start` 能启动)

## 集成

- [ ] **Config → Provider 链路** — `loadConfig` → `resolveProvider` → `createProvider` 端到端可走通 (验证: 运行入口，无 API 报错即链路通)
- [ ] **Chat → Provider 链路** — `ChatManager.send()` 正确调用 `provider.chat()` 并接收流式事件 (验证: 实际对话一次)
- [ ] **UI → Chat 链路** — `App.sendMessage()` → `chatManager.send()` → Provider → 回调更新 UI (验证: 终端看到流式输出)

## 编译与测试

- [ ] 项目编译无错误 (验证: `pnpm typecheck` 零错误)
- [ ] `pnpm start` 可正常启动 (验证: 启动后出现对话界面或明确的配置错误提示)

## 端到端场景

- [ ] **场景 1: 基本对话** — 启动 BetterCode → 输入 "你好" → 观察到 AI 流式逐字返回回复 (AC1)
- [ ] **场景 2: 多轮记忆** — 输入 "我叫小明" → 输入 "我叫什么名字？" → AI 回答包含 "小明" (AC2)
- [ ] **场景 3: 协议切换** — 修改 config.yaml 的 protocol 从 anthropic 改为 openai → 重启 → 对话正常 (AC3)
- [ ] **场景 4: Extended Thinking** — 使用 Anthropic 协议且 `thinking: true` → 对话时观察到 thinking 内容 (AC4)
- [ ] **场景 5: 错误提示** — `api_key` 设为无效值 → 输入问题 → 终端显示中文错误信息，无堆栈 trace (AC5)
- [ ] **场景 6: 命令支持** — 输入 `/help` 显示帮助 → 输入 `/clear` 清空历史 → 输入 `/exit` 退出
- [ ] **场景 7: 多供应商切换** — 配置两个供应商 → `--provider <name>` 指定 → 使用指定供应商对话 (AC7)
- [ ] **场景 8: 交互式选择** — 无 default 标记、不传 `--provider` → 启动后交互式选择供应商
- [ ] **场景 9: tmux 完整流程** — 在 tmux 中: 启动 → 提问 → 流式回复 → 追问 → `/exit` 退出，全流程正常 (AC6)
