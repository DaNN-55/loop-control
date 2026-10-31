# 隔离集成回归与收尾

最终本地 main：`9b31b31bb76afadac26854d3a5975a9262666cc8`。首轮使用 `e7a4d8b7` 与原有工作区覆盖，97 个文件中 307 项通过、60 项失败、1 项跳过，耗时 1624.53 秒。随后按失败根因修复并定向重跑；按“文件路径＋完整测试名”去重，最终 **367 项已执行通过、0 项失败、1 项人工门控未执行**。

这不是最终提交上重新整跑 97 个文件，也不是仓库全部 129 个集成文件都运行。其余 32 个文件明确排除：12 个历史运行时未适配隔离 Context、6 个依赖旧私有夹具、14 个需要外部人工 Driver 驻留。唯一门控跳过是 `blueprintReviewRetirement.integration.test.ts` 中的 `serves the formal blueprint page against an isolated Owner database`。

- [逐项结果及每项证据](integration-consolidated.json)：初轮与后续结果按测试身份合并；定向名称过滤产生的 pending 不覆盖已有执行结果。
- [129 个文件的选择清单](integration-selection-129.json)：包含排除原因。
- [最终 18 个提交文件的 SHA-256](integration-final-source-hashes.json)：工作区字节与最终提交一致。
- [Driver 元数据及日志归档索引](integration-driver-evidence-manifest.json)：593 份文档，共约 5.36 MB；凭据字段与内联媒体载荷已脱敏，原始文件指纹保留。
- [清理回执](integration-cleanup.json)：列出确切路径、容器身份、检查及保留范围。

生产代码只调整 `readProject`：安全归类的 `ConfigurationError` 保留原状态和诊断，其他 JSON、I/O 和未知异常继续使用原通用错误。其余改动同步测试与夹具：真实 SQLite HTTP、显式服务选择、自动目录、迁移依赖及 SQL115 逐文件删除合同；没有放宽生产文件归属或迁移证明。

完整交付／删除用例保留了数据库与文件树回滚断言，核对所有已登记应删文件、逐项暂存清理、未知保留项的字节与目录身份、剩余树及跨生产单隔离。`settings.env` 只记录指纹，未记录明文。受控 Provider 回归与真实 API 制作链路分别记录。

收尾正常移除 2 个本轮空测试卷、2 个无持久卷的测试容器，以及 3 个无打开引用的专属源码／SDK 目录，后者原占用 480152 KiB（约 468.9 MiB）。共享依赖目录身份未变；日常 PID `71478`、日常 PostgreSQL、3 个原有未知卷，以及主代理保留的 live 源码、恢复包和原始改动备份均保留。原始私有二进制测试证明留在 `integration-regression` 的证据目录中。
