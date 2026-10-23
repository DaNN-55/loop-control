# T03：用最小生产路径固定调度及本地化契约

**Stage:** A

**Status:** published — 已获Owner确认；GitHub Issue [#109](https://github.com/DaNN-55/loop-control/issues/109)，ready-for-agent；本地再次复审：验收满足，Owner已确认通过且ADR为Accepted；云端 Issue 仍 open。

## What to build

以现有Episode提交、领取和结果回写演练为依据，形成可供后续小票实现的服务、事务及迁移契约。

## Acceptance criteria

- [x] 记录统一服务边界、全机/资源容量、租约、结果串代防护和恢复流程的ADR，保留现有业务语义。
- [x] 明确PostgreSQL、本地Owner会话、Keychain、常驻调度器和逐段迁移方案，以及必要依赖与运行方式。
- [x] 按已认可的HTTP主边界、真实数据库及真实产物边界列出代表请求与可观察结果；不在本票重写系统。

## Blocked by

- T02：固定样本与性能资源基线

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 本地交付证据

见[阶段A报告](../../verification/stage-a/README.md)。T03 ADR已由Owner批准为Accepted，未提前实施后续阶段或切换生产。

最终修复、再次复审及证据见 [A阶段四项修复报告](../../verification/stage-a/fixes/README.md)。
