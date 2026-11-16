# 日常部署与采集启用

2026-11-16 已完成；11:54:08（Asia/Shanghai）起为当前实际 Owner 开启制作事件和运行时资源采集。日常服务运行中，当前空闲。没有触发新的付费生成。

## 计划与结果

- [x] 核验日常 PostgreSQL 身份、Owner 归属、任务、运行记录、发布保护、Studio 和导出子进程；保存配置、运行清单和工作区指纹。
- [x] 重建原日常运行包，236 个源码指纹全部匹配；仅叠加已合 main 的日志/汇总补丁。候选构建、38 项单元、28 项隔离数据库集成全部通过，含真实本机导出采样与只读汇总。
- [x] 切换前发现并行模板任务已按用户另行授权更新日常包至 `c4515ae4a042788035137b6634e65cb2a7c9dcf97c78d289d793de70a31df614`。核验该包完整性及本次日志/汇总内容；等待其导出验收结束，保留这个 v3 最新包，不退回早先候选。
- [x] 再次确认空闲后，原 PID 52697 正常退出；以同一不可变包重启为 PID 61924，端口 5174。没有从脏工作区重新构建，没有停止 PostgreSQL，没有执行 schema 迁移。
- [x] deployment 仅新增 `productionMetrics: {enabled: true, ownerId: "644f8c5a-b668-48a3-8a25-94c4e502fa04"}`；服务启动检查后，通过应用角色、Owner 事务和既有 `set_production_metrics_enabled(true)` 开启数据库事件开关。其他 Owner 未启用。
- [x] 日常实际只读 CLI、请求日志、覆盖事件及前后业务摘要核验完成；保留恢复配置和旧运行包，清理本轮隔离数据库、工作树及未使用候选包。

以下表格记录启用阶段（11:54–11:57）的快照；后续真实活动采样结果见文末。

## 日常验收

| 项目 | 实际结果 |
| --- | --- |
| 服务 | `/` HTTP 200；当前固定运行包完整性通过，仍为 `production-workspace/v3` |
| 空闲确认 | 启用前及收尾均无 ready/running task、running task run、发布保护、Studio 监听或导出子进程；esbuild 是正常基础进程 |
| 制作事件 | 当前 Owner 一条启用控制、一段开放覆盖区间、3 条 `coverage_observation`；没有补造历史事件；启用后没有生产活动事件 |
| 资源采集 | 运行时配置已加载，Owner 数据库开关为 true；观察超过两个 30 秒周期，真实活动计数始终 0，资源样本 0 符合空闲不写规则 |
| 只读汇总 | 实际执行 `node scripts/production-metrics.mjs --owner 644f8c5a-b668-48a3-8a25-94c4e502fa04 --from 2026-11-16 --to-exclusive 2026-11-17` 成功；报告 enabled、覆盖 3、资源 configured=true/samples=0；未知数据不补零 |
| 重启后日志 | 无登录的 `account-commands/readAssetDirectory` 安全读探针按预期 401；started/responded、requestId/operationId、路由和运行版本一致，新增 ERROR 0；没有执行任何业务命令 |
| 已认证关联日志 | 同一固定版本在重启前实际完成的 48 条成功命令，已有固定操作名及已校验账号/生产单/工作区等关联，包括目录读取、字幕、旁白、导出；没有把这些历史日志冒充本轮新操作 |
| 业务保护 | 启用前后 tasks 58、task_runs 56、paid_generation_reservations 28、provider_dispatch_facts 15、workspace_exports 6、native_output_publications 0；六表全部内容摘要一致 |
| 工作区保护 | 原 index 字节不变，HEAD/main 仍为 b2d22563；8195 条既有路径核验仅并行模板任务自己的 PLAN/REPORT 有变化，本部署未覆盖任何既有源码；本轮仅补充本任务计划及本报告，不提交、不推送 |

限制：资源采样在隔离环境通过真实活动集成验证；日常目前空闲，尚无启用后的真实活动样本，不能据此断言日常 CPU/内存样本已经落库。汇总的 `health=not_observed_by_this_report` 保持原口径，下次正常制作/导出活动可核对首条样本。没有为验收伪造任务或资源记录。浏览器界面验收因平台禁止访问当前浏览器 URL 而终止，未绕过限制；日常验收使用本地 HTTP、受控只读查询和日志。

初轮预检 56 个任务；等待期间另一路已授权模板验收增加两个 `manual_upload` 已完成旁白任务。它们在本轮启用前已结束，最终 58 个任务（55 完成、3 失败）为本次切换保护基线；本次部署没有新增或重试任务。

## 恢复依据与证据

私有证据目录：`/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/daily-deployment/`。

`activation-baseline.json`、`final-state.json` 保存启用前后内容摘要；`enabled.json`、`observed.json`、`cli-report.json` 保存事件/只读结果；`log-after-restart.json` 和 `log-verification.json` 区分本次日志探针与同版本已有业务日志；`worktree-preservation.json`、`cleanup.json` 保存保护及清理结果。`published.json` 保留候选构建清单及差异，未使用的候选运行包已删除；重复源码副本和临时部署脚本在本地收尾时移入可恢复废纸篓。

`deployment.activation-before.json` 和 `app.activation-before.json` 是本轮启用前恢复依据。需要关闭时，先用当前 Owner 的既有控制函数设为 false，再恢复 deployment 的原资源配置；确认无活动后以保存的同一不可变运行包重启。保留已采到的事实，不回滚业务数据。不要直接用会从当前脏工作区重建的启动流程覆盖现有固定包。早先运行包 `3eb52fbc…` 也保留，但不将它用于覆盖并行任务已经上线的模板成果。

## 后续真实活动验证（12:09:50 已完成）

用户另行授权的独立验证工程已成功本机导出一次，真实日常采样器写入 2 条资源样本；10 条新工程事件和实际只读汇总核验一致。此前“空闲暂无资源样本”的验证盲区已经补齐。完整数据见 [DAILY-EXPORT.md](DAILY-EXPORT.md)。

## 本地收尾

保留启用配置恢复依据、冻结清单及最终构建/测试/采集证据；临时脚本、重复差异和索引快照已可恢复清理，未更改日常配置或运行包。数据库恢复备份单独保留在私有证据根目录的 `recovery/before-daily-export.dump`。清理回执见 `closeout/artifact-cleanup.json`。
