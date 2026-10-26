# T21：本地Studio编辑、冻结与审核视频

**Stage:** D

**Status:** 主体实现、Studio/冻结/审核视频已有验收（2026-10-26）。GitHub Issue [#127](https://github.com/DaNN-55/loop-control/issues/127) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

Owner打开可编辑工程、保存修改并明确生成审核视频，本地形成冻结快照与审核结果。

## Acceptance criteria

- [x] Studio工作版本与冻结审核快照分离，素材和工程均留在隔离目录。
- [x] 真实OpenChatCut生成审核视频，运行、QC证据及媒体索引可在原有详情查看。
- [x] 审核修订、重复提交、刷新及指纹失效语义保持一致，复用已有渲染和队列能力。

## Blocked by

- T20：本地音频提取、字幕对齐与同步预览

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T21 报告](../../verification/stage-d-t21/README.md)与[后续同单接续](../../verification/stage-d-close/ad-issue-implementation-20261025/report-142-final.md)记录本地编辑及审核视频；旧测试失败已由[稳定性补修](../../verification/stage-d-close/default-5s-stability.md)接续。当前完整源码已完成本轮 3 镜头 Studio、冻结及约 46.848 秒审核视频的功能校验；视频为 1080×1920、30 fps，素材分辨率与字幕换行限制见[本轮报告](../../verification/tts-production-e2e-20261026/README.md)。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
