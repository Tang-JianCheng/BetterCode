# BetterCode 动态命令面板 Plan

## 架构概览

改造集中在输入框 `src/ui/input-box.tsx`：输入变化时立即用 `complete()` 计算候选并保存到 state；渲染层根据候选生成面板。命令注册中心 `complete()` 增加 `aliases` 字段用于 Enter 精确匹配；命令描述保持中文短句。

```text
用户输入字符/删除键
  -> complete(nextInput)
  -> completionItems + completionIndex
  -> 面板渲染（短描述 / 聚焦完整描述换行）
Tab/Enter/Esc/方向键
  -> resolveCompletion / exactCommandMatch / moveCompletionIndex / navigateHistory
```

## 数据结构

CommandCompletion 增加 aliases：

```typescript
export interface CommandCompletion {
  name: string;
  aliases: readonly string[];
  value: string;
  label: string;
  description: string;
}
```

## 模块设计

### src/command/registry.ts（增量）

`complete()` 返回项附带 `aliases`，供输入框判断输入是否与候选完全一致。

### src/ui/input-box.tsx（主改造）

- 输入字符与删除键：用 `complete(next)` 更新 `completionItems` 与 `completionIndex`。
- Tab：沿用 `resolveCompletion`。
- Enter：`exactCommandMatch(input, selected)` 为真时直接 `onSubmit`；否则写入 `selected.value` 并收起面板。
- Esc：收起面板。
- 方向键：面板打开时移动焦点；否则历史导航，并同步用 `complete(next.input)` 刷新候选。
- 渲染：未聚焦行 `标记 + label + 短描述`；聚焦行 `标记 + label` 并在下方用 `wrap="wrap"` 展示完整描述；宽度受 `capabilities.columns` 约束。

### skills/mew-spec/SKILL.md（增量）

description 改为中文短句，保证仓库内 Skill 描述符合“中文且简短”。

## 模块交互

1. App 继续传 `complete={input => commandRegistry.complete(input)}`。
2. InputBox 每次输入变化调用 complete 并持有候选。
3. Enter 命中完整命令时走既有 `onSubmit` -> CommandDispatcher。
4. 面板渲染完全在 InputBox 内部，不进入消息历史。

## 测试策略

- 注册中心测试：候选携带 aliases。
- InputBox 渲染测试（ink-testing-library）：
  - `/` 出现面板、`/pe` 过滤；
  - 聚焦项完整描述换行、未聚焦项短描述；
  - Enter 完整命令直接执行、部分输入选中候选；
  - Tab 单候选补全；
  - Esc 收起；
  - ASCII 无 Unicode 装饰。
- App 集成测试：`/help` + Enter 仍直接显示帮助面板。

## 增量：面板下沉与整行高亮

### 渲染结构调整

- 输入框在提示行下追加与顶部相同的边框，形成闭合输入框。
- 边框、候选行和完整描述区的宽度统一使用 `capabilities.columns - 2`（应用层左右各 1 列内边距），防止 120 列等场景下边框折行。

### 候选行排版

- 每行由「标记 + 固定宽命令名列 + 两空格 + 截断描述」组成，命令名与描述始终同行。
- 聚焦行把整行放进同一个 `Text`，通过 `inverse` 同时高亮命令名与描述；完整描述在聚焦行下方以缩进 `wrap` 形式补充展示。
- 命令名列宽取候选最大宽度与内容宽度 45% 的较小值，描述列宽为剩余宽度，均不小于 8。

### capabilities.ts 增量

`padDisplay` 增加可选的省略号参数，供 ASCII 模式使用 `...` 而不是 `…`。
