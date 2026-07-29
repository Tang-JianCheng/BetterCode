# BetterCode 上下文管理 Tasks

## 执行约束

- 四份规格文档全部批准后才能执行本文件中的实现任务。
- 严格按依赖顺序推进；每项验证通过后再进入后续任务。
- 所有新增源码注释使用中文。
- 不新增运行时依赖，不访问真实模型 API，不连接公网服务。
- 不修改稳定 System Prompt 和工具描述内容，除非任务明确要求。
- 不回退现有 Agent Loop、权限、系统提示和 MCP 改动。
- 如需 Git 提交，提交信息必须使用中文。

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/context/types.ts` | 上下文选项、事件、结果、状态和错误类型 |
| 新建 | `src/context/constants.ts` | 默认窗口、阈值、目录和摘要标题 |
| 新建 | `src/context/constants.test.ts` | 默认值与选项校验测试 |
| 新建 | `src/context/token-estimator.ts` | 全量近似估算、usage 锚点与增量估算 |
| 新建 | `src/context/token-estimator.test.ts` | 多语言估算、锚点和回退测试 |
| 新建 | `src/context/tool-result-store.ts` | 项目内批量原子落盘与清理 |
| 新建 | `src/context/tool-result-store.test.ts` | 路径、权限、回滚、取消和生命周期测试 |
| 新建 | `src/context/history-planner.ts` | 工具原子组、近期边界和摘要写回 |
| 新建 | `src/context/history-planner.test.ts` | 配对、保留边界和用户原文测试 |
| 新建 | `src/context/summary-prompt.ts` | 摘要 Prompt、nonce 解析和边界消息 |
| 新建 | `src/context/summary-prompt.test.ts` | 草稿、摘要、注入和标题校验测试 |
| 新建 | `src/context/summarizer.ts` | 空工具摘要流收集与结果隔离 |
| 新建 | `src/context/summarizer.test.ts` | 成功、取消、流错和意外工具调用测试 |
| 新建 | `src/context/lightweight-compactor.ts` | 单结果和批次工具结果落盘选择 |
| 新建 | `src/context/lightweight-compactor.test.ts` | 阈值、排序、预览、幂等和失败测试 |
| 新建 | `src/context/manager.ts` | 两层编排、事务锁、锚点、熔断和清理 |
| 新建 | `src/context/manager.test.ts` | 自动、手动、失败、熔断和并发测试 |
| 新建 | `src/context/integration.test.ts` | Agent、Provider 与存储端到端场景 |
| 新建 | `src/config/loader.test.ts` | Provider 上下文窗口配置测试 |
| 修改 | `src/config/types.ts` | 增加 `context_window` |
| 修改 | `src/config/loader.ts` | 校验上下文窗口 |
| 修改 | `src/provider/types.ts` | Provider 能力、输出上限和消息内部元数据 |
| 修改 | `src/provider/openai.ts` | 窗口能力和摘要输出上限映射 |
| 修改 | `src/provider/openai.test.ts` | OpenAI 请求与默认窗口测试 |
| 修改 | `src/provider/anthropic.ts` | 窗口能力和摘要输出上限映射 |
| 修改 | `src/provider/anthropic.test.ts` | Anthropic 请求与默认窗口测试 |
| 修改 | `src/agent/types.ts` | 上下文事件和停止原因 |
| 修改 | `src/agent/loop.ts` | 每轮请求前管理与手动压缩入口 |
| 修改 | `src/agent/loop.test.ts` | 自动压缩、请求阻断和手动入口测试 |
| 修改 | `src/agent/stream-collector.test.ts` | Fake Provider 新能力兼容 |
| 修改 | `src/chat/manager.ts` | ContextManager 生命周期和 `/compact` 服务 |
| 修改 | `src/chat/manager.test.ts` | 手动压缩、并发、清理和关闭测试 |
| 修改 | `src/ui/app.tsx` | `/compact`、上下文进度和默认窗口提示 |
| 修改 | `src/ui/app.test.ts` | 命令和格式化行为测试 |
| 修改 | `src/index.tsx` | ChatManager 退出清理 |
| 修改 | `.gitignore` | 忽略 `.bettercode/context/` |
| 修改 | `config.yaml` | 为示例 Provider 声明窗口 |
| 修改 | `README.md` | 记录 `context_window` 与 `/compact` |

## T1：定义上下文公共类型和默认常量

**文件：** `src/context/types.ts`、`src/context/constants.ts`、`src/context/constants.test.ts`

**依赖：** 无

**步骤：**

1. 定义 `ContextManagerOptions`、`ContextTrigger`、`ContextErrorCode` 和 `ContextStatus`。
2. 定义 `ContextManageInput` 与 `ready | skipped | cancelled | blocked` 结果联合类型。
3. 定义四类 `ContextEvent`，字段与 plan.md 保持一致。
4. 定义轻量结果、存储结果、历史计划和摘要结果所需公共类型。
5. 在常量文件中定义 128K 默认窗口、`.bettercode/context`、九项默认阈值和七个摘要标题。
6. 实现部分选项合并与正整数、阈值关系校验。
7. 测试默认值、合法覆盖、零值、负数、小数和关系冲突。

**验证：**

```bash
pnpm exec tsx --test src/context/constants.test.ts
```

期望：默认值与所有非法配置用例通过，测试不创建文件。

## T2：扩展 Provider、消息和配置类型

**文件：** `src/provider/types.ts`、`src/config/types.ts`、`src/provider/openai.ts`、`src/provider/anthropic.ts`、`src/agent/stream-collector.test.ts`、`src/agent/loop.test.ts`、`src/chat/manager.test.ts`

**依赖：** T1

**步骤：**

1. 为 `ProviderRequest` 增加可选 `maxOutputTokens`。
2. 为 `LLMProvider` 增加 `contextWindow` 和 `contextWindowIsDefault`。
3. 为 instruction 消息增加 `instructionKind`，为 tool 消息增加 `contextReference`。
4. 为 `ProviderConfig` 增加可选 `context_window`。
5. 在 OpenAIProvider 和 AnthropicProvider 中先补齐窗口属性，使用显式配置或 128K 默认值。
6. 更新现有 Fake Provider 和对象字面量，统一使用测试窗口并标记为显式值。
7. 确认 Provider 请求测试辅助函数不因可选字段改变现有默认请求。

**验证：**

```bash
pnpm typecheck
```

期望：新增接口完成后，仓库内所有 Provider 测试替身均满足类型约束。

## T3：校验 Provider 上下文窗口配置

**文件：** `src/config/loader.ts`、`src/config/loader.test.ts`

**依赖：** T2

**步骤：**

1. 在单 Provider 校验中允许缺失 `context_window`。
2. 显式值存在时要求为正整数，错误信息包含 Provider 名称和字段名。
3. 保持加载结果中的缺失值为 `undefined`，不在 loader 内打印默认窗口提示。
4. 使用临时 YAML 测试显式 128K、缺省、零、负数、小数和字符串。
5. 验证新增字段不影响环境变量展开、默认 Provider 和重复名称检查。

**验证：**

```bash
pnpm exec tsx --test src/config/loader.test.ts
```

期望：合法窗口正常加载，非法窗口均在启动配置阶段失败。

## T4：接入 OpenAI 上下文能力

**文件：** `src/provider/openai.ts`、`src/provider/openai.test.ts`

**依赖：** T2、T3

**步骤：**

1. 为显式窗口和 128K 默认窗口补充请求级测试，确认 T2 的属性赋值正确。
2. `maxOutputTokens` 存在时发送 `max_tokens`，普通请求不增加该字段。
3. 保持现有系统提示、工具缓存和 DeepSeek usage 字段解析不变。
4. 验证 instruction/tool 内部元数据不会进入 HTTP 请求体。
5. 测试显式窗口、默认窗口、普通请求和摘要请求映射。

**验证：**

```bash
pnpm exec tsx --test src/provider/openai.test.ts
```

期望：OpenAI 和 DeepSeek 兼容测试全部通过，稳定请求字段没有回归。

## T5：接入 Anthropic 上下文能力

**文件：** `src/provider/anthropic.ts`、`src/provider/anthropic.test.ts`

**依赖：** T2、T3

**步骤：**

1. 为显式窗口和 128K 默认窗口补充请求级测试，确认 T2 的属性赋值正确。
2. 将 `max_tokens` 改为 `request.maxOutputTokens ?? 4096`。
3. 保持 System Prompt 缓存、最后一个工具缓存和 usage 归一化不变。
4. 验证 instruction/tool 内部元数据不会进入请求体。
5. 测试显式窗口、默认窗口、普通请求和摘要请求映射。

**验证：**

```bash
pnpm exec tsx --test src/provider/anthropic.test.ts
```

期望：Anthropic 协议映射和缓存 usage 测试全部通过。

## T6：实现基础字符和完整请求估算

**文件：** `src/context/token-estimator.ts`、`src/context/token-estimator.test.ts`

**依赖：** T1、T2

**步骤：**

1. 实现 ASCII、非 ASCII、结构开销和 1.1 系数的确定性估算。
2. 对消息只序列化 Provider 可见字段，忽略内部元数据。
3. 使用稳定 JSON 序列化工具定义和工具调用参数。
4. 实现无锚点时的完整 ProviderRequest 估算。
5. 测试英文、中文、混合代码、JSON、空消息、工具定义和内部元数据忽略。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='完整估算|字符估算' src/context/token-estimator.test.ts
```

