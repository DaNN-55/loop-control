# 当前 SQL 代际

`baseline.sql` 是第二代空库结构，`upgrade-from-legacy-v1.sql` 只用于已校验的第一代目标；由 manifest 固定摘要，入口统一使用 `src/local-app/schemaMigrations.ts`。不要向已有库执行完整 baseline。

- 新空库：`freshSchemaTransaction()`。角色预先按项目权限合同建立，秘密不写入 SQL。
- 第一代维护：默认 `schemaMigrationPlan()` 只补齐归档迁移，不自动跨代。
- 全新恢复目标：原始数据/媒体/权限审计之后显式计划跨代；转换及新标记同一事务，旧 ledger 保持。
- 第二代后续变更：增加新的编号迁移，不修改已采用的基线、转换和历史文件；不得复用第一代版本名。

本代际尚未用于日常库。两个历史蓝图保护函数的旧标识和一条既有历史在途旁白失败见验收报告；不能据此直接切换日常库。
