# T25：移除Supabase运行依赖并验证断网数据操作

**Stage:** D

**Status:** 主体本地化、断网操作及当前主机默认入口已有验收（2026-10-26）。GitHub Issue [#131](https://github.com/DaNN-55/loop-control/issues/131) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

新版本无需Supabase与n8n即可启动并管理本地生产数据，断网时在线任务明确等待前置条件。

## Acceptance criteria

- [x] 前序业务场景全部迁移后再收缩旧访问路径；盘点直接查询/RPC/Auth/Vault及CLI启动探针对应的调用者。
- [x] 新版本不再依赖Supabase客户端或远端业务服务；历史迁移与旧生产环境继续保留。
- [x] 断网实际验证启动、登录、查询、编辑、审核、排队和重启；在线生成不假成功；报告A–D范围结果，E/F仍搁置，不合并。

## Blocked by

- T23：本地接管提醒、健康和备份触发并退出n8n
- T24：本地数据库、密钥绑定及媒体恢复闭环

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T25 报告](../../verification/stage-d-t25/README.md)由[当前主机正式 npm 入口验收](../../verification/stage-d-close/default-offline-deployment.md)及[最新审计](../../verification/stage-d-close/ad-provider-recheck-20261026/report-149.md)接续。不等于新硬件安装、全部在线 Provider 通过或生产切换。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
