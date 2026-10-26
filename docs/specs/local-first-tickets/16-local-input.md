# T16：Episode脚本、视觉准备与Worker回写本地闭环

**Stage:** D

**Status:** 本地/CLI 主链已有验收；在线图片能力保留例外（2026-10-26）。GitHub Issue [#122](https://github.com/DaNN-55/loop-control/issues/122) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

Owner在本地创建Episode、上传并确认脚本，Worker完成视觉资产准备并返回可审核结果。

## Acceptance criteria

- [x] 创建时冻结蓝图/系列与非秘密连接引用；上传、素材目录和预检沿用现有约束。
- [x] 本地任务领取、执行、进度与结果回写完整贯通；没有云端业务写入或双写。
- [x] 脚本和视觉审批通过本地服务保存，刷新后状态及产物索引一致；记录受影响业务操作清单。

## Blocked by

- T08：预构建运行与即时唤醒加五秒兜底
- T14：本地账号、蓝图和系列配置闭环
- T15：Keychain连接创建、验证与版本选择

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T16 报告](../../verification/stage-d-t16/README.md)及[真实 CLI 同单接续](../../verification/stage-d-close/ad-issue-implementation-20261025/report-142-final.md)记录冻结输入、视觉规划和回写。Cloudflare/OpenAI 图片能力未技术通过，继续按 Owner 豁免；本轮真实 CLI 规划与完整源码隔离功能全流程已完成；转发中断后使用原有效尝试和正式 `nativeOutputPublisher` 登记已经成功的真实 CLI 结果，未重复生成，详见[中断恢复证据](../../verification/tts-production-e2e-20261026/e2e-interrupted-visual-recovery.json)。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
