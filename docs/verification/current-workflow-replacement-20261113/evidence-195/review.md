# C2 本机导出切片两轴审查

固定起点：声音 194 已验收源码 `/private/tmp/loop-story-e2e-zHmY2s/source`。14 个源文件差异；HEAD 保持 `2d1a8ff46318ece0031c0810899a339df71520c9`，无提交。

## Standards

独立上下文 `/root/c2_export_standards`：初次及更新复核均无可行动问题。核查 AGENTS、CONTEXT、domain、ADR-0069 及 smell baseline；新增实例隔离、独立采样池、窄注记、SKIP LOCKED 统计观察与 URL 解码均符合本切片边界。只读审查，未修改代码或重跑测试。

## Spec

独立上下文 `/root/c2_export_spec`：发现 1 项 P2，195 包装器把原合法 `gap_seconds:null` 与原 writer 的默认 0 错判冲突。新增真实 SQL 用例先红，按原数值转换修正后通过；复核确认已修复，无新增问题。

另对真实跨期开关失败根因修复复核：195 仅启用 bootstrap 的 episode／ready-task 观察使用指定行 KEY SHARE SKIP LOCKED，保留 Owner、覆盖期及原 ACL，跳过忙对象不补造锚点，不改变业务资格和锁。177 原文件未改。

最终 5 文件 27 集成、5 文件 36 单元、类型及 schema 矩阵已由主 Agent 读取。Standards 0 项，Spec 1 项已闭环，无开放切片发现。完整目标仍有后续矩阵和 D–G 等未完成，不能以此次审查宣称全项目完成。
