# BetterCode 动态命令面板 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|---|---|---|
| 修改 | `src/command/types.ts` | CommandCompletion 增加 aliases |
| 修改 | `src/command/registry.ts` | complete 填充 aliases |
| 修改 | `src/ui/input-box.tsx` | 自动面板、键盘交互与渲染 |
| 修改 | `src/command/registry.test.ts` | aliases 断言 |
| 修改 | `src/ui/input-box.test.ts` | 渲染与交互测试 |
| 修改 | `skills/mew-spec/SKILL.md` | 中文短描述 |
| 新建 | `docs/command-menu/*.md` | 四份文档 |

## T1：候选结构增加别名

**文件：** `src/command/types.ts`、`src/command/registry.ts`、`src/command/registry.test.ts`

1. CommandCompletion 增加 `aliases: readonly string[]`。
2. `complete()` 返回项携带 `[...definition.aliases]`。
3. 测试断言候选包含别名。

**验证：** `pnpm exec tsx --test src/command/registry.test.ts`。

## T2：输入框自动面板

**文件：** `src/ui/input-box.tsx`、`src/ui/input-box.test.ts`

1. 输入字符/删除键后调用 `complete(next)` 更新候选。
2. 方向键历史导航后同步刷新候选。
3. 渲染未聚焦行短描述、聚焦行完整描述（wrap 换行），候选上限窄屏 4/其他 8。
4. 测试：`/` 出现面板、`/pe` 过滤、聚焦完整描述、宽度不越界。

**验证：** `pnpm exec tsx --test src/ui/input-box.test.ts`。

## T3：键盘交互

**文件：** `src/ui/input-box.tsx`、`src/ui/input-box.test.ts`

1. Enter：`exactCommandMatch` 为真直接 onSubmit；否则写入候选 value 并收起。
2. Tab 单候选补全、多候选进入面板；Esc 收起。
3. 测试覆盖 Enter/Tab/Esc/ASCII。

**验证：** InputBox 专项测试。

## T4：Skill 中文短描述

**文件：** `skills/mew-spec/SKILL.md`

1. description 改为中文短句。

**验证：** `rg -n "^description:" skills -g '*.md'` 全部为中文短句。

## T5：全量验收与中文提交

1. `pnpm check`。
2. App 集成测试确认 `/help` 直接执行。
3. `git diff --check`。
4. 创建中文提交。
