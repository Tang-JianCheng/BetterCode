# BetterCode 项目开发指南

BetterCode 是一个终端 AI 编程助手（类 Claude Code）：TypeScript + Ink 5 / React 18，Node ESM + `tsx` 运行，包管理用 `pnpm`。模块架构与完成状态见 `docs/context-summary.md`，接手前先读它。

## 常用命令

- `pnpm start` 启动；`pnpm start --provider <name>` 指定供应商启动
- `pnpm check` 全量验证（= `pnpm typecheck` + `pnpm test`），改动前后各跑一次
- 单跑某个测试文件：`pnpm exec tsx --test src/<模块>/<文件>.test.ts`（Node 内置 test runner，无 jest/vitest）
- 仓库没有 lint / format 配置，不要去找 eslint/prettier；配合 `git diff --check` 检查

## 提交与代码约束

1. 代码注释必须用中文，Git 提交信息必须用中文
2. 系统统一叫 BetterCode；MewCode 是旧名残留，不要全局重命名
3. 每完成一个大型 Plan，提交一次 Git 作为阶段性检查点；未被明确要求时不主动提交
4. `config.yaml` 用 `${ENV}` 展开密钥，禁止硬编码 API Key（历史上出过硬编码事故）

## 规格文档约束

1. 新开始的功能、模块或系统性优化，必须在 `docs/<主题>/` 下创建 `spec.md`、`plan.md`、`task.md`、`checklist.md` 四份文档
2. 已有功能的补充、兼容或局部优化，不新建重复文档，应在对应的四份原文档中按增量章节补充
3. 四份文档应直接写入仓库供用户统一查阅，不要把完整文档拆成多段消息逐段确认
4. 四份文档完成并经用户统一确认后，再进入实现阶段

## 交互式命令约束

1. 涉及候选列表的交互命令（如 `/session`、`/model`）必须实现为动态命令面板：方向键选择、Enter 确认、Esc 退出
2. 面板内命令或名称左对齐，说明或描述右对齐；选中项命令和描述整行高亮
3. 描述保持简短，超过宽度时选中项可展开；候选超过一页时支持滚动并显示剩余数量
4. 面板渲染必须流畅，与普通文本区分，体现动态交互内容

## 工程注意事项

- ESM + `moduleResolution: NodeNext`：新建文件时相对导入必须带 `.js` 后缀（如 `import { x } from './foo.js'`）
- 入口是 `src/index.tsx`；测试文件与源码同目录，命名 `*.test.ts`
- 启动时记忆系统会把 AGENTS.md 连同 `BETTERCODE.md`、`.bettercode/INSTRUCTIONS.md`、`BETTERCODE.local.md` 注入对话，保持本文件精简
- `.bettercode/` 下运行时目录（sessions、context、memory、logs、worktrees、prompt_history.jsonl、permissions.local.yaml、hooks.local.yaml 等）已 gitignore，不要提交
- 系统文档的 checklist 状态不等于实现状态（部分模块代码和测试已存在但 checklist 未勾选），以 `src/` 代码、`pnpm check` 和 git 提交为准
- README 等说明文档局部偏旧（如终端界面一节还写“小码”品牌区），模块行为一律以 `src/` 实现为准

## LLM与用户对话约束
用户在开发BetterCode的时候，与opencode对话，opencode应该以中文回复用户，并在重要的任务完成之后，以中文做一段总结