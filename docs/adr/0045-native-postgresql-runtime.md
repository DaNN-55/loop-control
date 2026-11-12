# ADR-0045：日常数据库使用项目专用原生 PostgreSQL

状态：Accepted。日期：2026-11-12。用户批准隔离验证后切换日常库，保留旧库回退；不提交、不推送。

## 背景

ADR-0009 将日常 PostgreSQL 绑定到 Colima 容器。业务已通过标准 `pg` 连接访问，容器主要承担安装与进程隔离。用户决定原生运行日常数据库，虚拟机保留隔离测试用途。

## 决定

- 本 ADR 替代 ADR-0009 中日常数据库必须使用 Colima/容器的部署决定；其余业务、身份和文件职责不变。保留旧 ADR 原文。
- 固定 PostgreSQL 17，项目专属私有 `postgres/data` 与 `postgres/socket`，仅监听 loopback；不启用 Homebrew 全局服务。实际补丁版本和端口见交付记录。
- SQL、快照、dump/restore、身份检查及启停统一经过 `scripts/runtime/database-runtime.mjs`。原生直接使用固定版本工具，容器继续用于隔离测试和明确回退。
- 原生操作验证规范目录、所有者、权限、主版本、system identifier、进程二进制、私有 socket 与唯一 loopback 监听；不通过 Docker 仿真层连接原生实例。
- App/Worker 保持原角色、Keychain 引用、权限、RLS、租约和发布屏障。媒体、OpenChatCut SQLite、历史快照和凭据不随 PostgreSQL 搬迁。
- 切换使用逻辑导出与恢复，对账数据内容、序列、有效权限、函数、索引、约束、触发器、RLS 和 ledger。自动备份继续关闭；单次迁移恢复包存放于项目私有运行目录。
- 旧容器停止写入并保留数据卷。切换后只有原生库作为写入权威。开放新写入后，不能直接改回旧配置：必须停写、导出原生最新状态并校验恢复，或明确接受恢复截止点。
- 旧 SQL 基线重整、埋点和组件迁移继续暂缓。本次不改业务 schema 或历史名称。

## 影响与限制

日常启动不再需要 Docker/Colima/SSH 数据库转发，日常停止会在 App 关闭后对专用 PG 执行 smart shutdown；有其他客户端时拒绝停库。维护命令反复核验身份会增加少量进程开销，普通业务连接池不经过该端口。

Linux `en_US.utf8` 与 macOS `en_US.UTF-8` 的 libc 排序实现不保证逐字符等价；逻辑恢复重建索引，不复制物理数据目录。保留 UTF8、区域意图和全部已存内容，验证实际业务路径；本次不引入 ICU 或重写排序语义。残留 PID 文件拒绝自动删除，需检查后恢复。

验收及回退步骤见 [交付记录](../verification/native-postgres-captions-20261112/REPORT.md)。
