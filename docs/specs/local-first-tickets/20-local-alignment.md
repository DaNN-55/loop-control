# T20：本地音频提取、字幕对齐与同步预览

**Stage:** D

**Status:** 主体实现、真实 WhisperX 与预览已有验收（2026-10-26）。GitHub Issue [#126](https://github.com/DaNN-55/loop-control/issues/126) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

Owner能使用已有镜头音频完成提取、对齐、字幕编辑与同步预览，状态和产物都本地保存。

## Acceptance criteria

- [x] 沿用现有音频来源优先级、字幕时轴与本期设置，不改变创作规则。
- [x] FFmpeg/WhisperX任务使用统一队列及资源上限，结果写回本地并可预览。
- [x] 真实短样本验证字幕、时长、音频与文件引用；缺少模型/环境时返回明确前置条件而非假成功。

## Blocked by

- T18：本地镜头口播生成和音轨复用
- T19：本地人工素材与图片、A-roll、B-roll、配乐任务

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T20 报告](../../verification/stage-d-t20/README.md)、[真实 WhisperX](../../verification/stage-d-close/whisperx-real-inference.md)及[正文身份确认接续](../../verification/stage-d-close/ad-issue-implementation-20261025/report-136.md)记录音轨/正文绑定。本轮 3 镜头对齐已进入成片和发布包；第三镜头低置信度原记录保留，Agent 核对正文、指纹、时序和波形后经正常人工对齐 API 保存，未降低阈值，不记为全自动通过。第二镜头字幕存在孤字换行，详见[字幕核验](../../verification/tts-production-e2e-20261026/root-caption-checks.json)及[音频/字幕检查](../../verification/tts-production-e2e-20261026/root-qc-audio-and-captions.json)。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
