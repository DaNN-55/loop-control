# SQL closeout Standards review

审查限于 043、两项新增集成测试、两处迁移注册和 `ad-sql-closeout-20261026` 公开报告；未运行 SQL、测试或服务。

## Critical issues

未发现。043 仅以 `ALTER POLICY` 把三处 Owner 函数调用置于无关联子查询，未改变 policy 名称、角色、命令、授权或行谓词（`db/local/043-owner-policy-initplans.sql:3-23`）。这符合 ADR-0008 要求的 Owner/应用角色边界、前向适配并保留旧迁移（`docs/adr/0008-local-execution-and-migration-contract.md:43-46,57-59`）。`migrate.mjs` 和 `native-restore.mjs` 相对前 43-file 基线各只有 043 注册，且仍拒绝已应用 migration 的哈希漂移（`scripts/local/migrate.mjs:7-11`、`scripts/local/native-restore.mjs:39-43`）。

## Important improvements

`ownerRls.integration.test.ts` 在显式隔离 fixture、实际 `loop_app` / RLS 角色下检查两 Owner 行集、无身份/伪 GUC 拒绝和 InitPlan 的单次循环；动态 SQL 的 role 是联合类型、Owner ID 先 UUID 验证，测试证据写入以 `wx,0600` 限制（:23-40,43-71）。无秘密或外部 Provider 输入。

`catalogContract.integration.test.ts` 将旧 RPC 安装到每次随机的测试 schema，唯一 `auth.uid()` 替换先断言数量，并用真实 loopback HTTP、独立固定期望和同一 RLS 身份比较（:17-25,46-55,97-159）。这遵循 ADR 对真实 HTTP/DB 同路径验证的要求（ADR-0008:57-59）。报告准确保留 fixture/red 记录，明确不主张生产性能或线上 Supabase 覆盖（`report-146.md:11-15`; `report-147.md:15-23`）。

## Optional notes

未见需报告的 Fowler 判断型 smell：测试辅助仅在单个隔离边界使用，未引入可疑抽象、重复领域分支或跨模块散射。

## Verification suggestions

最终索引追加时保留 043 SHA、043 仅新库应用和 146/147 的 red→green 说明；无需修改本轮源码。
