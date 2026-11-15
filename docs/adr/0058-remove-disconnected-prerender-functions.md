# ADR-0058：移除未挂载触发器和无消费者的旧预渲染入口

状态：Accepted。日期：2026-11-13。

用户授权检查并清理 3 个未挂载触发器函数和 4 个旧预渲染／推进入口，前提是当前功能、保存运行包和历史恢复均无依赖；不得放宽保护，不提交、不推送。

日常 176 有效定义中，7 个目标均仅 postgres 有执行权限，无 SQL 调用者或传入目录依赖；3 个触发器函数没有挂载。当前运行源码无执行调用，全部 23 个保存包无名称引用。当前旧 Studio 渲染、最终渲染、审核历史、冻结／复用及 Worker 保护使用其他仍保留的函数，不能一起删除。

新增 178 仅以默认 RESTRICT 删除 `public.confirm_frozen_shot_when_ready()`、`public.queue_source_audio_after_frozen_clip()`、`public.guard_b_roll_task_claim()`、`public.create_pre_render_review_packages()`、`public.create_pre_render_review_packages_for_episode(uuid)`、`public.advance_production_ready_episodes(uuid)`、`public.recover_duration_decision_review_render_tasks()`，移除 1 个陈旧 RPC 类型条目。无 CASCADE、数据更新、权限授予或保护触发器拆除；不改历史 SQL、保存运行包、177 或其他并行工作。

验收包括非空旧任务、制作记录、连接、预渲染审核证据完整导出恢复，真实触发器／视图依赖阻断、注入失败回滚、幂等及全部其他目录／ACL／业务行精确保持；回归当前准备、生成、单次确认、未知结果、旧包模块、Studio、交付及恢复。全目录含默认关闭的 177 在隔离环境联验，不能将此当作日常已获准应用 177。

项目原有决定要求 177 日常迁移另行授权。完成全部隔离验证与完整日常备份候选演练后，用户明确授权按 177 → 178 顺序应用，保持采集关闭、不重启服务；不能将此授权解释为启用统计采集或部署新应用。完整历史原文、原冻结旧库、既有恢复材料和保护均保留。实际应用与对账证据见 `docs/verification/disconnected-prerender-20261113/REPORT.md`。
