# ADR-0064：移除旧修订派单与新账号旧 Prompt 初始化触发器

状态：Accepted。日期：2026-11-13。

用户授权检查四个旧触发函数与调用链，只有当前功能、保存运行包和历史恢复无依赖才删除；不得删除历史数据、放宽保护、提交或推送。

日常 183 中四者均仅 postgres 可执行，各有一个挂载触发器，无其他 SQL 调用者或传入目录依赖。23 个保存运行包没有精确函数名引用，但这不足以证明隐式触发链可删。

`create_script_revision_task_after_changes_requested()` 和 `create_visual_revision_task_after_changes_requested()` 在旧审批要求修改时创建旧规划任务。正常旧审核 API 已拒绝，应用角色不能直接写 approvals；当前正文／v2 准备直接登记当前准备与审核包，不走这两个触发器。旧任务、审批、版本与运行包作为原始证据保留，完整备份恢复无需重放审批事件。

`seed_account_prompt_versions()` 在新账号插入时创建三种已退役规划 Prompt 的初始版本。当前建号及保存包建号不读取这些版本；当前制作使用明确的制作选择与执行快照。停止未来自动生成旧模板，保留所有已有 Prompt、任务及其冻结引用；旧 Prompt 配置入口仍拒绝，不恢复旧规划能力。

`create_storyboard_review_package()` 及 `create_storyboard_review_package_after_task_completion` **必须保留**。旧任务不再可新领取，但合法历史租约回执仍可调用共享结果入口；完成触发器验证分镜的冻结输入、主脚本／视觉依据、原产物路径和运行回执，并投影原审核包，不自动批准。实际保存包 Worker 测试证明：保留时错误冻结哈希被 22023 拒绝且整笔回滚，合法回执生成原审核；在私有隔离变体中仅拆除此触发器，同一错误回执被接受。删除它会放宽保护。

184 仅显式拆除前三项的三个触发器，再以默认 RESTRICT 删除对应三个无参触发函数。无 CASCADE、历史 SQL 修改、数据 DML 或权限变更。通过非空完整导出恢复、额外依赖阻断、失败回滚／幂等、原行／序列／角色／其余目录 ACL 对账，以及当前制作、建号、旧包与历史恢复集成后，备份并在候选库演练，再应用日常；不启用采集、不重启。验证报告：`docs/verification/retired-trigger-cleanup-20261113/REPORT.md`。
