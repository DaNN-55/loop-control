# 旧编排空壳清理验收（2026-11-13）


> 产物清理记录（2026-11-18）：本目录的历史测试生成附件已按用户要求清理；本文验收结论保留。源测试输入、恢复资料、生产单和数据库未删除。

结论：20 个退役空壳中，19 个无当前消费者，新增 172 删除；保留 1 个仍被旧 Studio 结构修订函数调用的拒绝边界。当前审核渲染和最终成片编排不属于空壳，保持原定义和权限。

## 范围与证据

逐项检查日常 clean-v2 + 171 的有效函数体、传入 pg_depend、有效 SQL 函数调用、源码消费者、HTTP 命令、Worker 封闭调用集、类型声明和备份恢复顺序。检查时日常任务、图片/旁白提交、预留、发送事实、产物发布、旧续跑记录均 0；App PID51263，HTTP200。完整依赖定义和基线快照只存私有 `/private/tmp/loop-orchestration-shell-audit-20261113/`。

以下签名均在 public schema；19 个删除项的有效 SQL 调用者和传入结构依赖均为 0。

| 函数签名 | 处理 | 原因 |
|---|---|---|
| `orchestrate_a_roll_tasks()` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_a_roll_tasks_for_episode(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_a_roll_tasks_for_episode_without_card_adapter(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_a_roll_tasks_without_card_adapter()` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_a_roll_tasks_without_manual_path()` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_b_roll_tasks(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_b_roll_tasks_all()` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_b_roll_tasks_configured(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_b_roll_tasks_legacy(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_b_roll_tasks_legacy_all()` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_b_roll_tasks_with_connection_ref(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_b_roll_tasks_without_connection_ref(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_narration_tasks(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_narration_tasks_all()` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_narration_tasks_configured(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_narration_tasks_without_connection_ref(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_soundtrack_tasks(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_soundtrack_tasks_without_manual_path(p_episode_id uuid)` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_storyboard_tasks()` | 删除 | 无当前调用或结构依赖；函数体仅拒绝，不承载历史数据。 |
| `orchestrate_storyboard_tasks_for_episode(p_episode_id uuid)` | 保留 | `request_studio_storyboard_revision(uuid,text)` 仍调用；保留 0A000 退役错误及整笔事务回滚。 |

## 保留边界

- `orchestrate_review_render_tasks(uuid)`：当前 `generate_shot_review_video`、`freeze_shot_preparation_batch` 和 `local_identity.queue_owned_studio_render` 的共享调用。
- `orchestrate_final_render_tasks(uuid)`：当前 `local_identity.queue_owned_final_render` 的共享调用。
- `local_identity.plan_input_tasks` 等旧规划/修复/旁白生成拒绝入口、Owner 归属、HTTP 410、旧快照 Worker 过滤、费用/租约/容量、文件冻结与发布恢复保护均不变。
- 历史任务、音轨、素材、蓝图、规划只读表和预算表，原始基线/归档 SQL、冻结旧日常库及既有恢复材料全部保留。

172 仅包含 19 条明确签名的 DROP FUNCTION，使用默认 RESTRICT。没有 CASCADE、权限授予、数据改写或忽略失败。两个已删除函数的陈旧前端类型移除；四组旧退役集成断言改为函数不存在且调用失败，其他权限、历史和当前路径断言保持。

## 验证

- Schema 矩阵通过：空库、083 旧前缀、真实旧来源、历史已撤销连接、故障回滚、幂等、目录一致及未删除权限精确保持；120 张表、112 行数据，安全对象 572 个。证据 `/private/tmp/loop-clean-schema-RruxdZ/verification.json`。
- 6 个已有集成用例通过，包括当前工作区准备/保存/重开、当前旁白实际 Worker 及历史音频、旧 HTTP/SQL/Worker 拒绝、非空预算和完整导出恢复。证据 `/private/tmp/loop-story-e2e-DgcDXL/evidence/`。该轮新增的第 7 个用例属于夹具前置错误，最终单独复验通过，见下。
- 新增旧导出恢复验收最终通过：完整恢复 clean-v2 + 171，结构依赖使 172 以 2BP01 拒绝并整笔回滚；删除后的注入失败也整笔回滚；正常迁移只删除 19 个目标，全部保留函数定义/ACL 和历史保持；幂等计划为空。真实 Owner 会话下的旧 Studio 调用到达保留空壳并抛出 0A000，审核包/阶段/状态转换/审计整笔回滚；Worker 和直接 Owner SQL 仍以 42501 拒绝。证据 `/private/tmp/loop-story-e2e-jEZHwU/evidence/`。
- 当前原生文本/样式/时间编辑 1 个、实际 Worker 成片交付 4 个、恢复发布 journal/receipt/config/ready 四个 SIGKILL 中断恢复用例全部通过。证据 `/private/tmp/loop-story-e2e-4NIbju/evidence/`。该轮唯一失败是新增夹具的资产根前置，最终按上一项单独复验通过。
- 以上 16 个不同集成案例全部通过；中间失败记录保留，未把整轮失败日志改写成整轮通过。
- 默认回归 290 文件 / 2,098 项通过，0 失败 / 0 跳过；私有 `/private/tmp/loop-orchestration-shell-audit-20261113/default-tests.json`。TypeScript 和本轮差异空白检查通过。

新增回滚夹具的前置错误单独记录：第一轮管理员设置 Owner ID 仍被拒绝（42501）；第二、三轮真实 Owner 会话缺少资产根（55000）；当前蓝图触发器会剥离 asset_root，旧策略字段不能替代实际目录登记。最终使用真实临时目录及 dev/inode 登记，让原有触发器冻结位置。未改变产品保护或授予产品函数权限。仅专属数据库建立固定参数的临时权限探针，测试后删除，并对比全部保留函数定义/ACL。

## 日常应用与恢复

日常实际应用 172，ledger 从 169 增至 170 条；20 个旧空壳剩 1 个。应用前完整逻辑导出存于私有 `/Users/dan/Programs/loop-control/.loop-control/local/sql-shell-cleanup-172-87469b79c98e/daily-before.sql`，同目录保留前后快照、恢复和迁移演练。完整导出先恢复到同集群独占候选，逐项对账，再在候选执行 172；日常库与导出基线再次一致后才执行同一事务。候选核对 0 客户端后已删除，完整恢复材料保留。

日常 120 张非 ledger 表 / 201 行、全部序列、角色、旧 ledger，以及排除明确 19 项后的全部函数定义、目录和 ACL 精确保持。原冻结旧库 OID/设置/禁连状态保持，部署配置和 App 记录字节保持；PID51263、HTTP200，不重启、不切库、不提交、不推送。最终结果见 `daily-result.json`。

限制：日常当前没有真实业务任务或制作记录，不能把 HTTP200 当作新制作全流程的真实生产证明；当前制作、计费拒绝、媒体和恢复验证来自专属集成环境，未发起真实付费供应商请求。主会话的六项失败诊断及其并行改动不归本轮修改或验收。

本轮四个专属 E2E 容器均已自动删除；核对无进程引用后，8 份 source/SDK 临时副本已清理。原始通过/失败日志、schema 矩阵证据和私有日常恢复材料保留；主会话隔离目录未触碰。清单见 `cleanup.json`。
