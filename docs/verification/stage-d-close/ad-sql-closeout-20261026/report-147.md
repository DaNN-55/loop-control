# #147 三条历史 RLS 告警

三条历史告警均适用于当前原生路径。历史 `advisors.txt` 与冻结基线保留，本次通过前向迁移 `043-owner-policy-initplans.sql` 调整求值方式，没有改写历史迁移。

| 策略所在表 | 当前读取路径 | 受控计划变化 |
| --- | --- | --- |
| `external_connections` | `src/local-app/connections.ts` 连接列表 | Owner InitPlan 从 0 个变为 1 个 |
| `external_connection_verifications` | 同入口的连接验证记录 | 从 0 个变为 2 个：自身策略及关联连接策略各一个 |
| `storyboard_audio_selections` | `episodeReads.ts` 调用 `read_episode_production` | 从 0 个变为 1 个 |

`scripts/local/import.mjs` 原来只把历史 `auth.uid()` 适配为 `local_identity.owner_id()`，并替换应用角色；三条原策略仍存在。本次使用 `ALTER POLICY` 将三个 Owner 函数调用包装成独立子查询，角色、SELECT 命令、数据条件和授权保持原状。此方式符合 [Supabase 的 RLS 函数求值建议](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select)。

## 隔离验收

仅在新隔离库 `loop_t24_restore_sql20261026` 应用并登记 043 的 SHA。没有运行会写入旧 `loop_empty` / `loop_imported` 的默认迁移脚本，没有改变生产、源隔离库、角色或口令。

两名测试 Owner 每张表各有 32 行非空样本。使用真实 `loop_app` 会话身份与 RLS，全字段读取结果在迁移前后完全一致；角色、成员关系、ACL、策略角色与命令、RLS 开关均一致。缺身份与不存在的 Owner 返回空集；worker 和 anonymous 即使设置 Owner GUC，仍被原表权限拒绝。

迁移前，三项计划断言失败，权限基线通过；迁移后 4/4 通过。`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)` 显示每个独立 Owner InitPlan 的 `Actual Loops=1`。验证表存在两个求值点，因此不能写成「整条查询只调用一次」。本次证明受控计划改善，不主张生产延迟或吞吐提升，也没有重新运行远端 Supabase Advisor。

启动测试前曾因 worker 缺少 `node_modules` 而未启动进程。该空日志与明确原因保留，随后仅链接已有依赖，没有安装依赖。

[迁移前红](147-before-red-v2.log) · [迁移后绿](147-after-green.log) · [结果摘要](147-result.json) · [计划证据](147-plan-summary.json)。完整行级观测保留在私有索引。最终集成后的复验见本目录最终进度报告。
