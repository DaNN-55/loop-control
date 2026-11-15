# 有效 schema 产物

先在专属隔离 PostgreSQL 17 中执行原 `baseline.sql` 和全部编号迁移。禁止使用日常连接或把备份中的数据写入基线。

1. 在该库执行 `current-catalog.sql`，保存 JSON。
2. 执行 `node scripts/schema/generate-types.mjs <catalog.json> src/lib/database.types.ts`；加 `--check` 只核对，不写文件。列是否可空、默认值、generated 列、外键、枚举、可执行函数及重载来自实际目录。私有无授权／触发器函数不作为调用接口；SQL `text` 不猜成业务枚举。
3. 使用同库 `pg_dump --schema-only --no-owner`。确认无业务种子数据，再执行 `node scripts/schema/generate-baseline.mjs <schema.sql> db/current`。生成的 `effective-manifest.json` 固定原基线与前向迁移哈希。
4. 执行 clean-schema 隔离矩阵、有效类型对账与恢复回归后验收。旧文件和旧 ledger 不改。

clean-v3 新库只登记 `clean-v3.sql`；映射表示累计覆盖，不声称逐条执行过旧迁移。旧 clean-v2／legacy-v1 库继续原升级路线，不增加或重写 clean-v3 标记。后续编号迁移在累计覆盖之后继续追加。构造旧版本夹具时不使用超出该版本的累计基线。

`src/lib/history/databaseV1.types.ts` 仅用于原 remote-view/v1、历史快照／旧工作版本解码；当前 SQL 类型不从历史类型重导出。当前域 DTO 可按已验证业务约束收窄 SQL text，不修改生成结果。
