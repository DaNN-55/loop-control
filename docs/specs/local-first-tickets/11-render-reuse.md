# T11：复用已审核且输入一致的最终成片

**Stage:** C

**Status:** published — 已获Owner确认；GitHub Issue [#117](https://github.com/DaNN-55/loop-control/issues/117)，ready-for-agent；已完成本地实现、真实视频/发布包验收和两轴复审；待Owner事后审阅，云端未关票。

## What to build

冻结工程与导出条件未变时直接生成最终交付记录，避免重渲染同一视频。

## Acceptance criteria

- [x] 指纹覆盖工程、素材、音轨、字幕和导出设置；复用前校验来源审核及产物完整性。
- [x] 参数变化、文件缺失或损坏必须重渲染；历史审核包不被改写。
- [x] 真实视频和发布包验证通过，并记录一次复用及一次失效重渲染的结果。

## Blocked by

- T04：完整备份与空库恢复演练

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

验证：真实HTTP/Worker/OpenChatCut复用及损坏重渲染、发布包通过；最终699项应用/280条SQL通过。详见[报告](../../verification/stage-c-t11/README.md)。
