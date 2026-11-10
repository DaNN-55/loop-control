# 第四批建议：文件归属、删除范围与空间回收

状态：建议，未实施。依据当前代码与[原计划](../second-batch-experience-20261109/REPORT.md)中的R12；以下现状由源码确认，未作为新的运行中缺陷复现结论。每项独立隔离，核对通过后才迁移。

## 4.1 删除前看清范围

现状：EpisodeDeletionScope已有files.bytes、authority和preserved.reason，界面主要展示路径与数量；用户需要逐项阅读路径。

修改：确认框先展示本次已登记文件数量、文件大小合计、保留项数量及原因分组；原始路径和明细按需展开。只汇总服务端计划，文件大小不冒充磁盘实际可释放空间；保留名称确认与计划修订校验。

范围：`src/workspace/EpisodeDeletionScope.tsx`、`src/workspace/WorkspaceViews.tsx`及共享视图相关测试。复用当前计划接口，若现有authority不能判断归属，先完善真实计划再显示，不从路径猜测。

验收：独占／共享／未知／缺失文件、空计划、长路径；摘要与实际计划一致；计划变化后旧确认拒绝。复用episodeDeletionStorage.integration.test.ts、episodeDeletionRetainedSources.integration.test.ts和相应浏览器删除测试。

## 4.2 清理失败能直接继续处理

现状：LocalDeletionRecovery已区分恢复未提交删除和重试文件清理，但挂在连接配置下；LocalCatalogApp失败提示也要求前往连接配置。

修改：把待完成清理放到独立、容易找到的维护分区；删除未完成时直接跳到对应任务，展示阶段与原始错误，复用已有恢复／重试命令。

范围：`src/local-app/LocalDeletionRecovery.tsx`、`src/local-app/LocalMaintenancePanel.tsx`、`src/local-app/LocalCatalogApp.tsx`及对应导航／回归。需要调整分区路由时仅扩展现有机制。

验收：删除未提交、数据库已提交但文件待清理、重启后回执、重复点击；区分恢复记录与继续清文件，不重复删除或误报已完成。复用episodeDeletionNative、episodeDeletionStorage、deletionBackupRestore真实集成。

依赖：可在4.1后独立实施；删除协议与数据范围保持。

## 4.3 账号删除受阻时直接找到原因

现状：AccountWorkspace的删除弹窗只给生产单总数，用户需要退出弹窗再自行查找相关生产单。

修改：显示真实阻断原因，并提供按该账号筛选全部关联生产单的入口；仍可选择归档账号保留历史。分组数量必须来自完整目录／服务端统计，不能用当前页数据推算。

范围：`src/accounts/AccountWorkspace.tsx`、`src/local-app/LocalCatalogApp.tsx`和现有目录导航；如需补充准确分类统计，再限定扩展目录查询及测试。

验收：无生产单、只有归档生产单、跨页关联、运行中任务或待清理回执；入口筛选正确，确认按钮与后端拒绝条件一致。复用AccountWorkspace、accountDeletion和accountDeletionStorage测试。

依赖：沿用4.1／4.2建立的范围与待清理状态表达，不增加账号级联删除。

## 4.4 历史资料先明确归属和回收边界

现状：HistorySources仅提供来源级清理预览，HistoryCleanupPreview.deletionEnabled固定false。来源预览已有shared／protected／needs-review及reviewBytes；已有deleteHistoryEpisode针对历史生产单，不能直接用作整个资料来源的删除接口。

修改：先完善现有预览，按来源显示共享、受保护和待核查内容及大小，明确哪些引用阻止清理。待核查容量不能当作可回收容量。真正永久回收入口以归属、引用和恢复验证完成为前提，再在本项隔离结果中决定是否开放。

范围：`src/local-app/HistorySources.tsx`、`src/local-app/historyPresentation.ts`、`src/local-app/history.ts`；若需要变更持久化边界，新增前向迁移，不改写已应用的067／075。先检查真实消费者和ADR-0001。

验收：同一内容被多个来源或当前工程引用、历史合入记录、磁盘缺失、文件身份变化、未知内容；共享／保护对象不会被当作可删，未核实内容保持待核查。沿用真实Owner／SQL／文件集成；需要执行入口时另补中断恢复验证。

依赖：4.1→4.2的范围和恢复机制；这是本批涉及持久化边界最多的一项，最后处理。

## 实施规则与保留

推荐顺序：4.1→4.2→4.3→4.4。每项提供具体隔离链接、修改说明、操作步骤和预期，不自动合并迁移。只用合成数据验证删除／恢复，不为本批发起付费生成。保留此前已核对的界面布局、设计demo、验收截图与恢复包；不重复改脚本／字幕、候选操作、音频来源、剪辑工具或交付布局。代码级范围在每项开始时按真实接口继续确认。
