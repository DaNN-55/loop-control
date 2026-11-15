# ADR-0054：删除旧镜头结构修订与旧审核入口

状态：Accepted。日期：2026-11-13。用户授权清理剩余清单中的前两组，并核对相关触发器；保留当前功能、历史恢复和保护，不提交、不推送。

## 决定与依据

实际 clean-v2 + 173 中，`local_identity.request_shot_revision` → `public.request_shot_structure_revision` → `public.canonical_storyboard_structure_revision_operation` 构成独立旧结构修订链；外层没有当前SQL或产品调用者。`public.create_storyboard_annotation`、`public.review_pre_render_member` 无有效SQL或产品调用者。相关HTTP入口已分别以原归属校验后410、未知命令400拒绝；Worker使用封闭SQL端口并过滤旧规划任务。

174删除以上5个函数以及两个专属生产触发器和函数：`create_storyboard_revision_task_after_changes_requested` 只消费旧分镜退回批准事件，自动派发旧 `draft_storyboard`；`create_storyboard_revision_review_package_after_task` / `create_storyboard_revision_review_package` 只将已退役的 `draft_storyboard_revision` 完成结果落成新包并自动批准。它们不是当前权限、不可变证据或费用校验。当前Owner不能直接插入approval，Worker不能直接调用public结果回写，当前领取/回写端口对旧任务的过滤保持。

迁移先删除两条明确触发器，再按调用顺序删除7个明确签名的函数。全部使用默认RESTRICT；意外目录依赖必须使整个事务回滚，不使用CASCADE、忽略缺失或授予权限。移除陈旧RPC类型；旧HTTP拒绝和旧回执不可重放为成功的边界保留。当前原生结构编辑、脚本重新确认和Studio合成修订不改。

## 保留边界

- `freeze_manual_clip_on_pre_render_member`、`record_pre_render_member_dependencies` 仍服务当前 `create_shot_preparation_review_package`，后者被当前审核渲染/准备冻结调用；继续固定裁剪证据并登记失效依赖。
- `link_review_package_approval`、审核前置校验、`materialize_approved_script_revision`、草稿初始化、历史音轨复用、失效与读版本触发器仍挂在共用表上，保留原定义、启用状态及权限。本轮只删除专属生产器，不删除共用校验和历史投影。
- 脚本、视觉返工及初次分镜规划触发器属于另外的生产链，不随本次两组入口一起扩大删除；其后续去留需另行完整审计，不能把“保留现状”解释成已证明永远有用。
- 原任务、批注、逐项审核决定、审核包、产物、依赖、审计、历史规划表和RLS保持；当前提交确认、费用预留、未知结果、租约、文件冻结/发布及恢复保护保持。

## 验证与恢复

在隔离PG中以非空旧批注、已批准逐项审核、旧结构修订任务验证完整SQL导出恢复；逐项比较全部业务行、序列、角色、保留函数/触发器和ACL。覆盖意外依赖阻断及中途错误回滚、幂等、Owner历史读取隔离/拒绝写入、旧HTTP和旧SQL入口不能写入、Worker不再领取旧任务，以及当前结构编辑、字幕、旁白、审核渲染、交付和发布恢复。共享结果回写保留原有租约、冻结路径及产物校验：合法历史在途回执仍可留证，但不再自动生成或批准旧分镜包；不能把领取过滤误写成拒绝所有历史回执。

日常应用前完整私有导出并恢复独占候选、演练174，再核对日常未漂移后应用；不重启、不切库、不删除原冻结旧库和恢复材料。历史恢复仍先恢复原schema及原行，再顺序前向迁移，不改写历史SQL原文。结果见 `docs/verification/shot-review-entry-cleanup-20261113/REPORT.md`。