期望：相同输入结果稳定，中文不会按 ASCII 比例明显低估。

## T7：实现 usage 锚点和后缀增量估算

**文件：** `src/context/token-estimator.ts`、`src/context/token-estimator.test.ts`

**依赖：** T6

**步骤：**

1. 记录实际正常请求、输入 usage、稳定部分哈希和消息分项估算。
2. 比较 System Prompt 与工具哈希，不一致时回退全量估算。
3. 查找消息最长公共前缀并计算新旧后缀差值。
4. 非正 usage 不建立锚点；估算结果限制为非负整数。
5. 实现 `invalidate()` 和 `reset()`。
6. 测试追加消息、替换尾部、轻量替换旧消息、稳定字段变化和 usage 缺失。

**验证：**

```bash
pnpm exec tsx --test src/context/token-estimator.test.ts
```

期望：可兼容请求使用 `api_anchor`，不兼容请求使用 `full_estimate`。

## T8：建立项目内会话存储目录

**文件：** `src/context/tool-result-store.ts`、`src/context/tool-result-store.test.ts`

**依赖：** T1

**步骤：**

1. 保存项目真实根目录并惰性生成随机会话标识。
2. 创建 `.bettercode/context/session-<uuid>/tool-results/`，逐层拒绝符号链接。
3. 设置目录权限 `0700`，返回项目内 POSIX 相对路径。
4. 生成不包含参数和正文的稳定文件名。
5. 测试未写入时无目录、正常目录位置、不同实例会话隔离和符号链接拒绝。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='目录|符号链接|会话' src/context/tool-result-store.test.ts
```

期望：所有目录位于项目根内，符号链接场景不产生项目外文件。

## T9：实现批量原子写入和哈希

**文件：** `src/context/tool-result-store.ts`、`src/context/tool-result-store.test.ts`

**依赖：** T8

**步骤：**

1. 计算原正文 UTF-8 字节数和 SHA-256。
2. 使用排他、拒绝符号链接的标志创建 `0600` 临时文件。
3. 写入、同步、关闭后重命名为最终 `.json` 文件。
4. 批量中任一写入或提交失败时清理本批次所有文件。
5. 取消时停止后续写入并执行同样回滚。
6. 测试多文件成功、内容逐字一致、权限、哈希、故障注入和取消。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='写入|回滚|取消|哈希' src/context/tool-result-store.test.ts
```

