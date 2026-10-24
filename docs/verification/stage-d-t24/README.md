# T24：本地数据库、密钥绑定及媒体恢复闭环

2026-10-24 至 25（Asia/Shanghai）；分支 `codex/local-first-stage-a`，基线 `20e93bd8f80c8de8774806a666ba616a3b133e88`（T23）。证据目录沿用开工日期 `t24-20261024`。

**T24 实现及受控离线本地验收完成，本报告随实现按后续授权纳入当前分支的本地提交。** 新库、独立 APFS 媒体、原 Owner 新密码、真实专用 Keychain 缺失重绑、真实 HTTP/Chrome 审核及原生 Worker CLI 续跑通过。最终默认 **5000ms、98 文件、749/749 通过**。**T21 当次及历史默认 5 秒失败继续保留，根因未解决；本轮通过不关闭历史问题。** 未新增在线请求、操作生产、推送、合并或开始 T25，也没有执行 F 阶段总体发布验收。

## 票单、依赖和范围

依据工作树中已发布的 T24 / [#130](https://github.com/DaNN-55/loop-control/issues/130)，先核对三项验收：本地身份、队列和连接引用的一致备份；新库、独立媒体和 Keychain/重新录入恢复；恢复后的读取、审核及一个受控任务继续。依赖 [T22 / #128](../stage-d-t22/README.md) 和 [T15 / #121](../stage-d-t15/README.md)，并沿用 [T23 备份/自动化](../stage-d-t23/README.md)、T13 Owner/RLS、ADR-0008 的冻结快照及媒体部署映射契约。遵守零新增在线请求，未联网刷新或改写 GitHub 票单状态；本地规划票单保持原样。

沿用批准的专用 PostgreSQL（55472），从隔离 `loop_t23` 创建 `loop_t24_source`。主恢复目标是空库 `loop_t24_restored2`，媒体位于本轮新建 APFS 镜像的 `restore-volume/restore2/media`；另有 v1 兼容及再次备份恢复的新库和目录。只复用该隔离实例已有的最小角色与本机工具链，**没有验证新主机角色配置、默认部署或生产迁移**。原 `loop_imported` / `loop_empty` 仅应用不可变前向 038 迁移，不启动消费者；旧 `loop_t23` 未应用 038。

## 实现

- 原生备份读取兼容 v1，新增 v2 的全表 COPY 多重集指纹、序列、完整 schema 安全摘要和扩展元数据。一个导出快照覆盖 public/local_identity/loop_internal；身份、任务队列、连接版本/秘密引用、幂等回执和运维/通知账本均保留，密码摘要、登录会话、Keychain 值及宿主数据库凭据不导出。
- `scripts/local/native-restore.mjs` 只接受批准路径和全新 `loop_t24_restore*` 库，先验证归档及每个文件，恢复后逐表逐行、逐序列、权限和外键对账，再独立从 DB 检查全部媒体引用。已有库/目录拒绝覆盖；新库 pending，全部检查及媒体发布完成后才 ready，失败库/部分目录保留。v1 没有源安全指纹，不虚构完整 ACL 摘要对比。
- 038 仅增加私有部署记录/受控查询函数和源根别名。冻结蓝图、任务输入、审核历史与产物相对引用不递归改写；Owner 命令、文件入口、原生 CLI 和删除清理在 I/O 边界解析到新根。服务配置根不匹配或恢复未发布时，业务 HTTP/Worker 拒绝；会话查询/退出独立保留。页面通过单独增量 `localAssetRoot` 展示/复制新目录，不修改冻结蓝图。
- `owner.mjs <原 Owner UUID> --initialize-restored <新库>` 从有界 stdin 初始化新本地密码，不扩展成员关系。仅空凭据的已恢复库允许初始化；本轮验证一个原 Owner，旧密码/cookie 均无效。连接版本和引用不变，旧验证历史保留，所有部署相关资格清零；缺失秘密必须显式重新录入和重新验证。

## 验收证据

| 验收路径 | 实际结果 |
| --- | --- |
| 事务一致性与完整性 | 导出快照后才提交一条持有事务的事件，源库可见，恢复库 audit/通知账本均不可见；v2 **51 表、28,224 行、850 文件**，全 COPY、序列、356 个安全对象摘要、外键和索引媒体引用通过。[备份](evidence/backup-02-backup-result.json)、[主恢复](evidence/restore-02-restore-result.json) |
| 空库/独立媒体 | 真正从 template0 新库恢复，逐文件大小/SHA 校验，不用原库或旧媒体软链接。主服务及真实 CLI 的只读测试 guard 在 I/O 前拒绝原 stage-d/stage-b 媒体、外网 socket/fetch；guard 自检通过。错误部署根 HTTP 503、Worker 启动拒绝；failed/pending 库拒绝。[边界](evidence/boundary-result.json) |
| Owner、审核和队列 | 原密码/旧 cookie 401，新密码真实 HTTP 200；源任务仍 ready:0，恢复库同一任务 completed:1。备份中的旧 T23 审核包可批准并继续新分镜。新 T24 单在 Chrome 中批准视觉审核、请求分镜，刷新及跨服务重启后保持分镜审核。[HTTP](evidence/verify-02-http-result.json)、[浏览器](evidence/browser-final-result.json)、[实际截图](evidence/browser-20-restored-storyboard-final.png) |
| Keychain 重绑 | 本轮创建且仅使用专用 `t15-synthetic.keychain-db` 与可重建合成秘密。源项实际存取；删除源专用钥匙串并重新创建空链后，原引用真实 missing；通过 Owner HTTP rebind 恢复同版本/同引用，真实 helper 可取回。模拟 Provider probe 始终 `ready:false`，资格全 false，无在线资格声明。[缺失](evidence/restore-02-missing-keychain-result.json)、[重绑](evidence/verify-02-http-result.json) |
| 媒体真实可用 | 恢复 MP4 的完整 HTTP SHA 与 DB 一致，Range 206 字节一致；Chrome 在已有“最终生产材料”中实际播放，1080×1920、8.042667 秒、播放进度 >0、readyState4。[HTTP](evidence/restored-video-result.json)、[播放值](evidence/browser-33-play-result.json)、[实际截图](evidence/browser-35-restored-video.png) |
| 旧版与再次恢复 | T23 v1 实际恢复 **50 表/28,156 行/848 文件/738 引用**，原始对账后再前向 038。主恢复环境再次 v2 备份并恢复到第三媒体根，**51 表/28,294 行/853 文件/743 引用**及安全摘要通过；再次初始化新密码、真实 HTTP 读取同视频，证明多代逻辑根映射。[v1](evidence/restore-v1-result.json)、[再次恢复](evidence/roundtrip-result.json)、[HTTP](evidence/roundtrip-http-result.json) |
| 异常拒绝 | 错误选定摘要、损坏归档、越界 manifest、符号链接、已有库、已有目录和遗漏一个实际索引文件均拒绝。遗漏样本保留 pending DB/媒体，未发布。[结果](evidence/restore-negative-result.json) |
| 通知/历史与隔离 | 恢复后 3 条受控通知接口接受，无重复/已消费事件重发，其中 1 条为备份时 pending；6 条 reserved/uncertain 原状态保留。原库 **38 表/26,552 行**多重集一致、原媒体848文件一致、43个无关文件哈希一致；迁移 SHA、权限、连接引用、收尾检查通过。[审计](evidence/audit-01.json) |

原任务领取时按既有 T07 契约为 `runtime_constraints.resource_limits` 加入运行资源限制，**不能声称领取前后整个 input_snapshot 哈希相同**。恢复发布前全快照逐行相同；领取后的冻结业务输入（排除 runtime_constraints）在源/目标一致。恢复后新审核、任务、产物和通知追加，故再次备份的行/文件/引用数量合理增加。

## 回归、失败与原始证据

[完整默认命令与退出码](evidence/default-5s-01-result.json)、[原始日志](evidence/default-5s-01.txt)：**749/749**，没有超时覆盖，没有加本地前端模式影响测试。新增 2 项只测根映射、最长前缀和越界行为；既有断言/超时未放宽。全项目/原生 TypeScript、runtime 完整性、MJS 语法检查及[本地构建](evidence/frontend-final-01.txt)通过；[Node](evidence/node-final-01.txt)2 通过、1 项既有跳过。最终源码回归通过后仅进行额外恢复/只读审计和文档整理，没有再改业务实现，没有重复运行全量直到凑出通过。

保留以下失败，不用最终通过覆盖原始记录：

1. 首次源准备误以为专用链必须出现在 search list；实际允许缺席/单次存在且其他项完全不变，未设置 search list。新建链文件默认0644导致 adapter fail closed，仅将本轮拥有的新文件改0600；准备续跑又遇已有目录，检查归属后复用同账号/单/意图，最终 prepare04 通过，没有重复创建业务样本。原始 prepare01–04 私有日志均在索引。
2. restore01 已通过行/序列但安全摘要 **356 vs 320**，目标及 media.pending 保留。发现 schema-filtered pg_dump 不含 pgcrypto 扩展对象，且假定 public 默认 USAGE。恢复从已验证扩展元数据重建真实 pgcrypto，并在归档 ACL 前恢复该模板基线；全安全摘要不放宽，另建 restored2 成功。[差异](evidence/security-difference-01.json)。原失败库后来显式 failed，业务/Worker 实际拒绝。
3. verify01 错把既有领取时 runtime 限制加入视为冻结业务变化；比对真实差异后分别验证原始恢复及领取后业务指纹。私有 FS guard 初版丢失 realpathSync.native，影响 Vite；保留原日志，修正测试 guard 的函数属性后通过。页面目录一度显示旧冻结根，browser07 保留；新增独立部署展示数据后 browser12/18 及实际截图通过。
4. 补 pending 围栏时 SQL 字符串引号导致编译失败，启动因失效 runtime 拒绝；[类型原错](evidence/local-types-06.txt)保留，修正后 local-types07 / types04 / runtime05 与真实边界通过。主 restored2 早于 pending 围栏，但绑定目标根检查已生效；后续 v1/再次恢复成功及遗漏文件的 pending 拒绝均用最终实现验证。
5. 直接导航 MP4 的独立文档受既有 restrictive CSP 限制，没有播放；在实际产品“最终生产材料”中播放成功。一次等待已完成生产单的 Owner 文本超时，快照显示该阶段本无审批区，改用实际最终材料入口。网络解析最初只接受数字请求 ID 而拒绝 Chrome 混合 ID，修正后核对 **1110 个实际 HTTP 请求均为 127.0.0.1:55187**，原始网络记录仍私有，无 HAR。
6. 最终 audit01 误用用户文件名检查受控存储名；按 DB storage_path/SHA 核对两份输入。audit02 将 pending 账本行也视为已消费而报“重放”；暂停并检查实际备份 COPY 状态，最终只允许 pending 被继续消费，accepted/skipped/reserved/uncertain 不重放且6条未知原样保留。[原错1](evidence/audit-01.txt)、[原错2](evidence/audit-02.txt)、[最终](evidence/audit-03.txt)。未修改通知实现或账本以通过审计。

[索引](evidence-index.json)列出可公开原始日志/截图、私有文件与备份/部分恢复回执的 SHA。密码、cookie/CSRF、原始网络、SQL dump、Keychain 控制材料和备份都留在 `.loop-control`，不复制为公开证据。滚动 fixture/runtime/密码/指针不声称每一版均独立归档；编号日志独立保留，事件追加，早期首份备份指针另留。历史 [T17 中间日志覆盖说明](../stage-d-t17/README.md)继续保留。

## 限制和收尾

- **T21 当次及历史默认 5 秒失败、根因未解决**；本轮没有修超时、没有新增基线对照，也不将一次749通过当作关闭历史门禁或新的产品五秒保证。
- **既有 30 分钟 Worker 租约限制不变，未证明立即故障切换**。本轮恢复的样本在备份时 ready:0，不是有效租约立即接管；T23 受控 claimed_at 过期仍不是实际等待30分钟的证明。
- 真实 WhisperX 成功推理、默认部署、新主机、在线生成、其他 Provider、完整多能力 Worker尚未验收；既有 Provider 最小验证范围不扩大。本轮离线合成规划器和模拟 Provider probe 不代表在线生成/live资格。既有模拟资格、SecretStore替身限制继续保留；本轮专用合成 Keychain 的真实结果只补足本次重绑路径。
- v1 无源安全摘要，未声称完整 ACL hash 对照；v2 以实际源摘要对齐。只验证一个原 Owner 的新密码初始化，不声称多 Owner 凭据管理或通用生产部署验收。媒体和 DB 是独立资源，待检查状态使用 pending 围栏，并不声称跨文件系统/数据库物理原子事务。
- 仅停止本轮应用/Worker和专用Chrome、删除本轮合成浏览器认证项与本轮创建的专用测试链；默认/search list、登录/系统钥匙串与已有 ACL 未改，stage-d原模式已恢复。数据库、新媒体镜像、成功/失败恢复和私有证据保留；原服务/旧卷不停止。
- 43个既有无关文件（含根 PLAN/规划票单/output）原哈希保留，本轮计划在私有目录。验收收尾时未暂存或提交；后续本地归档见下文，仍不推送、合并或继续 T25。[主 Agent 本地复核](review.md)不等同独立评审或整个 D 阶段完成。

[最终范围与敏感值检查](evidence/scope-final-result.json)通过；索引空、HEAD仍为T23基线，公开证据/实现摘要和报告链接已核验。该检查的文件数量描述加入其自身记录前的快照，后续未改业务源码。

## 本地提交归档

2026-10-25 获用户认可并授权，将 T24 实现、验收报告、回归日志和证据索引提交到当前分支。此次仅更新归档状态和说明，业务实现及原始验收证据保持原样；没有重跑已经通过的验收。原始记录中的 `noCommit`、`indexEmpty`、基线 HEAD 和文件数量均为验收收尾时快照，不改写为提交后的状态；提交 SHA 以 Git 历史为准。

**T21 当次及历史默认 5 秒失败、根因未解决、既有 30 分钟租约限制及立即故障切换未证明**继续保留。真实 WhisperX 成功推理、默认部署/新主机、在线生成、其他 Provider、完整多能力 Worker 等未验收项，以及模拟资格、历史 SecretStore 替身和 T17 中间日志覆盖说明均不关闭。本次不纳入根 PLAN、无关规划票单/output 或含凭据的私有证据，原始网络、SQL、Keychain 控制材料和备份继续留在隔离私有目录；不操作生产、不新增在线请求、不推送、合并或开始 T25。
