# ADR-0062：移除无消费者的旧历史管理入口

状态：Accepted。日期：2026-11-13。

用户授权核对 `preview_history_cleanup`、`preview_history_episode`、`delete_history_episode` 及其调用链，仅确认当前功能、旧运行包与历史恢复无依赖后删除；不删除历史数据、不放宽保护、不提交、不推送。

日常 181 中三个入口仍向 loop_app 授予执行权限，但无有效 SQL 调用者、传入 pg_depend 依赖或当前代码消费者，23 个不可变保存包无名称引用。独立历史浏览／新历史删除 HTTP 和命令已退役。当前回收站与普通永久删除走 `EpisodeLifecycle`、持久精确删除 intent 和 `public.delete_episode`；已提交旧历史清理回执由 `retryDeletionCleanup`、`historyBlobTargets`、`finishHistoryBlob` 和保留的引用／留存 SQL 继续处理，不调用这三个入口。

182 仅用默认 RESTRICT 删除三个明确签名，无 CASCADE、数据 DML、权限授予或触发器拆除；无本组必须保留目标。不扩大到旧入口的下游辅助函数或历史表，不移除共享内容、Owner／会话／CSRF、运行／未知提交、文件身份、确认版本、冻结证据及回收保护。历史 SQL 和原运行包保持。

验收包含非空历史来源／版本／投影／文件／保护／留存记录、旧清理回执、业务任务与冻结运行包的完整导出恢复，真实视图依赖阻断、失败回滚、幂等和所有原行／序列／角色／其他目录及 ACL 精确保持；实际旧回执、当前回收／永久删除、保存包模块与制作／发布恢复验证。完整日常备份和独占候选恢复演练、无漂移复核后应用 182，保持采集关闭、不重启。证据见 `docs/verification/history-management-entry-cleanup-20261113/REPORT.md`。
