# 剩余旧 SQL 入口与依赖盘点

日期：2026-11-13。检查起点为并行空壳清理完成后的实际日常库。下列清单只列仍存在的对象，不重复此前已经删除的名单。原始有效定义、目录依赖和日常快照只存私有目录 `/private/tmp/loop-remaining-sql-audit-20261113/`。

最新状态：本清单按 183 应用后状态复核（仅下列兼容接口子清单），当前剩 8 个因保存运行包依赖保留的签名。旧云端 RPC 的检查与处理见 [176 报告](../retired-cloud-rpc-20261113/REPORT.md)，保留项的逐项原因见 [旧包兼容报告](../retired-sql-runtime-compat-20261113/REPORT.md)。下半部分保留 173 时的验收事实，不代表当前仍待清理。

## 尚未清理的候选

当前 8 个残留签名分为以下两组。没有把“未找到当前源码调用”直接当作“可以删除”；目录依赖、SQL 函数体、保存运行包和动态边界分别核对。完整签名及调用边见 `remaining-inventory.json`。

| 优先级 | 残留 | 实际依赖与用途 | 建议 |
| --- | --- | --- | --- |
| 保留 | 7个退役SQL拒绝入口 | 旧规划3个、旧修复2个、旧派单1个、旧旁白包装1个；当前无消费者，但保存运行包仍引用，部分Worker启动检查依赖签名 | 保持原定义/ACL及Owner、Worker退役拒绝。继续删除前须先明确相关旧包去留或迁移其调用契约 |
| 保留 | `local_identity.script_production_scopes()` | 保存包中的可调用扫描器仍依赖此查询；空结果防止旧启用记录再次触发制作 | 继续返回空集；不恢复扫描，不删除历史表，不以当前未挂载旧扫描器为由直接移除契约 |

7个保留的拒绝入口：

- `local_identity.queue_workspace_planning(uuid,uuid,uuid)`
- `local_identity.replan_workspace_planning(uuid,uuid,uuid)`
- `local_identity.save_planning_selection(uuid,jsonb,integer)`
- `local_identity.plan_input_tasks(uuid)`
- `public.apply_episode_configuration_repair_v2(uuid,jsonb,text,text)`
- `public.apply_external_connection_repair(uuid,uuid,text,text)`
- `local_identity.generate_input_shot_tts(uuid,uuid,text,boolean)`

## 仍有依赖的残留

这些对象不在上面 8 个函数签名内，也不能因名字旧而直接删除：

- `create_script_revision_task_after_changes_requested`、`create_visual_revision_task_after_changes_requested` 仍挂在 `approvals` 上，初次分镜规划投影也保留；它们属于本轮两组之外的生产链，值得下一轮独立审计。共用审核、证据、历史音轨复用及依赖保护保持，不能整张表或整套审核状态机一起删。
- `reserve_workspace_narration_submission_legacy` 仍是当前 `reserve_workspace_narration_submission` 对非现行快照的拒绝边界。若要去掉该辅助函数，必须先在当前包装里保留等价的租约校验与拒绝行为，验证未知提交、费用预留及历史恢复；不能单独 DROP。
- `record_script_production_configuration` 仍被 `ScriptProductionStore.configure` 调用，且 `enabled=false` 的保存路径仍存在。旧整期自动运行虽已关闭，不能据此删掉当前仍能使用的保存/暂停记录。
- `freeze_prompt_harness` 仍挂在 `prompt_versions` 上，负责历史提示版本不可变和内容 hash；当前 catalog 仍读取这些版本。它是历史证据保护，不是空操作。应先确认哪些读取纯属残留，再考虑减少返回字段，不能先移除冻结保护。

## 此前173的执行记录

用户另行授权的旧 Studio 结构修订调用链已完成依赖检查：入口无有效 SQL 调用者或传入目录依赖，其唯一编排调用只会拒绝并回滚；客户端旧分支只被单测调用，当前原生编辑与合成修订使用其他路径。173 以默认 RESTRICT 按调用顺序删除两个函数，并移除旧 RPC 分支；旧 HTTP 命令继续保留身份、CSRF、Owner 归属及 410 拒绝。过时或非类型化的客户端请求在网络调用前拒绝，不能误转为合成修订。具体决定见 ADR-0053。

历史基线、归档 SQL、原任务/审核包/音轨和恢复材料保持。本轮没有扩大删除上面五组候选。

## 验证与应用进度

- 旧 HTTP/SQL 拒绝及历史保护 3 个集成用例通过。
- 完整旧导出恢复、先验旧拒绝回滚、173 依赖阻断、注入失败回滚、正常删除、全部其余函数定义/ACL、历史行及幂等，1 个集成用例通过。
- 当前原生文本/样式/时间编辑、真实 Worker 交付和旧任务过滤，9 个集成用例通过。
- 当前 Studio 合成修订另1个集成用例通过，实际验证冻结登记、Owner/CSRF、过期/在途请求拒绝、原证据不变和重复制订拒绝；合计14个不同集成用例通过。
- Schema 矩阵通过：空库、083 旧前缀升级、旧历史连接、注入失败回滚、数据/序列/保留 ACL、目录一致和幂等；120 张业务表，安全对象 570 个。
- 固定私有源码副本的默认回归按最新逐文件结果合计：291 文件、2108 项通过，0 失败/跳过；完整运行后补齐编译产物，两个受影响文件单独复验，未重复已经通过的文件。详见 `default-final.json`、`default-recheck.json` 和 `verification-summary.json`，不把首次整轮失败改写为整轮通过。
- 最终 TypeScript、Worker/backend 编译和任务差异空白检查通过；共享依赖和并行新增统计代码、pnpm文件均保留。验证依赖只在本轮私有副本按原 `package-lock.json` 安装。

中间失败保留：首次扩展恢复测试把173检查插在172既有验收之前，导致后续172 ledger断言看到173；已把步骤改为先验证172旧边界、再执行173，原保护断言保留，单独复验通过。默认回归期间并行会话执行依赖安装，Vitest Worker 文件被替换，模块不存在而退出，不计为通过。随后独立副本首次回归漏掉编译产物，2096项通过，应用装配7项因缺失模块失败，备份重叠测试无法收集；按现有 `runtime:prepare` 补齐后，两文件单独复验通过，未修改实现或断言来满足前置失败。

## 日常应用与恢复

173 已实际应用，ledger 从170增至171条。完整逻辑导出先恢复到同集群独占候选，核对全部业务行、函数和ACL后演练同一迁移；再次核对日常状态未漂移，才执行173事务。

应用前后120张非ledger表、203行、全部序列、角色和原ledger保持；排除两个目标后的全部catalog、函数定义和ACL精确一致。22个剩余候选函数的有效定义和ACL又与本轮盘点基线复核一致。原冻结旧库保持；配置和App记录字节保持，PID51263、HTTP200，未重启或切库。候选确认无客户端后已删除。

完整私有恢复材料：`.loop-control/local/studio-entry-cleanup-173-432383175034/`，含 `daily-before.sql`、恢复/演练及应用前后快照；未删除。公开结果见 `daily-result.json`。这里的203行是本轮应用前后基线，不把此前172报告的201行当作本次实际行数。

验证边界：未做真实付费生成；当前制作、文件编辑和交付来自隔离 HTTP/Worker/SDK 集成。没有删除剩余候选或改变其权限，不提交、不推送。

清理：本轮四个 E2E 容器及 schema 矩阵容器均已自动移除；四套源码/SDK副本和独立验证源码/依赖副本共10份已删除，保留所有通过/失败证据。日常恢复导出、冻结旧库和其他会话文件均保留，见 `cleanup.json`。
