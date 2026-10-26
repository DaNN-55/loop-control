# B 阶段：完整恢复与 Worker 租约

2026-10-23（Asia/Shanghai）。基线 `19f1607`，分支 `codex/local-first-stage-a`。Owner已认可B最终验收，并批准A、Accepted ADR-0008及B本地提交；不推送、合并、切换生产或关闭Issue。已用gh读取 #110 / #111 全文及全部评论（均无评论）。最终验收以 **v2备份与 `loop-control-stage-b-verified`** 为准；早期restore/replay证据保留为历史。

## T04 / #110

- 真实PostgREST先复现旧表 `experiments` / `metric_snapshots` 的404（`t04-red.txt`）；修复为当前32业务表。`export` 单独报告 `best_effort`、`restorableBackup:false`；`health`单独检查项目/CLI/服务。定时备份与提醒属T09，本次不提前实现。
- `isolated:backup` 在同一PostgreSQL exported snapshot中获取业务schema/data、迁移历史、逐表数量/内容摘要、Owner稳定身份和规范化安全指纹。数据库产物/音轨/材料引用必须匹配媒体清单的SHA-256与大小，复制后复检源及副本。要求暂停媒体写入；缺失、变化或容量限制会导致无有效manifest的失败。
- **最终v2真实空库恢复**：32表/90行业务内容逐表一致，244项对象/Owner/ACL/默认ACL指纹一致，75媒体文件逐一SHA-256相同。pg_restore在事务内重建并验证外键；保留原Owner和授权。仅显式映射部署媒体根，历史任务包/审核快照保持原值。见 `t04-verified-restore.txt`、`t04-backup-final.txt`。
- Auth密码/会话/token、Vault数据及宿主配置不备份。Owner ID保持，恢复时建立新随机登录密码。未解析秘密追加invalid记录；现有RPC显式轮换新连接版本并验证后可解析新秘密，旧版本继续阻塞。真实Provider凭据应由Owner重新录入、执行真实连接测试，再显式修复受影响配置；本演练用随机合成秘密，不调用在线Provider。
- 实际打开恢复的真实三镜头Episode `13029a1c` 并查看产物索引，见[最终截图](restored-episode-v2.png)、`browser-verified.txt`。非空审核、审批、状态历史另由独立DB checkpoint `d96d613d` 准备，仅用于内容/关联对账；其UI提示文本产物路径无效（fixture使用视频而非完整文本审核包），不作为可用审核包或完整Owner审批链证据，见保留的 `restored-checkpoint-v2.png`。恢复媒体ffprobe可读；归档/媒体篡改、非空库覆盖均拒绝，测试后原字节还原，见 `t04-verified-checks.txt` / `t04-verify.json`。
- **恢复权限问题已关闭**：早期restore/replay继承目标默认授权，数据一致但多出anon函数权限。全SQL对比发现后未将其归为既有失败；修复为在新空目标暂清public的schema-specific默认ACL，归档随后重建源ACL，再强制安全指纹对账。v1备份明确不接受为当前恢复输入。旧目标保留诊断，不代表最终验收。

## T05 / #111

- 先真实复现仅过期running、过期任务占满同组时空领取（`t05-red.txt`），再复现过期心跳复活和缺少token（`t05-fencing-red.txt`）。独立回收在ready选择与容量计数之前运行，回收/领取共享短事务advisory lock，活跃行锁使用SKIP LOCKED。全机容量、公平与常驻调度仍属C。
- token在领取事务同时写task、task_run和冻结包；Worker续租仍5分钟/30分钟窗口，心跳、进度和结果统一校验task、零起始attempt、token及有效租约。`tasks.attempt=Worker attempt+1`保持不变。进度在一个事务更新正确task/run；过期只结束当前run，预算未尽置ready、已尽置failed，历史保留。
- 旧结果/进度/心跳、错误token及无token旧API均拒绝；内部未加围栏入口撤销service_role执行权限。结果继续经过既有业务事务写产物。原SQL回归已升级为真实领取token和三参续租，并验证旧入口拒绝/权限；WhisperX源码匹配改为真实领取。受影响37条SQL通过。
- 最终verified空库先完成T04，再一次应用完整前向迁移，历史230→231（`t05-verified-migration.txt`）。11项真实DB检查通过（`t05-verified-leases.txt`），包括两个连接经锁屏障同时等待后只领取一次、续租持锁与回收先行两种顺序、预算终止、旧结果不覆盖新run/产物索引。
- 真实Worker进程组领取后SIGKILL，仅终止自己新建组；通过DB控制时间模拟租约超过30分钟，经既有 `/_episode-dispatch` HTTP handler → 预构建真实Worker CLI → FFmpeg → 文件/DB回写，得到 `0 failed → 1 completed`，SHA-256一致，旧进程结果拒绝（`t05-verified-worker.txt`）。没有等待真实30分钟。
- 隔离HTTP harness用既有middleware测试依赖入口注入verified配置，绕过A shell/worker.env.local。55176只开放此受Owner校验的本机派发测试入口，其余本机工具503；不替代生产启动链或C的持久入口。

