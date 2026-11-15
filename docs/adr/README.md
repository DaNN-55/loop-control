# 架构决策

- [ADR-0068：独立制作基准版本与稳定镜头](0068-independent-production-preparation.md)

- [ADR-0001：Episode 归档与永久删除](0001-episode-archive-and-permanent-delete.md)
- [ADR-0004：Prompt 上下文优先级](0004-prompt-context-precedence.md)
- [ADR-0005：蓝图能力与运行前置边界](0005-blueprint-capability-prerequisites-boundary.md)
- [ADR-0006：Worker 生产前检查合同](0006-worker-preflight-contract.md)
- [ADR-0007：版本化外部连接](0007-versioned-external-connections.md)
- [ADR-0008：本地执行及迁移合同](0008-local-execution-and-migration-contract.md)
- [ADR-0009：原界面与日常本地运行](0009-daily-native-workspace.md)

- [ADR-0010：秘密统一存储与历史差异整合](0010-local-secrets-and-history-consolidation.md)

- [ADR-0011：管理员秘密查询与单项读取](0011-admin-secret-inspection.md)

- [ADR-0012：脚本 v2 与审核后自动继续](0012-script-v2-production-continuation.md)

- [ADR-0013：原生运行入口与项目文件边界](0013-native-runtime-file-boundary.md)

- [ADR-0014：六步制作流程与版本修订](0014-production-reconfirmation-and-six-step-workflow.md)

- [ADR-0015：四步制作与嵌入式整期工程](0015-four-step-production-and-embedded-studio.md)

- [ADR-0016：正式准备谱系](0016-formal-preparation-lineage.md)
- [ADR-0017：旧HTML工程接入可编辑工作区](0017-legacy-html-editable-workspace.md)

- [ADR-0018：制作按次选择与账号目录归属](0018-per-request-production-and-account-storage.md)

- [ADR-0019：统一媒体根与生产单物理收纳](0019-managed-media-storage-locations.md)

- [ADR-0020：连接模型设置与执行快照分离](0020-connection-model-preferences.md)

- [ADR-0021：按协议接入百炼首帧视频模型](0021-bailian-video-model-contracts.md)

- [ADR-0022：供应商账务凭据与生成凭据分离](0022-provider-billing-credentials.md)

- [ADR-0023：原生产物发布未知结果的显式核对](0023-native-output-publication-reconciliation.md)

- [ADR-0024：在线制作逐次确认](0024-per-call-workspace-confirmation.md)

- [ADR-0025：后台与 Worker 绑定已准备的运行版本](0025-prepared-runtime-releases.md)

- [ADR-0026：原生剪辑宿主模块依赖集中登记](0026-native-editor-module-graph.md)

- [ADR-0027：视觉调用解释规则集中管理](0027-shared-visual-request-resolution.md)

- [ADR-0028：工程写入与完整状态读回分离](0028-workspace-write-readback-boundary.md)

- [ADR-0029：视频任务恢复与下载协议集中管理](0029-video-task-execution.md)

- [ADR-0032：统一镜头视频任务与历史协议兼容](0032-unified-shot-video-protocol.md)

- [ADR-0033：逐次调用确认的客户端生命周期](0033-workspace-call-confirmation-lifecycle.md)

- [ADR-0034：生成任务展示与交付读取保护](0034-workspace-task-presentation-and-delivery-reading.md)

- [ADR-0035：导出与交付的下一步判断](0035-export-delivery-next-step.md)

- [ADR-0036：脚本保存与启动的分步恢复](0036-script-save-start-recovery.md)

- [ADR-0037：四步工作区操作转换](0037-workspace-operation-transitions.md)

- [ADR-0038：样音选择归属与模型编辑基线](0038-speech-sample-and-model-edit-ownership.md)

- [ADR-0039 工作区局部恢复与轮询生命周期](0039-workspace-local-recovery-and-polling.md)

- [ADR-0040：Owner 日志查看与独立存储位置](0040-owner-runtime-log-viewer.md)

- [ADR-0041：当前作品依赖与后台请求记录分离](0041-current-workspace-dependencies.md)

- [ADR-0042：生产单回收站](0042-episode-recycle-bin.md)

- [ADR-0043：发送阶段与原操作回执恢复](0043-request-outcomes-and-receipt-recovery.md)

- [ADR-0044：退役CLI视觉与分镜规划](0044-retire-cli-planning.md)

- [ADR-0045：日常数据库使用项目专用原生 PostgreSQL](0045-native-postgresql-runtime.md)

- [ADR-0046：备份保留已失效终态任务的未知历史](0046-backup-retains-invalidated-task-history.md)

- [ADR-0047：当前 SQL 基线与不可变历史迁移分代](0047-clean-sql-baseline-generations.md)

- [ADR-0048：旧规划写入退役与只读配置归档](0048-retire-legacy-sql-production-writes.md)
- [0049：退役旧任务修复、派单和自动续跑](0049-retire-legacy-dispatch-repair-and-continuation.md)
- [ADR-0050：日常采用 clean-v2 并保留旧库](0050-daily-clean-sql-adoption.md)
- [ADR-0051：删除无当前消费者的旧 SQL 辅助对象](0051-remove-unused-legacy-sql-helpers.md)

- [ADR-0052：删除无消费者的旧编排空壳](0052-remove-disconnected-orchestration-shells.md)
- [ADR-0053：删除旧 Studio 结构修订调用链](0053-remove-retired-studio-storyboard-entry.md)
- [ADR-0054：删除旧镜头结构修订与旧审核入口](0054-remove-retired-shot-review-entries.md)
- [ADR-0055：按旧运行包依赖清理退役 SQL 入口](0055-retired-sql-runtime-compatibility.md)

- [0056：移除无消费者的旧云端连接 RPC](0056-remove-retired-cloud-connection-rpcs.md)

- [ADR-0057：默认关闭的生产统计采集](0057-production-metrics-collection.md) — 迁移177与并行175／176联验，代码回迁；日常未迁移、未启用。

- [0058：移除未挂载触发器和无消费者的旧预渲染入口](0058-remove-disconnected-prerender-functions.md)

- [0059：移除无消费者的旧镜头准备入口](0059-remove-unused-shot-preparation-entries.md)

- [0060：移除无消费者的旧初始化与委托入口](0060-remove-unused-initialization-entries.md)

- [0061：移除旧连接验证与重试延时辅助入口](0061-remove-unused-connection-retry-helpers.md)

- [0062：移除无消费者的旧历史管理入口](0062-remove-unused-history-management-entries.md)

- [0063：移除最后四个无消费者的旧辅助候选](0063-remove-unused-legacy-auxiliary-functions.md)

- [0064：移除旧修订派单与新账号旧 Prompt 初始化触发器](0064-retire-revision-and-prompt-triggers.md)

- [0065：退役旧生成脚本审核与批准落库链](0065-retire-generated-script-chain.md)

- [0066：以当前制作模型替换旧执行链，保留版本化历史恢复](0066-current-production-workflow-replacement.md)

- [0067：退役无消费者的旧建单 RPC](0067-remove-unused-create-episode-rpc.md)

- [0069：独立的制作里程碑与覆盖区间](0069-production-workflow-observations.md)（Accepted，分步实施中）
