# F2 当前类型与 clean-v3 基线

当前 `database.types.ts` 由隔离 PostgreSQL 17 有效目录生成，包含真实列可空性／默认值／generated、外键、枚举及有执行权限的 SQL 函数／重载。触发器与无授权私有函数不冒充调用接口。历史 remote-view/v1 类型独立保留在 `lib/history/databaseV1.types.ts`，仅供旧远端视图、历史 episode 快照及旧工作版本解码；当前 DTO 不从历史合同重导出。SQL text 的业务收窄写在 DTO，不伪造为数据库枚举。

新 `effective-baseline.sql` 固定前向迁移 166–200 的有效结果；`effective-manifest.json` 固定原 clean-v2 与全部覆盖文件 SHA。新库只登记实际执行的 clean-v3，旧 clean-v2／legacy-v1 继续原前向路线；不补造、改写或删除旧 ledger。旧前缀夹具回退原基线＋对应迁移，未来 forward 在覆盖之后继续。混合代际、缺失覆盖、错 SHA 和迁移缺口均拒绝。

生成器可再现核对，既有 clean-v3 字节变化或产物缺一均拒绝覆盖。原 `baseline.sql`、`manifest.json`、升级脚本与历史迁移未修改。完整备份恢复发布门槛支持已验证且无待迁移的 clean-v2／clean-v3，全部文件、Owner、目录身份和历史数据检查保持。

验证分批保留：

- 账本新能力先真实 2 项失败，再连同原 4 项共 6 项通过。
- `run-aHcPQL`：4 文件 5 项通过，0 跳过。含新／旧建库有效合同与生成类型逐字节相等、clean-v3 注入故障回滚、非空全库 dump 恢复，以及 198／199／200 RESTRICT 依赖阻止、ACL、原行、角色、序列、旧 ledger 保持。
- `loop-clean-schema-DkhPtZ`：完整旧源、083 旧前缀升级与 clean-v3 目录、561 项安全对象一致；非空行、序列、原 ledger、故障回滚、原撤销 Provider 历史保留与新写拒绝通过。120 张原表／7 条业务行核对；没有把空 schema 说成完整媒体恢复。
- `run-e6nAc3`：真实非空备份的 journal 中断恢复因只接受 clean-v2 而失败；不是文件或 Owner 保护失败。
- 修复后 `run-kdaMnp`：3 文件 **8 项通过，0 失败／0 跳过**。包含 journal／receipt／config／ready 四个真实 SIGKILL 中断点恢复与新应用 Owner 文件读取、三个夹具同快照／SHA 拒绝检查，以及实际类型生成、基线 `--check` 和非空全库恢复。完整类型与 Worker／backend 构建通过，自有容器已清理。
- 补充基线缺一产物拒绝覆盖 2 项、当前执行目录禁用退役入口扫描 1 项通过。未放宽损坏 SHA 拒绝测试，只同步更早拒绝的准确错误文案。

Standards 的 SHA 错误断言与缺一产物保护、Spec 的 clean-v3 恢复发布问题已修；当前真实结果支持上述结论。原始结果见 [evidence-f2](evidence-f2/)。F2 完成；最终审查新增 A1 自动音量／转录编辑 metadata 语义缺项由 G 补实证后关闭。

未操作日常，不调用真实付费或视频 API，不改共享 SDK，不提交、不推送。
