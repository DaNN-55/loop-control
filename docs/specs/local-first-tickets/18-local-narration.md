# T18：本地镜头口播生成和音轨复用

**Stage:** D

**Status:** 主体实现、普通生产 TTS 策略修复及豆包普通长度全链已有验收；Google 保留豁免（2026-10-26）。GitHub Issue [#124](https://github.com/DaNN-55/loop-control/issues/124) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

Owner保存本期TTS设置并生成镜头口播，任务与音轨记录保存在本地。

## Acceptance criteria

- [ ] 覆盖当前Google/火山路径的已有执行逻辑，不增加Provider；凭据通过本地连接版本解析。
- [x] 确认文本、冻结任务输入、同配置复用、失败重试与进度显示一致。
- [x] 录入音轨、时长及来源可查询；受控模拟与真实在线生成分别报告，不把联网调用称为离线。

## Blocked by

- T17：本地分镜规划、审核与修订闭环

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T18 报告](../../verification/stage-d-t18/README.md)与[同单豆包短句](../../verification/stage-d-close/ad-issue-implementation-20261025/report-142-final.md)保留已有音轨与查询证据。[当前审阅](../../verification/local-first-review-20261026/README.md)复现的 live 路径 10 字/固定音色限制已修复。新批准的可选 `tts` 策略声明字符数、音色集合和语言/资源限制；缺少 `tts` 的历史短句验收策略保留原边界。限制仍在传输及费用预留前检查。豆包已真实生成 70/75/76 字三镜头音轨并进入成片及发布包；另选音色的序列化与策略边界由回归验证，不扩大为所有音色在线验收。Google TTS 继续按 Owner 豁免保留，不新增请求，因此第一项仍未勾选。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
