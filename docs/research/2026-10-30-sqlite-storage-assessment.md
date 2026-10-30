# SQLite 内容存储可行性评估

日期：2026-10-30。状态：评估，待决定；未批准迁移，未修改架构决策或真实数据。

## 结论

SQLite 适合本地内容索引和独立编辑文档，但目前不值得替换主项目 PostgreSQL。建议继续使用现有主库；尚无证据证明需要新增生产索引。若要探索，先在隔离副本验证收益。

这次是在重新评估 [ADR-0008](../adr/0008-local-execution-and-migration-contract.md) 已作出的选择：单机、单 Owner、多个内容账号仍采用 PostgreSQL，因为领取事务、行锁和大量函数的重写收益不足。当前本地运行架构和 SDK 的 SQLite 存储值得重新比较，但 SDK 兼容修复不代表主库迁移已经完成或获批。

## 按存储对象判断价值

| 范围 | 可行性与收益 | 建议 |
| --- | --- | --- |
| 可重建索引、缓存、临时状态 | SQLite 可统一查询和事务更新；简单配置 JSON 改库收益小 | 有检索、增量更新需求再用；不搬纯临时文件 |
| 内容正文、脚本版本、编辑元数据 | 可以用 TEXT/BLOB 加版本表；能集中检索，但要保持版本、原字节和引用一致 | 可试派生索引；正文权威与版本关系暂不迁移 |
| Episode 状态、审批、审计、预算、Worker 队列 | 技术上可重做，但涉及权限和并发业务合同 | 保留 PostgreSQL |
| 视频、音频、图片 | 可存 BLOB，但会改变现有工具读文件、范围读取和备份路径 | 保留文件系统；数据库存路径、SHA 和元数据 |

官方把桌面应用文件格式、缓存、临时数据库列为适用场景，同时指出大量并发写入更适合客户端／服务端数据库。这支持局部采用，不能推导出本项目整库替换更划算。[SQLite 适用场景](https://sqlite.org/whentouse.html)

## 当前源码说明了什么

- [openchatcutStudio.ts](../../src/worker/openchatcutStudio.ts) 的 `readStoredProject` 优先读 SDK 的 `kv` 表，`writeStoredProject` 在编辑器退出后事务写入；旧 JSON 仅兼容旧格式。它仍是编辑器工程边界，详见[本轮验证](../verification/local-main-batches-20261030/REPORT.md)。
- [workspacePreparation.ts](../../src/local-app/workspacePreparation.ts) 从 PostgreSQL 取得脚本版本，再按路径、SHA 和大小读取正文文件；准备包和恢复工程 JSON 是有哈希的产物，不能统称缓存。[084](../../db/local/084-four-step-workspace.sql) 把工作区与脚本版本、审核包及工程指纹关联。
- [workerDatabase.ts](../../src/local-app/workerDatabase.ts) 校验 `loop_worker` 角色并调用领取、续租和回写函数；[097](../../db/local/097-workspace-image-generation.sql) 在数据库中处理预算预留。这里依赖 PL/pgSQL、RLS、`SECURITY DEFINER`、事务锁和租约围栏，远超 SQL 语法替换。
- [运行配置](../../scripts/runtime/environment.mjs) 仍绑定 PostgreSQL 容器；[ADR-0013](../adr/0013-native-runtime-file-boundary.md) 要求保留 `db/local/` 原始字节和 SHA，[ADR-0017](../adr/0017-legacy-html-editable-workspace.md) 要求保留旧工程和审核证据。未来迁移必须前向适配。

本轮[只读目录统计](../verification/local-main-batches-20261030/sqlite-inventory.json) 为 96 张表、341 个函数、66 条 RLS policy、86 个非内部触发器，其中 307 个函数为 `SECURITY DEFINER`。这些数量说明耦合规模，不等于全部必须逐个手写，也不能直接换算工期。

## 收益与必须承担的成本

完整替换有机会省去 PostgreSQL 服务和容器维护；局部 SQLite 不会消除这些依赖，反而增加备份对象。正文分库还会让「版本登记、内容保存、审批绑定」跨两个数据库，失去当前单库事务边界，必须另做恢复协议。没有实测，不能声称节省多少内存、启动时间或查询耗时。

单 Owner 不等于单写入者：应用、调度器、Worker 和编辑器仍会竞争。SQLite 支持多个读事务，但同一数据库同时只有一个写事务；`BEGIN IMMEDIATE` 也可能返回 `SQLITE_BUSY`。WAL 允许读写并行，仍需短事务、超时与重试，长读事务还可能阻塞 checkpoint。[事务](https://www.sqlite.org/lang_transaction.html)、[WAL](https://www.sqlite.org/wal.html)

项目要求 Node 24。本机只读检查得到 Node v24.20.0、内存库 SQLite 3.53.4；`node:sqlite` 可避免新增驱动包，但 `DatabaseSync` 同步执行，锁等待和大查询会占用调用线程。Node 24 文档将其标为 release candidate，应固定实际运行版本；SDK 自身运行时版本仍需另查。[Node 24 SQLite API](https://github.com/nodejs/node/blob/v24.20.0/doc/api/sqlite.md)

外接本地磁盘不是禁用项，但必须支持可靠锁和同步，检查挂载、空间及异常断开；WAL 不支持网络文件系统。推荐活跃库留在稳定本地盘、外盘存媒体和验证过的备份。在线备份使用 Backup API 或 `VACUUM INTO`；不能运行中只复制主文件或随意删除 WAL。恢复还要核对外部媒体指纹。[备份](https://sqlite.org/backup.html)、[损坏原因](https://www.sqlite.org/howtocorrupt.html)

## 建议的最小验证

如后续决定试验，先在独立临时目录用脱敏样本建立「脚本正文与镜头检索索引」：原文件和 PG 版本仍是权威，SQLite 仅按版本 ID、SHA 重建，不写审批或任务，不接日常服务。不要再形成两个可编辑正文源。

成功条件：删库可重建且版本、SHA、检索结果一致；两个真实连接竞争、强制退出、重开、磁盘满及备份恢复不丢已确认内容；记录延迟、锁等待和事件循环阻塞，证明实际检索收益。并发 WAL 试验前核实各运行时已包含官方 WAL-reset 修复；本机 3.53.4 符合，不能仅凭 `24.x` 推断。[修复版本](https://www.sqlite.org/wal.html#walreset)

若长期目标是去掉 Colima/PostgreSQL，完整 SQLite 方案仍有部署简化价值，但需先在隔离库重建权限、预算、队列、防重与历史恢复合同，再安排一次明确切换及回滚；不能让同一 Episode 的业务事务跨两库或长期双写。

本轮仅检查源码、官方文档和内存库版本；未做基准、故障注入或迁移。后续采用须有实际检索、启动或恢复收益支撑。主库替换需另提 ADR，再决定是否取代 ADR-0008。
