# 后端与 SQL 最终残留复查

此报告记录清理前发现。后续已授权并完成 204／205 清理、重复检查及日常应用，最新结论见 [清理验收报告](../residue-cleanup/REPORT.md)。

日期：2026-11-15，T12 验收完成后的当前工作树。**仍有旧流程死代码和资料残留；本轮没有发现对当前普通运行角色可达的旧制作入口。** 已知 47 个清理目标全部不存在，最终函数体也没有调用它们。

本轮只检查并记录，没有修改产品代码、SQL 迁移或日常部署，没有提交或推送。API、SQL、Worker 分组只读复查，主 Agent 核查关键结论并执行隔离 PostgreSQL 实查。

## 确定残留：8 个旧写函数

这些函数仍存在于最终有效数据库，并非只出现在历史迁移文本中。函数体仍保留旧制作写入行为，但已断开所有已发现的运行消费者：

| 函数（public） | 旧行为 | 当前有效基线位置 |
| --- | --- | --- |
| `create_shot_preparation_review_package(uuid,uuid)` | 从旧镜头准备记录创建 production-ready 审核包 | `db/current/effective-baseline.sql:7664` |
| `orchestrate_final_render_tasks(uuid)` | 创建旧最终渲染任务 | `db/current/effective-baseline.sql:9565` |
| `orchestrate_review_render_tasks(uuid)` | 创建旧审核渲染任务 | `db/current/effective-baseline.sql:9583` |
| `record_publish_input(uuid,text,text,text,bigint)` | 登记旧交付输入产物 | `db/current/effective-baseline.sql:9890` |
| `record_publish_package(uuid,text,text,bigint)` | 登记旧发布包产物 | `db/current/effective-baseline.sql:9919` |
| `record_publish_package_verification_before_workspace(uuid,text,bigint)` | 旧发布包验证、完成任务和阶段记录 | `db/current/effective-baseline.sql:9958` |
| `register_manual_a_roll(uuid,uuid,text,uuid)` | 登记旧手工 A-roll 完成任务及产物 | `db/current/effective-baseline.sql:10227` |
| `register_manual_b_roll(uuid,uuid,text,uuid)` | 登记旧手工 B-roll 完成任务及产物 | `db/current/effective-baseline.sql:10359` |

8 个函数均为 `SECURITY DEFINER`，但 `loop_app`、`loop_owner`、`loop_worker`、`loop_anonymous` 均没有 EXECUTE；8×4 次真实 SQL 调用全部得到函数权限拒绝。运行源码、最终函数体、trigger 和 `pg_depend` 均未发现消费者。证据：[old-write-denials.json](old-write-denials.json)、[confirmed-unreferenced-functions.json](confirmed-unreferenced-functions.json)、[dependencies.json](dependencies.json)。

因此这是清理完整性问题，不是已复现的当前越权、自动付费或旧任务重新执行问题。后续物理清理应新增前向迁移，先检查函数体与 catalog 依赖，再逐签名 `DROP ... RESTRICT`；不能回改已经采用的 baseline 或原迁移。

## 测试与资料残留

- `src/local-app/retiredMediaOrchestration.integration.test.ts:12` 和 `src/local-app/legacySqlHelpers.integration.test.ts:26` 仍要求两个旧 render orchestrator 必须存在。原本的保留断言在后续入口删除后未同步收敛。它们属于测试合同残留，不能当作运行消费者；清理上述函数时须同步调整这些断言。
- `docs/architecture/state-machines.md:56`、`docs/architecture/state-machine-map/architecture-data.json:561,569,574-577`、`docs/architecture/state-machine-map/index.html:77` 仍把已删除的 `studioCommands.ts` 及 `embeddedStudio.integration.test.ts` 列作 M25 的实现／验证。该地图有历史核查日期，但正文仍指导开发者按表定位当前 owner，应更新到当前工作区 Studio，或明确标为历史快照。
- `src/local-app/client.ts:24` 的重试排除表还留着 `openStudio`。这只是失效名称，没有消费者可借此执行旧命令。

## Worker 与后端类型壳残留

