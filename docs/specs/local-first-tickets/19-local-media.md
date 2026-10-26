# T19：本地人工素材与图片、A-roll、B-roll、配乐任务

**Stage:** D

**Status:** 主体迁移和本机/Pexels 代表路径已有验收；部分在线能力保留豁免（2026-10-26）。GitHub Issue [#125](https://github.com/DaNN-55/loop-control/issues/125) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

Owner导入人工素材或执行已注册媒体路径，产物进入对应镜头并可预览审核。

## Acceptance criteria

- [x] 迁移现有媒体任务与素材绑定的数据访问，不重写各Provider生成算法，也不移除Adapter。
- [x] 覆盖启用/禁用能力、人工路径、已有音轨、任务阻塞、重试和替换语义；生成前记录适配器覆盖矩阵。
- [ ] 按媒体任务族验证代表样本，媒体路径、索引、文件指纹和页面预览一致；缺失真实验证明确记录。

## Blocked by

- T17：本地分镜规划、审核与修订闭环

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[T19 报告](../../verification/stage-d-t19/README.md)及[同单真实媒体接续](../../verification/stage-d-close/ad-issue-implementation-20261025/report-142-final.md)记录本地和 Pexels 代表路径。Freesound、Cloudflare、OpenAI 未技术通过，按 Owner 豁免保留；第三项不以已有代表样本替代全部媒体族真实验收。本轮另有 3 镜头 Pexels 真实下载、导入、预览与最终包证据；导入 13.3MB MP4 暴露的大 Base64 正则栈溢出已做必要补修，经解码和规范重编码一致性校验保留输入验证。3 路低分辨率源均上采样，第三路含建筑/游客，见[内容质量观察](../../verification/tts-production-e2e-20261026/root-content-quality-observations.json)。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
