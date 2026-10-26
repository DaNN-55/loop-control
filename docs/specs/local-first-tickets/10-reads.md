# T10：生产单详情聚合读取与列表完整分页

**Stage:** C

**Status:** published — 已获Owner确认；GitHub Issue [#116](https://github.com/DaNN-55/loop-control/issues/116)，ready-for-agent；已完成本地实现、真实验收和两轴复审；尚待Owner事后审阅，云端未关票。

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