期望：成功批次全部可读，失败批次没有半写文件或成品残留。

## T10：实现存储清理与幂等关闭

**文件：** `src/context/tool-result-store.ts`、`src/context/tool-result-store.test.ts`

**依赖：** T9

**步骤：**

1. `clear()` 删除当前会话目录并允许后续惰性创建新会话。
2. `close()` 删除当前会话目录并拒绝新写入。
3. 多次 `clear()`、`close()` 和无目录清理均不报错。
4. 保证只删除当前会话目录，不删除 `.bettercode` 其他文件和其他会话。
5. 测试清理边界、二次关闭和关闭后写入拒绝。

**验证：**

```bash
pnpm exec tsx --test src/context/tool-result-store.test.ts
```

期望：生命周期测试全部通过，其他 `.bettercode` 内容保持不变。

## T11：识别并校验历史原子组

**文件：** `src/context/history-planner.ts`、`src/context/history-planner.test.ts`

**依赖：** T1、T6

**步骤：**

1. 将普通消息转换为单消息 `HistoryUnit`。
2. 将带 toolCalls 的 assistant 与后续结果转换为一个 `tool_batch`。
3. 校验结果数量、调用标识、顺序、重复和孤立 tool 消息。
4. 计算每个单元的原始消息数和近似 Token。
5. 导出供轻量压缩器复用的批次分组辅助函数。
6. 测试单工具、多工具、混合文本、缺结果、乱序、重复和孤立结果。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='工具|原子|配对' src/context/history-planner.test.ts
```

期望：合法历史稳定分组，任何不完整工具协议历史均明确失败。

## T12：实现近期历史双条件选择

**文件：** `src/context/history-planner.ts`、`src/context/history-planner.test.ts`

**依赖：** T11

**步骤：**

1. 从历史尾部按原子组向前累计。
2. 直到近期内容同时达到 Token 目标和最少消息数。
3. 工具批次整体计入，不在边界拆分。
4. 生成摘要资料、较早用户消息和近期消息三部分。
5. 没有可替换旧非用户消息时返回无计划。
6. 测试 Token 先满足、消息数先满足、工具组跨边界、短历史和纯用户历史。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='近期|边界|计划' src/context/history-planner.test.ts
```

