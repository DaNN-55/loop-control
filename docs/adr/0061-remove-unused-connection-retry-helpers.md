# ADR-0061：移除旧连接验证与重试延时辅助入口

状态：Accepted。日期：2026-11-13。

用户授权检查 `record_external_connection_verification` 和 `worker_retry_delay_ms`，仅确认当前功能、保存运行包和历史恢复均无依赖后清理，不删除历史数据，不放宽保护，不提交、不推送。

日常 180 有效定义中，两者均仅 postgres 有执行权限，无 SQL 调用者或传入目录依赖。当前源码只有一个陈旧连接验证 RPC 类型条目，23 个保存包无名称引用。当前连接验证经 `verifyLocalConnection`、SecretStore、受控 probe 与 `local_identity.record_connection_probe`；Worker 由现行调度器轮询与唤醒，SQL 退避触发器持久化 `available_at`，领取链检查到期、次数、容量与 lease，不调用旧延时计算器。

新增 181 仅删除 `public.record_external_connection_verification(uuid,text,text)` 与 `public.worker_retry_delay_ms()`，移除一个陈旧类型条目。默认 RESTRICT，无 CASCADE、数据删除／更新、权限授予或触发器拆除。连接与版本、旧验证记录、本地 probe／资格、延迟任务、运行包、费用／未知结果／租约及发布保护保持；历史 SQL、原包和其他并行改动保持。

验收包含非空历史连接验证和延迟任务完整导出恢复，真实依赖阻断、注入失败回滚、幂等及全量原行／序列／目录／ACL 核对；实际执行当前 Owner 验证、重试／退避、调度器与已编译 Worker 子进程、旧包模块和恢复。完整日常备份、候选恢复演练和无漂移核对后应用 181，保持采集关闭，不重启或部署。证据见 `docs/verification/connection-retry-helper-cleanup-20261113/REPORT.md`。
