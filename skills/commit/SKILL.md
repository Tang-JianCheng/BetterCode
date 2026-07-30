---
name: commit
description: 检查改动、运行必要验证并创建中文 Git 提交
tools:
  - read_file
  - find_files
  - search_code
  - run_command
mode: shared
---

完成 Git 提交任务：{{args}}

先检查工作区状态、当前分支和完整差异，确认没有敏感文件或无关改动。根据改动风险运行最相关的测试与差异检查。提交信息使用 Angular 风格，type 保持英文，scope 和描述使用中文。只提交，不主动推送远程；提交后报告提交哈希、测试结果和工作区状态。
