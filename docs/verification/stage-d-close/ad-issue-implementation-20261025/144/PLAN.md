# #144 必要迁移与隔离验收计划

授权：只处理 #144 的必要迁移、Worker 产物一致性和新隔离库验收；#146、#147 暂停。生产、旧证据库、当前服务、Provider、提交、推送和 E/F 均不操作。

1. [x] 追踪冻结输出字段、正常 INSERT 后更新、artifact 登记及 ADR-0008；冻结最小设计。
2. [x] Worker/真实 FS seam 红→绿：跨任务已索引路径拒绝、显式恢复、原生视觉目录；保留失败日志。
3. [x] 040 源码和迁移注册、Owner CLI、私有 durable receipt；focused 5 文件 27 项、app/Worker 类型、CLI 语法通过。
4. [ ] 主流程在新的隔离库应用 040；真实 PG 验证命名空间、权限、SQL abort 后行锁与路径锁、两种 COMMIT unknown、幂等恢复及旧 fence 拒绝。
5. [ ] 核对真实证据与本轮源码，完成只读 Standards/Spec 审查；更新 #144 报告和索引，保留历史失败与未验收门禁。

交付源码补丁已冻结：`/private/tmp/ad-closeout-144-authority-increment.patch`，SHA-256 `90e3fda799e083c2702a85f1ed464bebb992cd81fd3a95ed7899033b91c5425b`。冻结契约补修独立增量：`/private/tmp/ad-closeout-144-frozen-contract-increment.patch`，SHA-256 `20256affc3f766c4c619f51a50d03e0b71916632707ad9c25819cb690335ae3d`。后续必要修复继续独立交增量，不覆盖既有补丁。

证据目录：`/private/tmp/ad-closeout-144-authority-evidence/`。当前 focused 使用 SQL 端口替身，不宣称实际 PostgreSQL 验收。真实数据库不可达时继续保留 unknown，并要求运营显式重试，不能记为已恢复。