期望：近期历史始终同时满足两个最低条件，除非整个历史本就更短。

## T13：实现摘要历史写回与保真校验

**文件：** `src/context/history-planner.ts`、`src/context/history-planner.test.ts`

**依赖：** T12

**步骤：**

1. 从较早区间移除旧摘要、旧边界和 runtime 指令。
2. 逐字、原序保留所有较早用户消息。
3. 按“较早用户 -> 新摘要 -> 新边界 -> 近期原文”生成副本。
4. 验证全部用户消息内容与顺序不变。
5. 验证工具配对完整，且上下文摘要和边界各只有一个。
6. 测试再次压缩旧摘要、带格式用户消息、近期工具组和故意构造的非法写回。

**验证：**

```bash
pnpm exec tsx --test src/context/history-planner.test.ts
```

期望：用户消息逐字一致，重复摘要被合并，历史协议保持合法。

## T14：构造隔离的摘要 Prompt

**文件：** `src/context/summary-prompt.ts`、`src/context/summary-prompt.test.ts`

**依赖：** T1、T2

**步骤：**

1. 定义稳定摘要 System Prompt，明确工具禁用、资料不可信、先草稿后摘要和禁止虚构。
2. 每次生成随机 nonce。
3. 将消息索引、角色、文本、工具调用和结果字段编码为稳定 JSONL。
4. 构造 `tools: []`、`maxOutputTokens` 明确的 ProviderRequest。
5. 验证工具正文中的标签、命令和提示注入只位于资料块。
6. 测试 nonce 每次不同、工具列表为空、固定指令完整和资料顺序稳定。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='构造|资料|工具|nonce' src/context/summary-prompt.test.ts
```

期望：摘要请求不携带工具，历史正文不能改变摘要任务边界。

## T15：解析草稿、正式摘要和边界消息

**文件：** `src/context/summary-prompt.ts`、`src/context/summary-prompt.test.ts`

**依赖：** T14

**步骤：**

1. 按 nonce 精确提取草稿和正式摘要标签。
2. 要求草稿在前、两段均非空、正式摘要只出现一次。
3. 校验七个固定二级标题按顺序存在，空部分允许“无”。
4. 正式写回文本移除临时标签。
5. 构造 `context_summary` instruction 消息和 `context_boundary` 提醒消息。
6. 边界文本明确要求重读项目文件或落盘路径并禁止脑补。
7. 测试缺段、乱序、错误 nonce、重复摘要、缺标题和合法响应。

**验证：**

```bash
pnpm exec tsx --test src/context/summary-prompt.test.ts
```

期望：只有完整、顺序正确的响应能产出正式摘要消息。

## T16：实现摘要流成功路径

**文件：** `src/context/summarizer.ts`、`src/context/summarizer.test.ts`

**依赖：** T7、T14、T15

**步骤：**

1. 发送摘要前使用完整估算检查输入容量。
2. 手动摘要使用窗口减 3K 上限，自动摘要保留输出空间。
3. 直接调用 Provider，局部累计 `text_delta`。
4. 丢弃 `thinking_delta`，不发到 ContextEvent 或日志。
5. 要求流出现 `done`，再调用正式解析器。
6. 返回仅含正式摘要和资料消息数的结果。
7. 测试分片文本、thinking、usage、done 和合法摘要。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='成功|thinking|usage|容量' src/context/summarizer.test.ts
```

