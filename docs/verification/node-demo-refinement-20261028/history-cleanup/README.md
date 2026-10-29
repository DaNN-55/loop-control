# 未归档资料来源只读核查

核查目标为管理员当前拥有、`history_source_preferences.archived_at IS NULL` 的来源（包括没有 preference 行的来源）。精确目标以 `manifest.json.sources[].id` 为准；没有执行归档、删除、数据库写入或文件移除。

当前 119 项为全部来源；未发现其他已归档来源。涉及 83,623 条来源记录关联、16,458 条文件索引、14,612 个不同历史版本和 10,370 份内容，内容计数约 3,155,551,356 字节。这不是可释放空间：663 份内容命中现有保护规则，213 份内容 SHA 出现在正式 public 表中，3,938 个历史版本有 inserted/current-preserved 投影记录。未删除来源共享数为 0 只代表来源之间，不代表无生产依赖。

生产历史视图进一步确认：7 个真实生产单的 744 条文件导航、5,775 条记录导航都由这批来源/版本支撑。全部来源索引直接删除会破坏已认可的生产单历史、下载与恢复证据。

## 交付证据

- `manifest.json`：119 项来源 ID、各项记录/文件/去重内容与字节数、版本键、逐 SHA 保护/共享分类、正式表 token 命中。
- `file-links.json`：16,458 条原始索引键、类型、字节数及 metadata 摘要；不保存原文秘密。
- `before/table-fingerprints.json`：73 组表/历史导航视图行数与确定性摘要。
- `before/production-history-navigation.json`：7 个真实生产单以及其历史文件/记录精确导航键。
- `before/content-inventory.json`：11,357 个磁盘内容文件的名称、大小、mtime、inode/dev；不是逐字节内容复验。
- `before/runtime-file-hashes.json`：部署设置、密钥索引、加密 Keychain 文件 SHA；没有读取秘密明文。

所有 SQL 在 READ ONLY 事务中执行。首次相关子查询扫描连接曾被服务端断开，改为逐表线性 token 扫描并设置 45 秒 statement_timeout 后完成；未重启服务或更改配置。指纹来自相继只读事务，执行前仍须固定 manifest 后重新验证一致性。

## 现有 API 的限制

`src/local-app/history.ts::manageHistory` 只允许 archive/restore/preview；delete 返回 400。`db/local/067-history-organization.sql` 的预览明确 `deletionEnabled:false`。本次不能通过前端宣称删除成功，也不应为一次清理开放通用删除 API。

## 方案 A：永久删除旧来源，保留生产单历史与业务依赖

此方案并非把 119 个目标归档：目标来源身份及其冗余索引真正删除，保留的是明确证明有生产用途的内容。

1. 先固定 119 个原来源 ID 和完整保留集合。保留全部生产历史视图对应的 5,775 条记录导航、744 条文件导航，以及公开业务表、保护映射、保留原文/档案成员间接引用需要的内容；按精确 version 键/SHA 而非名称匹配，递归补齐依赖。
2. 若保留原表结构，新增一个明确命名的“生产历史保留”来源锚点，kind 为专用保留类别，metadata 只含此次清理凭据与用途，立即标记为已归档。仅把已确认保留的 history_source_rows / history_files 精确重挂到该锚点；不要把所有 119 项原样搬进去。原来源的标题/路径身份随目标行真正删除。
3. 在 SERIALIZABLE 事务中，先插入保留锚点和去重关联，再删除目标来源偏好、目标来源关联与文件索引、无保留引用且不属于保留版本集合的投影结果/版本，最后删除固定 119 个来源。不能删除 public 业务表、Owner/权限、保护映射或未归档集合之外的对象。
4. 事务内校验正式表及其他保留表指纹；历史记录导航应逐键一致，文件导航应比较去除 source_id 的语义投影（source_id 重挂会改变身份，但 episode/path/SHA/bytes/kind 必须完全一致）；实际下载字节及 SHA 必须一致。先 ROLLBACK 演练，通过后相同固定范围提交。
5. 磁盘仅在数据库提交后删除无任何剩余索引/正文/档案成员/运行时引用且非保护内容的 SHA 文件；先做 inode/dev/size/nlink/SHA 校验，不能用 source count 或预览 reviewBytes 直接推算删除列表。尚未完成的间接扫描或无法读取的压缩档案必须记为 held。

