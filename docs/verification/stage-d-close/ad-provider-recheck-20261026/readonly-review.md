# #146 / #147 只读复查

未发现目录合同或 Owner 隔离退化。当前 46 项最终源码 SHA 与上轮清单一致；1400 项公开证据、4442 项私有证据均匹配登记的大小和 SHA。索引本体 SHA 为 `e85de83df6ca15476e404f975c6f185ed8e807b02e1089483e2d36bcf73e7784`，历史红证、原告警和门禁元数据仍保留。

#146 的真实 HTTP 与保留 RPC 对照有独立固定期望值，以及分页 20→19 的两项失败证据；恢复后的 4/4 通过记录与当前源码对应。本轮只复核这些证据，没有重跑会新建 fixture 的目录测试，也没有把本地身份适配写成线上 Supabase 验收。

#147 的 043 仅包装三条既有 SELECT policy 的 Owner helper；未变更角色、ACL、行级条件或 RLS 开关。本轮复用原隔离样本，以实际角色做只读复验：4/4 通过，未写数据、未改 schema。两 Owner 的非空行集、缺身份空集、worker/anonymous 拒绝，以及每个独立 InitPlan 的 `Actual Loops=1` 均保持；验证表仍有两个独立求值点。

独立 Standards 与 Spec 两轴均未发现新增问题。后续 Provider 复测与豁免属于另一阶段，不计入本只读复查的通过依据。

[完整性核验](readonly-integrity-result.json) · [实际角色只读复验](readonly-owner-rls.log) · [Standards](readonly-standards-review.md) · [Spec](readonly-spec-review.md)