期望：正式摘要可用，草稿、thinking 和摘要 usage 不对外暴露。

## T17：实现摘要失败、取消和工具防护

**文件：** `src/context/summarizer.ts`、`src/context/summarizer.test.ts`

**依赖：** T16

**步骤：**

1. 捕获 Provider 抛错和 `error` 事件并返回分类失败。
2. 流未出现 `done` 时判定提前结束。
3. 收到任意 `tool_call` 时判定失败，且不执行、不转发调用。
4. AbortSignal 取消时丢弃所有已收集文本并返回取消。
5. 格式解析失败保留明确原因，但不包含完整历史正文。
6. 测试网络错误、流错、缺 done、意外工具调用、取消和非法格式。

**验证：**

```bash
pnpm exec tsx --test src/context/summarizer.test.ts
```

期望：失败路径均不返回部分摘要，Provider 工具调用次数保持零。

## T18：实现单个工具结果落盘选择

**文件：** `src/context/lightweight-compactor.ts`、`src/context/lightweight-compactor.test.ts`

**依赖：** T7、T9、T11

**步骤：**

1. 扫描合法历史中的未落盘工具消息。
2. 选择估算值严格超过单结果阈值的消息。
3. 为固定元数据预留 Token，生成头尾有界预览。
4. 批量调用结果存储器，成功后替换历史副本。
5. 占位写入工具名、调用标识、路径、字节数、估算值和 SHA-256。
6. 保留 role、toolCallId、toolName 和 isError 不变。
7. 测试阈值上下边界、成功与错误结果、UTF-8 预览和元数据完整性。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='单个|预览|元数据' src/context/lightweight-compactor.test.ts
```

期望：超限正文完整存盘，占位受限且协议字段不变。

## T19：实现工具批次合计压缩

**文件：** `src/context/lightweight-compactor.ts`、`src/context/lightweight-compactor.test.ts`

**依赖：** T18

**步骤：**

1. 按 assistant toolCalls 建立同轮结果批次。
2. 单结果处理后重新计算批次占位与正文合计。
3. 超限时按原始估算降序选择，体积相同按原调用顺序。
4. 每替换一个候选后重新计算，达到上限立即停止。
5. 保持历史消息和调用结果顺序不变。
6. 测试多个大小、相同大小、已有落盘占位和多个独立批次。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='批次|排序|合计' src/context/lightweight-compactor.test.ts
```

期望：只落盘必要的大结果，替换后的每批合计不超过阈值。

## T20：保证轻量压缩幂等和失败保真

**文件：** `src/context/lightweight-compactor.ts`、`src/context/lightweight-compactor.test.ts`

**依赖：** T19

**步骤：**

1. 遇到 `contextReference` 时禁止重复落盘和再次缩短预览。
2. 存储器失败时返回原历史内容和可诊断原因。
3. 批量中途取消时不写入任何占位引用。
4. 验证输入历史对象和消息对象未被原地修改。
5. 测试连续运行两次、存储失败、取消和输入不可变性。

**验证：**

```bash
pnpm exec tsx --test src/context/lightweight-compactor.test.ts
```

期望：第二次处理零新增文件；失败或取消时历史逐项等于原输入。

## T21：编排轻量处理和低于阈值请求

**文件：** `src/context/manager.ts`、`src/context/manager.test.ts`

**依赖：** T7、T10、T13、T17、T20

**步骤：**

