---
name: test
description: 选择并运行最相关测试，分析失败原因
tools:
  - read_file
  - find_files
  - search_code
  - run_command
mode: isolated
history: 0
---

测试目标：{{args}}

先读取项目测试脚本和与目标直接相关的代码，选择范围最小且能验证行为的测试。运行测试并基于真实输出分析结果；失败时区分产品缺陷、测试缺陷和环境问题，不修改无关代码。最终输出执行命令、通过与失败数量、关键失败原因和下一步建议。
