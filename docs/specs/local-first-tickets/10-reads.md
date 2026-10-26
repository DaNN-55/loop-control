# T10：生产单详情聚合读取与列表完整分页

**Stage:** C

**Status:** 本地实现、真实验收与复审已完成（2026-10-26）。GitHub Issue [#116](https://github.com/DaNN-55/loop-control/issues/116) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

现有生产单页面通过统一服务读取所需数据，刷新只更新必要范围，历史增加也不遗漏记录。

## Acceptance criteria

- [x] 详情聚合查询和列表服务端分页覆盖原有字段、权限及筛选语义；不把界面重设计纳入本票。
- [x] 任务状态更新不反复加载全部历史；页面不可见时减少无用请求。
- [x] 同样本比较请求数、载荷与耗时；检查空数据、超过单页上限、重复刷新和越权访问。

## Blocked by

- T06：即时与定时派发共用一条持久执行路径

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

验证：默认5000ms697项应用、271条SQL通过；真实1005记录、增量、权限及相反表顺序并发验证通过。详见[报告](../../verification/stage-c-t10/README.md)。

## 当前证据与限制（2026-10-26）

[原验收](../../verification/stage-c-t10/README.md)及[按页加载与浏览器补验](../../verification/stage-c-followup/README.md)已完成；本地目录合同后续 SQL 对照见[最新审计](../../verification/stage-d-close/ad-provider-recheck-20261026/report-149.md)。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
