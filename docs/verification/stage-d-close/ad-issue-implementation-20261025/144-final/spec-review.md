# #144 / C13 最终 Spec 复核（只读）

## Critical issues

无。就 C13 的三条验收标准，当前实现与本轮隔离实证足以关闭 #144 的**票内范围**，不推断 D 总门禁或 E/F 已完成。

## Important improvements

1. C13-1（存活旧执行器）：保留的自然样本记录了旧进程自然超时、新尝试完成、旧进程随后实际晚写不同 SHA，DB、正常 HTTP 与磁盘仍是新已接纳字节（`report-144.md:11,21-39`）。本轮三组正常 Owner HTTP 任务又均记录 `lateOriginalCallbackCannotChangeIndexOrBytes=true`；真实 PG 边界同时拒绝历史旧 attempt（`sql-boundaries-...9266-result.json`）。这不是旧 RPC 回放。
2. C13-2（隔离、围栏、失败）：040 只作用新插入 native task，历史输入/迁移/预算/状态不变（`040-applied-result.json`；`040-native-output-publication.sql:1-33`）。发布先取得带 fence 的任务/路径锁，再核对冻结输出（`nativeAttemptOutput.ts:61-74`）；真实 PG+FS+实际 report payload 覆盖 committed-client-throw、commit 前断连、22012，均两次恢复、最终 artifact=1、输入/预算/attempt 保留、无执行器/Provider 重跑。未知结果保留私有 receipt 供 Owner 显式核对，不会自动重报或恢复覆盖（`nativeAttemptOutput.ts:78-94,147-210`）。
3. C13-3（退出与策略）：三组运行均显示正常 Owner 及自有父/子进程最终退出、控制字节复原，且 `leaseBudgetPolicyNotChanged=true`。1804.375 秒自然租约证据继续保留；040 没有修改 30 分钟策略。

## Optional notes

- `committed-ack-lost` 的服务器确认字段为 true；它证明“服务器已提交而客户端抛错”的恢复，不应表述成物理网络 ACK 丢失。C13 未要求后者。
- 跨 task 冲突实证是 rollback-only 的 foreign indexed row，`normalBusinessIndexedOrigin=false`；不得把它写成既有正常 indexed 文件端到端回放。新任务 namespace 和真实 PG 拒绝已覆盖本票所需的前向隔离；历史任务未迁移。
- 公开 `report-144.md:3,57,71` 与 `output-recovery-design.md:3,68` 仍写“#144 保持开放/待验收”，已与本轮结果相矛盾。关闭说明或证据索引须更新/明确以本轮最终结果覆盖这些历史阶段性结论，同时保留其失败事实。

## Verification suggestions

无需为关闭 C13 再跑。保留本轮 040 应用、三组 recovery、三组 Owner late-callback、SQL boundary/namespace/indexed-conflict 结果；不要把“没有完整 FS/DB 共同原子事务”、同 UID 恶意进程、旧二进制、完整渲染验收或 #146/#147 SQL 暂缓混入本票完成宣称。
