# #144 P1 修复复核（只读）

## Critical issues

- 原 P1 的**确定失败**路径已修复：`nativeAttemptOutput.ts:44-85` 在刷新围栏后设 SAVEPOINT；已替换文件在登记 SQL 失败时先回滚至该 SAVEPOINT、再按逆序恢复/删除 canonical，最后才外层 ROLLBACK。行锁在 SAVEPOINT 之前取得，符合 ADR-0008 的结果围栏。现有单文件、多文件和部分发布测试覆盖恢复。

## Important improvements

- 未见新增规范问题。`localWorkerCli.ts:42` 在 `uncertain` 时拒绝自动失败回报；`nativeAttemptOutput.ts:74-88` 对 COMMIT/连接未知销毁连接、保留候选与备份两代，避免用盲目恢复覆盖可能已提交的新引用。
- 实际补验证据 `case-73R7gf/result.json` 确认真实刷新、SAVEPOINT 后/还原后仍持行锁（NOWAIT 55P03）及旧字节恢复。它明确未验证真实 report payload、已索引跨任务来源或 COMMIT/连接未知，故 #144 仍是开放门禁，不能关闭。

## Optional notes

- 未发现新的抽象、命名或重复代码 smell；辅助输出仍在同一围栏事务处理。

## Verification suggestions

- #144 最终关闭前，补真实 `report_worker_result` 成功/确定失败下的已索引跨 task 来源，以及 COMMIT/断连未知后的人工核对与恢复流程验收。
