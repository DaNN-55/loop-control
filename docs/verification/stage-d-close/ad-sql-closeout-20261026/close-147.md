验收完成，关闭本票。三条历史 RLS 告警均适用于当前原生连接/分镜音频读取；历史告警原文保留。

- 新增前向迁移 `043-owner-policy-initplans.sql`，仅对三条策略的 Owner helper 包装 SELECT。只在新隔离库 `loop_t24_restore_sql20261026` 应用、登记 SHA；原隔离库逻辑 dump 哈希未变，未操作生产或远端数据库。
- 迁移前计划断言 3 红、权限基线 1 绿；迁移后 4/4 通过。两个 Owner 每张表各 32 行，全字段结果完全一致；角色、ACL、策略范围和 RLS 开关不变。
- 缺身份/未知 Owner 返回空集；worker、anonymous 伪造 Owner GUC 仍被拒绝。InitPlan 分别为 1、2、1 个，每个独立 InitPlan 的 Actual Loops=1；不声称整条验证查询只调用一次，也不声称生产性能提升。
- 最终主树两项 SQL 集成测试 8/8、离线测试环境下 113 文件 894/894、构建和独立复查通过。首次环境失败及全部红日志保留。

本地未提交证据：`docs/verification/stage-d-close/ad-sql-closeout-20261026/report-147.md`、`147-plan-summary.json`、`147-result.json`、`database-integrity-result.json`。迁移 SHA-256：`361ff9ae7f716aa3e97fe4372d168adab3ab8642b4f431c9f99da1044ca3fd09`。完整源码摘要：`056d325ff85ba9b06cb28ef2a1f1ba12eb4459d98a2c530b4777ca1f07ca72a7`。证据未提交、未推送。

四家不可用 Provider 继续跳过且不计通过；#149 与全部未验收总门禁保留。不新增 Provider 请求、不进入 E/F。
