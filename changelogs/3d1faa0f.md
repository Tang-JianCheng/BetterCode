# 3d1faa0f

- **提交时间**：2026-07-30 13:20:48
- **提交类型**：feat
- **提交分支**：main

## 修改摘要

为 BetterCode 增加完整的 Skill 系统：支持项目、用户和内置三级发现覆盖，以 YAML frontmatter 和 Markdown SOP 定义共享或独立 Skill，并通过 `load_skill` 完成两阶段加载。系统可按 Skill 白名单动态收窄 Agent 工具视图，加载目录型 Skill 的 Node.js 专属工具，隔离执行指定 Provider 和最近消息历史，同时将独立结果摘要安全回流主会话；斜杠命令、状态展示、热更新、清空生命周期和内置 commit、review、test 样板均已接入。四份设计与验收文档同步落库，全量 241 项自动化测试通过。

## 影响文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `docs/skill-system/*.md` | 新增 | 记录 Skill 系统需求、技术设计、任务拆解和完整验收证据 |
| `src/skill/types.ts`、`src/skill/parser.ts` | 新增 | 定义 Skill 领域契约，解析严格 frontmatter 并渲染参数化 SOP |
| `src/skill/loader.ts`、`src/skill/tool-loader.ts` | 新增 | 实现三级目录发现、覆盖、损坏遮蔽和目录型专属工具加载 |
| `src/skill/manager.ts`、`src/skill/load-tool.ts` | 新增 | 管理原子快照、共享激活、白名单、热更新和系统加载工具 |
| `src/skill/runner.ts`、`src/skill/script-tool.ts` | 新增 | 实现独立 Agent、历史截取、Provider 选择和 Node.js 工具进程适配 |
| `src/skill/*.test.ts` | 新增 | 覆盖解析、发现、热更新、专属工具及共享和独立执行流程 |
| `src/tool/registry.ts`、`src/agent/*` | 修改 | 增加 owner/system 元数据、动态工具视图和执行前白名单二次校验 |
| `src/prompt/*`、`src/chat/manager.ts` | 修改 | 注入可用及激活 Skill 内容，接入执行、摘要回流和会话生命周期 |
| `src/command/*`、`src/ui/app.tsx` | 修改 | 动态生成 Skill 命令和补全，展示激活状态并迁移 review 命令 |
| `src/index.tsx` | 修改 | 按 MCP、Skill、权限、聊天顺序装配并缓存按名称解析的 Provider |
| `skills/commit/SKILL.md`、`skills/review/SKILL.md`、`skills/test/SKILL.md` | 新增 | 提供提交、审查和测试三个内置 Skill 样板 |
| `skills/mew-spec/SKILL.md` | 修改 | 补充 Skill 系统所需的工具白名单与共享执行模式元数据 |
| `README.md` | 修改 | 增加 Skill 目录、格式、执行模式、专属工具协议和安全边界说明 |