锚点是因保留真实生产历史而存在的唯一技术要求；若产品要求连归档来源中也不出现保留锚点，应新增独立生产历史归属表并迁移查询/下载合同，这比一次清理多出持久模型变更，不宜偷偷用 CSS 隐藏。

## 方案 B：连生产单历史一起永久删除，保留真实业务

1. 固定同一 119 项来源，明确将 5,775 条历史记录导航和 744 条文件导航消失作为预期效果；public 中 7 个真实生产单及其正式业务、任务、审批、产物和媒体保持不变。
2. 先逐个确认正式业务实际读取路径。213 份正式表 SHA 引用、663 份保护内容不能因其历史归属而删除；有重叠，不能直接相加。按运行时读取合同保留物理内容、保护映射及必须存在的索引。
3. 若运行时下载仍依赖 history_files/history_sources，则这些被运行时使用的记录不能直接清掉。可建立唯一、已归档的“业务依赖保留”来源，精确承接所需索引（不保留纯历史内容），或先实现独立业务依赖索引后再删除历史归属。两者均需如实报告保留项，不把它称为历史全删。
4. 对排除业务依赖后的 history_source_rows、history_projection_results、history_versions、history_files、source preferences 与 119 个原来源做固定键删除；不删除 public 业务行、身份/密钥或运行时原始媒体。
5. 与方案 A 相同，事务回滚演练和保留指纹通过后才提交；物理删除仍需完整间接引用/档案成员扫描，遇到 held 必须保留并列出。

当前两种方案都尚未达到可执行物理删除的证据状态。用户关键范围答案到达后，由根 Agent 固定保留集合、执行回滚演练和最终清理；本子任务只交付只读证据与方案。

## 用户范围已确定后的落地合同

用户已选择保留生产单历史与真实业务依赖，永久删除其余来源资料，来源列表清空。根 Agent 已同意独立保留模型，替代上述方案 A 的归档锚点：

- `db/local/075-history-production-retention.sql` 新建 `history_retained_files` 与 `history_file_catalog`。保留表没有 source_id 外键，不创建虚假来源；统一只读目录为保留文件提供 `source_id=NULL` 的内部身份，来源列表仍仅查询真实 history_sources。
- 原始 `history_versions` 独立于来源，本身无需新保留版本表。生产历史记录、账号标题回退和必要依赖版本可保留；来源列表计数和内容查询限定仍有关联来源的版本，生产详情的 version= 查询照常读取保留原文。
- 迁移不包含数据移动或删除。真实数据迁移/清理由根 Agent执行；本子任务只在独立临时数据库验证合成数据，真实库未写。
- `retention-files-direct.json` 是直接证明的下界：1,599 条原索引，去重为 1,502 个 owner/path/SHA 键、876 个 SHA。其理由包括 744 个生产导航文件键、现有保护内容和当前正式表 SHA 引用。97 条可合并重复索引的 metadata 摘要完全一致，没有同键不同 metadata 的冲突；将来执行前仍要断言。
- `retention-direct-selection.sql` 提供只读的精确初始保留选择。`before/production-history-navigation.json` 的 744 条文件导航在去除 source_id 后仍是 744 个唯一语义项，5,775 条记录导航键唯一。

最终保留闭包至少还要覆盖：保留版本中引用的其他历史实体版本；catalog 回退用的 account 版本；保留文件正文内的 SHA/路径与档案成员引用；metadata replacements、protected_sha256 及原始摘要对应内容；正式 public 数据中运行引用的内容。对多版本实体可按完整(table_name,row_key,payload_sha256)固定集合保留，避免以 owner_id 或账号公共 UUID 误把全部旧配置纳入闭包。压缩档案和无法判明正文依赖的项必须 held，并列出具体理由。

隔离集成已通过：真实 native PostgreSQL 的 schema-only 临时库应用075；删除合成 source/source_rows/files/preferences 后，原生产详情、下载、预览共享判断不变，来源列表/计数为0；跨Owner访问保留表/下载被拒绝；保护映射只返回净化副本；秘密引用扫描仍包含保留metadata与文件；loop_app 对保留表 INSERT 被42501拒绝。测试未复制真实业务行、未读秘密明文，结束回滚并删除临时库。
