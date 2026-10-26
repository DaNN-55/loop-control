# T01：隔离环境启动与最小生产单演练

**Stage:** A

**Status:** published — 已获Owner确认；GitHub Issue [#107](https://github.com/DaNN-55/loop-control/issues/107)，ready-for-agent；本地四项修复及再次复审：验收满足，Owner已确认通过；云端 Issue 仍 open。

## What to build

在优化环境启动控制台并读取一条独立测试 Episode，启停与演练均不接触当前生产。

## Acceptance criteria

- [x] 使用独立配置、端口、数据库、媒体、运行状态和日志；配置缺失或指向生产资源时拒绝执行。
- [x] 准备与现有SQL依赖兼容的测试数据库；不用纯PostgreSQL盲跑含Auth/Vault依赖的历史迁移。
- [x] 通过现有HTTP入口完成一次测试Episode读取并验证启停只作用于优化服务；不复制生产凭据作为默认值。

## Blocked by

None（阶段A可开始）

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 本地交付证据

见[阶段A报告](../../verification/stage-a/README.md)。T03 ADR已由Owner批准为Accepted，未提前实施后续阶段或切换生产。

最终修复、再次复审及证据见 [A阶段四项修复报告](../../verification/stage-a/fixes/README.md)。
