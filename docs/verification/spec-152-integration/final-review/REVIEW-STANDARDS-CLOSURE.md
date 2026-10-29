# Standards 修复复核

固定源码：`e9d7f54fe72329bc6f11beb1b470b93beec244de`；比较：`git diff 3b7da737...e9d7f54f`。

- **永久删除：resolved。** `db/local/096-workspace-episode-deletion.sql` 通过前向迁移在原受保护函数内清理 19 张 workspace 表。插入点处于原 Owner、归档、运行任务和资产锁检查之后、旧子表删除之前；顺序覆盖新 FK，各语句限定本 Episode 的 workspace/task。未修改旧迁移、FK、原文件暂存/清理范围，符合 ADR-0001。
- **静音口播元数据：resolved。** `src/workspaceAudio.ts` 提供共享 `isWorkspaceItemAudible`；`workspaceDeliveryCommands.ts` 使用 `audible && isWorkspaceItemAudible(item,timeline)`，并将该结果递归传入子 sequence。叶轨及任意父轨静音都会使窗口不可听，阻止 `adoptedText/complete_source`；原 Duplicated Code heuristic 一并关闭，符合 ADR-0016。
- **新增确定 Standards 缺陷：0。** 本次其他改动沿用既有人工编辑围栏、候选及 UI 机制，未发现需新增的可操作 smell 判断。

限制：仅静态只读复核；未运行服务、DB、渲染、测试或 GUI，测试源码的存在不等于执行通过。运行结果由独立验证负责；本报告不代替 Spec 轴结论。原审查报告保持不变。
