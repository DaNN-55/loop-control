# T13：本地Owner登录与账号数据隔离

**Stage:** D

**Status:** 主体实现及本地身份/隔离验收已完成（2026-10-26）。GitHub Issue [#119](https://github.com/DaNN-55/loop-control/issues/119) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

断开Supabase Auth后，Owner仍能登录本地控制台并读取其有权访问的账号和Episode。

## Acceptance criteria

- [x] 本地会话支持建立、有效性验证与退出；保留Owner与内容账号的关联身份。
- [x] 未登录、过期会话、账号越界、跨来源请求与文件访问边界得到一致处理。
- [x] 现有目录/详情HTTP路径使用本地身份，不以仅监听本机代替权限校验。

## Blocked by

- T12：本地PostgreSQL导入与目录只读贯通

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T13 报告](../../verification/stage-d-t13/README.md)和[最新审计](../../verification/stage-d-close/ad-provider-recheck-20261026/report-149.md)覆盖会话、账号与文件边界，以及后续退出围栏和 RLS 043 验收。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
