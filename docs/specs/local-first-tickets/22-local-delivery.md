# T22：本地QC、发布包与Episode生命周期

**Stage:** D

**Status:** 主体实现、QC/发布包/生命周期已有验收（2026-10-26）。GitHub Issue [#128](https://github.com/DaNN-55/loop-control/issues/128) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

Owner完成QC并生成校验通过的发布包，Episode进入生产完成；归档和删除沿用既有规则。

## Acceptance criteria

- [x] QC问题、返修、最终产物复用/重渲染、发布输入和发布包校验经本地服务完整贯通。
- [x] 生产完成只表示交付包验证完成；不新增外部平台发布能力。
- [x] 真实样本验证最终文件、清单与历史；删除只使用可恢复测试数据并保留既有Owner确认及文件边界。

## Blocked by

- T21：本地Studio编辑、冻结与审核视频
- T11：复用已审核且输入一致的最终成片

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T22 报告](../../verification/stage-d-t22/README.md)及[同单最终交付](../../verification/stage-d-close/ad-issue-implementation-20261025/report-142-final.md)有真实视频和本机包证据；旧 Agent QC 不冒称人类观看。本轮当前完整源码的普通长度、3 镜头审核/最终视频、发布包和审计已完成，Episode 已进入 `production_completed`。QC 由授权测试 Owner 身份下的 Agent 执行，不代表真人观看或听音；[浏览器播放证据](../../verification/tts-production-e2e-20261026/browser-qc-playback.json)与[内容质量观察](../../verification/tts-production-e2e-20261026/root-content-quality-observations.json)分别记录可播放性与画质/内容限制。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