- `src/local-app/mediaWorker.ts:33` 的 `nativeMediaTask` 和 `src/local-app/localWorkerCli.ts:52` 的 preflight 仍登记 `generate_review_render`、`generate_final_render`、`generate_shot_sync_preview`。但领取、加租约和 CLI 执行前都要求 `current_worker_task` 及准确 lease，这三个旧类型不在当前 provenance gate 的允许集合中，所以是不可达分支，不是旁路。不能据此删除共享的 `executeOpenChatCutRender`，当前 card-video 和历史快照读取仍有消费者。
- `db/current/201-close-retired-manual-execution.sql:223` 的 `input_media_connection` 仍含 `prepare_visual_brief` 旧连接分支；前置 `assert_current_worker_execution` 已使其不可达。若清理应使用新前向迁移，不回改 201。
- `src/local-app/episodeCommands.ts:29` 的 `InputRuntime.localClipReady` 及 `src/local-app/localWorkerService.ts:59` 的实现无当前消费者；`postReady` 的 `source`／`preview` 分支也无消费者，当前字幕只调用 `alignment`。可作为后续收窄类型与实现的独立清理项。

Worker 复查没有发现常规角色可触发的旧自动续跑、配置修复或类型伪装。自动失败重试／租约恢复只处理已经通过当前 gate 的任务，不创建旧制作请求。

## 另外 7 个只读 helper 候选

以下 helper 无普通角色授权，未发现运行源码、函数体、trigger 或 `pg_depend` 消费者；属于后续清理候选，不把无运行引用等同于已经验证可直接删除：

- `local_identity.owned_studio_frozen_reference(uuid,jsonb)`
- `public.assert_current_storyboard_shot(uuid,uuid,text)`
- `public.clip_segment_union_duration(jsonb)`
- `public.current_openchatcut_review_package(uuid,boolean)`
- `public.has_required_artifacts(uuid,public.episode_stage)`
- `public.is_allowed_episode_transition(public.episode_stage,public.episode_stage)`
- `public.shot_composition_playback_duration(jsonb,jsonb)`

其中 `owned_studio_frozen_reference` 仍被 `src/local-app/nativeStorageSql.integration.test.ts:14` 直接测试。后续删除须先确认该保护合同已由当前实现承担。此次没有删除函数或修改这些测试。

## 必须保留的内容

- `is_valid_shot_audio_mix`、`is_valid_shot_composition` 有真实 CHECK 约束依赖，不是死函数。只搜索源码调用会误判它们。
- 历史工程／旧镜头读取及 Owner 明确来源接入、冻结证据、已有未知提交与准确旧租约的终态核对仍承担当前职责。
- 当前画面／口播／字幕／声音与交付使用部分历史任务类型和共享 Provider 执行器，不能按 A-roll、B-roll 或 legacy 字样整类删除。
- 旧 HTTP 命令的认证后 410 拒绝表、归属／CSRF 检查和旧运行包拒绝逻辑应保留。当前旧命令在任何新回执、任务或登记写入前被拒绝，没有发现假排队旁路。
- 原迁移、基线和历史类型中的旧名称属于升级／恢复证据；判断实际残留以最终 catalog 和调用链为准。

## 本轮实际验证与边界

- 在独立、仅 Unix socket 可达的原生 PostgreSQL 17 中装载当前完整 schema；导出 **330 个函数**（定义、ACL、四角色可执行性）、**105 个 trigger** 和 `pg_depend`。47 个已清理签名均不存在，最终函数体引用为 0。
- 对新增识别的 8 个旧写函数实际执行 32 次普通角色拒绝调用，全部通过。见 [catalog-result.json](catalog-result.json)。自有集群停止、目录删除，没有连接日常数据库。
- 4 文件 18 项退役扫描、schema、旧运行包和连接读取检查通过；另 4 文件 26 项 Worker 数据库、调度、结果合同和命令回执检查通过，合计 **44 项、0 跳过**。见 [tests.json](tests.json)、[worker-tests.json](worker-tests.json)。
- 三组只读复查均未发现新的当前旧执行入口；发现的死函数、测试断言和地图断链按本报告记录。此前 T12 与日常验收不冒充本轮重跑。

本轮没有重新运行完整业务浏览器、全套测试、付费 Provider 或日常 HTTP／catalog 漂移检查；结论针对当前仓库最终 schema 与应用角色。超级用户仍可直接调用未删除的函数，不在“普通执行面已关闭”的结论内。未纳入仓库的外部高权限客户端不属于本次可证明范围。
