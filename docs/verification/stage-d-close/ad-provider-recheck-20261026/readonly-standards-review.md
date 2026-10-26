# #146/#147 SQL closeout read-only Standards review

## Critical issues

未发现。当前五个本轮文件均与最终 source manifest 的 SHA 一致；manifest 明确只有 043、两项集成测试和两处 043 注册为本阶段增量，并记录旧 41 项源码未变（`source-manifest.json:237-251`）。HEAD 仍为 `bbd2987`，无暂存文件、无新增提交。

043 是前向 `ALTER POLICY`，仅将三个 Owner helper 调用包入无关联 `SELECT`，没有增加授权、表、角色或写路径（`db/local/043-owner-policy-initplans.sql:1-23`）。两处迁移注册仍对已应用文件拒绝 SHA 漂移（`scripts/local/migrate.mjs:7-11`; `scripts/local/native-restore.mjs:39-43`）。这满足 ADR-0008 对真实事务身份、前向适配、旧迁移保留与隔离库的边界（`docs/adr/0008-local-execution-and-migration-contract.md:43-46,57-59`）。

## Important improvements

目录测试在固定、测试专用 clone 中以真实 `loop_app`、Owner 登录和 loopback HTTP 对照保留 RPC；随机 schema、UUID 校验和 `REPEATABLE READ READ ONLY` 使辅助 SQL 不扩出 fixture（`catalogContract.integration.test.ts:17-31,46-55,97-109`）。RLS 测试分别验证两 Owner 行集、缺失/伪造身份和 worker/anonymous 拒绝，并将观测以 `wx,0600` 写至私有目标（`ownerRls.integration.test.ts:23-40,43-71`）。

公开报告没有把有限样本扩写成生产性能或线上 Supabase 验收，并保留 fixture/red 记录、043 只应用于新库和不改旧库的限制（`report-146.md:11-15`; `report-147.md:15-21`）。索引同时保存公开红绿摘要与私有完整观测，未见秘密正文外泄。

## Optional notes

未见需报告的判断型 smell；临时 schema、角色桥接与计划遍历均局限在一次性隔离验收，不构成产品抽象或重复业务逻辑。

## Verification suggestions

无需重跑。后续四 Provider 的获授权复测应作为独立证据，不回写或重释本轮 #146/#147 红绿历史。
