# ADR-0051：删除无当前消费者的旧 SQL 辅助对象

状态：Accepted。日期：2026-11-13。前置条件：ADR-0050 的日常 clean-v2 + 166–170 已实际采用并完成数据、权限、运行与页面验收。用户已授权确认当前功能和历史恢复不受影响后清理。

有效 SQL 函数体、pg_depend、触发器、当前源码、API/Worker 动态调用和恢复流程核对后，新增 171 前向迁移，删除旧累计预算写入口 set_generation_budget、无消费者的 approval_gate_enabled、仅返回 NEW 的 auto_advance_disabled_approval_gate 及其任务触发器，以及旧自动脚本规划的两个 orchestrate_provided_script_tasks 函数和旧批量原声提取 orchestrate_embedded_audio_tasks。删除使用明确签名且不使用 CASCADE；出现未知结构依赖即失败回滚。

预算历史表 generation_account_budgets、其原行/时间、Owner 只读 RLS、外键，以及历史 policy 中的审批字段保留。逐请求费用预留、当前显式原声提取和声音选择、Studio 审核渲染及最终成片编排保持。169/170 建立的退役拒绝壳保留，不因无调用而改变旧入口拒绝合同。

旧 SQL 基线和归档原文不修改。旧导出恢复先按原行对账，再执行当前前向迁移；删除函数/触发器不会重写历史预算或任务。同步去掉唯一陈旧的前端类型声明，不重构其他协议。

验收覆盖含非空预算/审批历史的真实迁移、Owner 只读边界、完整逻辑恢复、当前脚本准备/原声/Studio/交付，以及空库、旧源、故障回滚和幂等矩阵。日常采用 171 前保存私有完整快照；逐表、序列、角色和未受影响权限对账，记录服务和验证盲区。
