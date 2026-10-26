# T12 / #118：纯 PostgreSQL 导入与目录只读贯通

基线 `61ee01d9af38c9ab1f7db7717efab1126c88ba4c`，独立 D 对话，隔离工作树。GitHub #118 保持 OPEN。原有 PLAN.md 和未跟踪票单未纳入实现提交；无生产切换、推送、合并、部署或真实秘密操作。

## 实现与迁移契约

`db/local/c-baseline.sql` 是 C 最终 v2 备份的结构（无业务行、Auth 或 Vault 数据），归档 SHA-256 `25e75bc66a2b7e16d294752606a121317982b84543b6296bfe927663c384b436`，来源时间 `2026-10-23T16:42:53.747Z`。导入器必须核对归档、媒体和该结构的一致性；旧 Supabase 迁移保留不变。原生 PostgreSQL 17.6 镜像固定 digest，独立容器 `loop-control-stage-d-postgres` / 卷 `loop-control-stage-d-data` / loopback DB 55472；应用 55177，不停止其他服务。

前向适配逐一覆盖：21 条 `auth.users` 外键改指保留原 ID 的 `local_identity.owners`；`auth.uid()` 从经过验证的服务事务身份读取（仅 `loop_app`，事务退出清除），角色函数从实际服务身份推导；策略角色映射到无登录的本地角色。5 个依赖 Vault 的函数保留签名但明确抛错，尚未迁移的连接命令不可用，没有 Auth/Vault 空壳。原有 RLS 保留；撤销 PUBLIC 的函数/表权限；`loop_app` 无超级用户/BYPASSRLS/建库/建角色，仅获目录表、成员表、导入元数据和必要成员检查函数的只读权限。凭据在本树私有配置，不进浏览器或日志。

`VITE_LOOP_BACKEND=local` 选择独立目录界面，经 `/api/local/catalog` 读取一个原生 PG repeatable-read 事务；默认旧模式 `supabase` 维持既有行为，未知值报错。local 不载入旧业务 App；旧业务客户端若在 local 模式被调用则报错；本地未接管命令返回 404，没有双写或静默回退。T12 登录暂时只桥接 verified 隔离 Supabase Auth（验证 ID），业务数据全部只读原生 PG；这是 T13 后续替换点，不能宣称断网登录已完成。当前本地界面仅目录，其他操作明确不可用。

## 验收证据

- [空库](empty.json)：38 表，0 业务行；身份 ID 单独保留。
- [导入](import.json)：38 表 / 20,379 行，全部表与归档原始 COPY 记录逐行集合 SHA-256 一致，所有外键反连接检查无孤儿；ID、快照、历史和引用保持。5 项 Vault 依赖及身份调用计数附在报告。
- 两张表的旧 JSON 排序 MD5 与源不一致。已用 C 精确最终恢复库确认两者逐行集合相同而顺序不同，根因是不同 libc 的 en_US 排序。保留旧 MD5 差异记录；最终采用归档 COPY 字节集合对账，未降低为只看行数。
- [真实 HTTP](http.json)：Owner 经 verified 测试 Auth 登录，读取 12 账号 / 12 蓝图 / 6,174 Episode，与 C 精确恢复库全部记录逐项相同。该快照系列为空；未省略此事实。
- [非空系列/不同 Owner](series-isolation.json)：明确标注合成认证，真实 HTTP 与 PG；临时系列、版本及规则完整返回，不同 Owner 无账号可见；夹具随后清理。真实 Auth 路径由上一项单独验证。
- 无会话 401、跨来源 403、写目录 405、未迁移派发命令 404。真实最小角色不能 UPDATE、不能调用 bootstrap RPC；连接复用后事务身份清除。实例没有 auth/vault schema。

运行入口：`node scripts/local/prepare.mjs`；`node scripts/local/restore.mjs --verified`（仅空目标，拒绝覆盖）；`node scripts/local/start.mjs`；`node scripts/local/catalog-acceptance.mjs`；`node scripts/local/catalog-fixture-acceptance.mjs`；`node scripts/local/check.mjs`。`stop.mjs` 仅停止已记录且身份匹配的 D 应用，不停数据库/其他服务。私有运行记录和原始日志在 `.loop-control/stage-d`。

## 保留失败与范围

执行环境短暂断开后检查镜像/进程，确认未重复未知操作。结构首次导出缺少 `--file`，已修正；导入首次旧 MD5 检查失败，保留目标并诊断排序差异后进行更严格原始行检查；COPY 列名解析首次不接受 sha256 中数字，已修正。真实 HTTP 首次发现 numeric 语速为字符串，已修正 DTO，重测通过。

直接 `npm test` 误搜保存的 `.loop-control` 旧工作树快照，同时缺少旧客户端测试配置，产生失败；保留日志，随后按 C 同一隔离环境及明确当前源码范围执行完整回归。没有删测试、提高超时或跳过当前失败项。完整回归与双审查结果在提交前后补记。

C 历史默认五秒不稳定、3 条既有 SQL advisor WARN、n8n 原生校验跳过、在线 Provider/真人审批链/恢复后登录未测保持有效。T12 未验证后续本地生产工作流、媒体执行或离线 AI 生成；T13–T25 继续按依赖推进。

## 完整回归与审查修复

当前源码默认 5,000ms：81 文件 / 703 项通过，Node 2 过 / 1 既有跳过；应用与本地服务类型检查通过，见 [checks.txt](checks.txt)。Standards 初审发现 pg `connectionString`/`stream` 可覆盖本机校验，已增加拒绝未知字段并只构造白名单 PoolConfig；新增测试先失败再通过。Spec 初审要求补足 ADR 的真实事务竞争证据：两个最小应用角色连接交错持有不同 Owner，独立管理连接提交合成系列修改后，旧 repeatable-read 快照不变，新事务看到提交；两真实写事务竞争同一合成行，后者在锁超时前未覆盖；再验证 12 个并发目录 HTTP 请求身份不串。合成夹具全部清理，原备份数据保持。

浏览器读取私有运行配置返回 403，见 [private-files.json](private-files.json)。T12 当前预期全部本地验收通过，最终双审查复核另存；不代表 Owner 事后人工批准、T13 或后续票完成。