1. 构造并持有五个上下文子组件和会话状态。
2. 将历史、runtimeMessages、稳定提示和工具定义组装为完整请求。
3. 依次发出轻量、估算进度事件。
4. 自动估算低于窗口减 13K 时直接返回 `ready`。
5. 轻量存储失败但请求仍安全时返回原正文请求并报告可恢复诊断。
6. 实现正常请求 `recordUsage()`，忽略缺失或非正输入 usage。
7. 测试调用顺序、事件、请求内容、落盘数和锚点更新。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='轻量|低于|usage' src/context/manager.test.ts
```

期望：低于自动线不调用摘要 Provider，返回请求可直接发送。

## T22：编排自动重量摘要与历史写回

**文件：** `src/context/manager.ts`、`src/context/manager.test.ts`

**依赖：** T21

**步骤：**

1. 自动估算达到窗口减 13K 时创建压缩计划。
2. 无计划时返回容量或无可压缩错误，不调用正常 Provider。
3. 调用摘要器，成功后应用并校验新历史。
4. 清除旧 usage 锚点并对新完整请求全量重估。
5. 发出摘要开始和成功事件，包含前后估算与覆盖消息数。
6. 压缩后仍超自动线时保留新历史并返回容量不足，不发起第二次摘要。
7. 测试临界值、正常成功、用户消息保留和压后仍超限。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='自动|摘要成功|仍超限' src/context/manager.test.ts
```

期望：每次 manage 最多执行一次摘要，成功历史只含一个摘要和边界。

## T23：实现摘要失败计数和三次熔断

**文件：** `src/context/manager.ts`、`src/context/manager.test.ts`

**依赖：** T22

**步骤：**

1. 流错、格式错和历史校验失败时增加连续失败计数。
2. 前两次失败保留轻量处理后历史并阻止正常请求。
3. 第三次失败打开会话熔断。
4. 熔断后的自动触发直接返回 `CONTEXT_CIRCUIT_OPEN`，不调用摘要器。
5. 成功摘要清零计数并关闭熔断。
6. 用户取消、无计划和轻量失败不增加摘要失败计数。
7. 测试三次失败、第四次零调用、取消和成功重置。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='失败|熔断|取消|重置' src/context/manager.test.ts
```

期望：自动摘要请求次数严格受熔断限制，计数语义与 spec 一致。

## T24：实现手动压缩、事务锁和生命周期

**文件：** `src/context/manager.ts`、`src/context/manager.test.ts`

**依赖：** T23

**步骤：**

1. 手动路径忽略自动触发线，存在计划就尝试摘要。
2. 手动路径在熔断打开时仍允许一次明确重试。
3. 手动成功后清零失败和熔断；失败时保持熔断状态。
4. 使用 Promise 锁串行化 manage、clear 和 close。
5. 等锁期间取消时不执行过期事务。
6. `clear()` 重置锚点、状态和存储；`close()` 幂等并拒绝新事务。
7. 测试低用量手动压缩、3K 上限、熔断恢复、并发、清理和关闭。

**验证：**

```bash
pnpm exec tsx --test src/context/manager.test.ts
```

期望：自动与手动共享同一状态，任何并发路径都不覆盖较新历史。

## T25：扩展 Agent 事件和请求构造

**文件：** `src/agent/types.ts`、`src/agent/loop.ts`、`src/agent/loop.test.ts`

**依赖：** T2、T24

**步骤：**

1. 将 `ContextEvent` 并入 `AgentEvent`。
2. 为停止原因增加 `context_error`。
3. AgentLoop 构造函数接收共享 ContextManager。
4. 抽取本轮请求构造，分离持久 history 与 runtimeMessages。
5. runtime reminder 消息附加 `instructionKind: 'runtime'`。
6. 保持 Plan Mode 只读工具选择和稳定 System Prompt 不变。
7. 更新测试构造器并验证 Act/Plan 请求字段和提醒类型。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='请求|Plan|提醒' src/agent/loop.test.ts
```

期望：原 Agent 请求结构不变，仅新增内部提醒类型和上下文入口依赖。

## T26：在 Agent 每轮请求前接入自动管理

**文件：** `src/agent/loop.ts`、`src/agent/loop.test.ts`

**依赖：** T25

**步骤：**

