# #146 目录查询合同一致性

当前两份查询的业务逻辑一致。本次仅新增显式集成回归，没有改生产 SQL、历史迁移或原生入口权限。

通过真实 Owner 登录与 HTTP 目录入口，对照同一隔离样本的保留 RPC：4/4 通过。覆盖 30 个 Owner Episode 的稳定排序与分页、账号/系列/归档/审核筛选、统计、24 个待审包与 25 条阻塞项的独立分页，以及 Worker 摘要。独立固定期望值补充两份查询的相互比较，避免两边同错仍判通过。

隔离库为 `loop_t24_restore_sql20261026`。实际数据库身份为 `loop_app`；直接 SELECT 证明跨 Owner 数据被 RLS 排除。非 Owner 的 worker 成员虽可按原 RLS 看到所属 Episode，目录合同仍仅返回 Owner 资产；缺 GUC、事务结束和未登录访问均验证。

## 漂移敏感性

临时把原生分页上限从 20 改成 19，测试出现 2 项预期失败；恢复原始字节后 4/4 再次通过。此突变仅用于证明新增测试能抓住双副本漂移，最终源码不包含该改动。首次 fixture 使用了不存在的 editor 枚举而初始化失败，已改为产品现有 worker 枚举，失败原日志保留，没有更改产品角色。

## 验收范围

保留 RPC 源自历史迁移，只在测试专用 schema 安装，并将唯一的 `auth.uid()` 调用适配为 `local_identity.owner_id()`。函数以实际应用角色及 RLS 执行；原生 `public.read_episode_catalog` 入口仍不存在。此结果不覆盖线上 Supabase Auth、PostgREST 或生产服务。比较使用静态隔离样本，两次请求间未并发修改数据；原生专有元数据不属于两条路径共有的目录合同。

[执行回执](146-worker-receipt.json) · [首次 fixture 失败](146-first-run.log) · [分页突变红](146-pagination-mutation-red.log) · [恢复后绿](146-final-green.log)。最终集成后的复验见本目录最终进度报告。