## 最终验证与历史失败

末次应用回归于19:08（Asia/Shanghai）完成：70文件/675项通过，Node2通过/1项原生n8n检查跳过；类型、Worker与orchestrator构建、11个B脚本语法及diff检查通过。`tests.txt`为所有代码修复后的末次日志，最终库advisors为No issues found（`advisors.txt`）。Standards/Spec两轴只读复审及增量确认见 `review.md`。

**历史快照（修正前）**：全SQL在最终verified库执行21文件/223条已运行断言：16文件通过，剩余5文件与未应用B的A基线失败项逐一相同，**不能称全SQL通过**；B相关37条通过。原始结果见 `sql-tests-verified.txt`、`sql-tests-baseline.txt`，逐项对照见 `sql-baseline-comparison.json`。当时尚未修复以下失败：

- `acoustic_alignment_priority_chain_test.sql`：1项Worker时序源码断言。
- `clip_interval_union_duration_test.sql`：1项时长源码断言。
- `external_connection_security_test.sql`：2项秘密解析/连接选择断言。
- `global_owner_connection_integration_test.sql`：2项全库连接数量断言。
- `shot_composition_contract_test.sql`：运行10项后SQLSTATE 42883（未定义函数），基线同样错误。

基线SQL使用19f1607原文件，在A隔离库每文件事务回滚，pgtap扩展也在事务内回滚；A业务数据与安全指纹仍与v2备份相同。首次SQL全套额外权限失败已由v2恢复关闭，不混入上述既有失败。

## 环境与取舍

A：55173 / 55431 / 55432；最终verified：55176 / 55461 / 55462，媒体独立sparseimage已挂载。早期restore为55174 / 55441 / 55442，replay为55175 / 55451 / 55452，仅保留诊断。均在loop-stage-a专用VM、portForwarder:none、独立loopback SSH隧道；A媒体和证据库未替换。

`boundaries.txt`确认源A业务和安全指纹未变、源230/目标231迁移、全部源Vault明文及Owner密码未进入归档和版本化证据、测试listener仅127.0.0.1；生产5173/5678仍为28388/28387，生产分支与原有未跟踪 `docs/architecture-map/`不变。未访问生产数据库或复制生产密钥/数据。

演练中修正了隧道先后顺序、管理角色默认ACL权限、HTTP root facade忽略测试依赖参数的问题。后者曾让A Worker对不存在的新UUID空领取，A指纹复查未变。真实Worker依次拒绝未挂载媒体、跨Episode源输入；通过独立媒体卷和将已恢复输入复制到当前Episode目录解决，未降低原校验。失败Episode和忽略目录诊断保留。

备份仍依赖兼容Supabase的实际Auth/Vault/角色环境，不是D的纯PostgreSQL交付；文件600，尚无加密和大规模流式传输。DB fencing不取消已发出的外部请求，也不是同UID文件沙箱；实际中断演练在重试前结束旧进程组，未验证仍存活执行器对同一路径任意写文件的对抗行为。

B 已本地提交：实现 `60b5af9`，仅五份 SQL 测试修正 `474b0d3`，均未推送/合并。Owner 已认可 B 并授权开始 C 的 T06；T07/D 未开始，E/F 搁置。既有未跟踪规划按票显式暂存。

## B 验收后补记（2026-10-23）

五份旧 SQL 已分析为 3 份断言过时、2 份 fixture 隔离问题；`474b0d3` 仅修正这五份测试，随后在最终 verified 库完整 SQL **21 文件/224 条断言全通过**。最终结果见 [sql-tests-final.json](sql-tests-final.json)。上文 223 条/5 文件失败以及原日志保留为修正前证据；不再代表当前门禁。Owner 已认可上述 B 最终结论。审核 checkpoint 仍仅证明内容/关联，秘密仍需显式重绑；没有在线 Provider 调用或完整 Owner 审批链证明。