1. 每轮 collector 前调用 `manage(trigger='automatic')`。
2. `ready` 时替换循环局部历史并发送返回请求。
3. 正常响应 usage 使用该轮实际请求更新锚点。
4. 工具结果仍先追加，下一轮才触发轻量处理。
5. 转发所有 ContextEvent，保持原工具和进度事件顺序。
6. 测试第一轮无工具、第二轮大工具结果、Plan Mode 和 usage 锚定。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='上下文|工具结果|usage' src/agent/loop.test.ts
```

期望：同一次 Agent Loop 的下一轮 Provider 已收到处理后的工具结果。

## T27：处理 Agent 上下文阻断和手动入口

**文件：** `src/agent/loop.ts`、`src/agent/loop.test.ts`

**依赖：** T26

**步骤：**

1. `blocked` 时以 `context_error` 停止，不调用正常模型。
2. `cancelled` 时使用现有取消停止原因。
3. AgentOutcome 保留 ContextManager 返回的最新合法历史。
4. 实现 `compactHistory()`，使用 Act Mode 全工具与新鲜 runtime reminder。
5. 手动入口只调用上下文管理，不进入模型 Agent Loop 或工具调度。
6. 测试摘要失败、容量不足、取消、手动成功和正常 Provider 零调用。

**验证：**

```bash
pnpm exec tsx --test src/agent/loop.test.ts
```

期望：上下文失败与模型流失败可区分，手动压缩不会执行任务。

## T28：接入 ChatManager 手动压缩

**文件：** `src/chat/manager.ts`、`src/chat/manager.test.ts`

**依赖：** T27

**步骤：**

1. 扩展构造选项，创建单个 ContextManager 并注入 AgentLoop。
2. 实现 `compact(provider, signal)` 异步事件流。
3. 复用 `active` 锁拒绝 Agent 与手动压缩并发。
4. 手动 ready 时更新历史；skipped、blocked 和 cancelled 使用返回历史。
5. 不追加用户消息，不增加 turnCount，不修改 latestPlan。
6. 测试空历史、成功、无可压缩内容、Agent 运行中拒绝和计划保留。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='compact|压缩|并发|计划' src/chat/manager.test.ts
```

期望：手动压缩是会话操作，不被记录成业务对话。

## T29：接入 ChatManager 清理与关闭

**文件：** `src/chat/manager.ts`、`src/chat/manager.test.ts`

**依赖：** T28

**步骤：**

1. 将 `clear()` 改为异步并要求 Agent 空闲。
2. 清理上下文后再清空历史、计划、会话权限。
3. 实现幂等 `close()`，关闭后拒绝新 run 和 compact。
4. 保证清理失败转成可诊断错误，不留下部分 Chat 状态。
5. 更新现有 `/clear` 相关测试调用为 await。
6. 测试上下文文件清理、状态重置、二次关闭和关闭后调用。

**验证：**

```bash
pnpm exec tsx --test src/chat/manager.test.ts
```

期望：ChatManager 生命周期与 ContextManager 一致，现有会话权限清理不回退。

## T30：接入 TUI 命令和上下文事件

**文件：** `src/ui/app.tsx`、`src/ui/app.test.ts`

**依赖：** T29

**步骤：**

1. 帮助文本增加 `/compact`。
2. Provider 使用默认窗口时显示一次不含敏感信息的配置提示。
3. `/compact` 创建 AbortController、消费事件流且不追加用户 DisplayMessage。
4. 格式化四类上下文事件；自动路径更新进度，手动成功追加结果消息。
5. 手动结果显示前后估算、覆盖消息数、落盘数和熔断状态。
6. `context_error` 增加独立停止文案。
7. `/clear` 等待 ChatManager 清理完成后再清 UI 状态。
8. 测试帮助、默认窗口提示、手动成功、失败、无内容和草稿不可见。

**验证：**

```bash
pnpm exec tsx --test src/ui/app.test.ts
```

期望：界面只显示可行动摘要信息，不显示草稿或完整工具结果。

## T31：接入退出清理、忽略目录和用户文档

**文件：** `src/index.tsx`、`.gitignore`、`config.yaml`、`README.md`

**依赖：** T3、T5、T29、T30

**步骤：**

1. 将 ChatManager 提升到 `finally` 可访问作用域。
2. TUI 退出后先关闭 ChatManager，再关闭 MCP Manager。
3. 分别捕获两类关闭错误，使用中文诊断且互不阻断。
4. `.gitignore` 精确增加 `.bettercode/context/`。
5. 为示例 Provider 添加正确的 `context_window`，不改动任何密钥值。
6. README 增加配置字段、默认 128K 提示、两层压缩和 `/compact` 说明。
7. 检查文档产品名统一为 BetterCode。

**验证：**

```bash
pnpm typecheck
git diff --check
```

期望：入口类型正确，忽略规则不覆盖 MCP/权限配置，文档无尾随空格。

## T32：增加轻量压缩端到端测试

**文件：** `src/context/integration.test.ts`

**依赖：** T26、T29

**步骤：**

1. 创建临时项目、受控 ToolRegistry、PermissionManager 和 Fake Provider。
2. 第一轮让模型调用返回大结果的测试工具。
3. 第二轮捕获 ProviderRequest，验证工具消息已替换为占位。
4. 读取占位相对路径，验证文件正文等于 Agent 实际收到的完整序列化结果。
5. 验证工具调用标识、错误状态、稳定提示和工具定义未改变。
6. 关闭 ChatManager 后验证当前会话目录清理。

**验证：**

```bash
pnpm exec tsx --test --test-name-pattern='轻量' src/context/integration.test.ts
```

期望：真实 Agent 两轮流程完成，落盘、回灌和清理形成闭环。

## T33：增加重量摘要和熔断端到端测试

**文件：** `src/context/integration.test.ts`

**依赖：** T23、T27、T32

**步骤：**

1. 使用小窗口和小近期阈值构造较长历史。
2. Fake Provider 区分摘要请求和正常请求，并返回带 nonce 的合法摘要。
3. 验证摘要请求工具列表为空、草稿不进入历史、正常请求在摘要成功后才发生。
4. 验证全部用户消息逐字保留、近期工具组完整、摘要边界存在。
5. 连续制造三次非法摘要，验证第四次自动触发不再调用摘要 Provider。
6. 执行手动 compact 成功，验证熔断清零且不增加用户轮次。

**验证：**

```bash
pnpm exec tsx --test src/context/integration.test.ts
```

期望：重量压缩、失败阻断、熔断和人工恢复全部可离线复现。

## T34：执行全量回归和安全扫描

**文件：** 全部本章改动文件

**依赖：** T1-T33

**步骤：**

1. 运行 TypeScript 类型检查和全部测试。
2. 重复运行上下文集成测试三次，排查随机 nonce、临时目录和并发不稳定。
3. 运行 Git 空白检查。
4. 扫描 TODO、TBD、旧产品名、英文新增源码注释和落盘目录误跟踪。
5. 扫描测试，确认没有真实 API 地址调用、真实 Token 或公网 MCP Server。
6. 检查 `git status`，确认只有任务范围内文件变更。
7. 记录实际测试数量和命令输出，供 checklist 验收阶段使用。

**验证：**

```bash
pnpm check
pnpm exec tsx --test src/context/integration.test.ts
pnpm exec tsx --test src/context/integration.test.ts
pnpm exec tsx --test src/context/integration.test.ts
git diff --check
git status --short
```

期望：全部命令通过，无不稳定测试、敏感值、旧产品名或项目外上下文文件。

## 执行顺序

```text
T1 -> T2 -> T3 -> T4
              \-> T5

T1/T2 -> T6 -> T7
T1    -> T8 -> T9 -> T10
T1/T6 -> T11 -> T12 -> T13
T1/T2 -> T14 -> T15 -> T16 -> T17

T7/T9/T11 -> T18 -> T19 -> T20
T7/T10/T13/T17/T20 -> T21 -> T22 -> T23 -> T24
T24 -> T25 -> T26 -> T27 -> T28 -> T29 -> T30 -> T31
T26/T29 -> T32 -> T33 -> T34
```

T4 与 T5 可并行；T8-T10、T11-T13、T14-T17 在基础类型完成后也可并行。Agent、Chat 和 UI 集成必须等待 ContextManager 行为稳定后再开始。

## Plan 覆盖检查

| Plan 组件 | 对应任务 |
|-----------|----------|
| Provider 上下文能力 | T2-T5 |
| TokenEstimator | T6-T7 |
| ToolResultStore | T8-T10 |
| HistoryPlanner | T11-T13 |
| Summary Prompt 与边界 | T14-T15 |
| ContextSummarizer | T16-T17 |
| LightweightCompactor | T18-T20 |
| ContextManager | T21-T24 |
| Agent Loop 集成 | T25-T27 |
| ChatManager 生命周期 | T28-T29 |
| TUI 与启动清理 | T30-T31 |
| 端到端与回归 | T32-T34 |
