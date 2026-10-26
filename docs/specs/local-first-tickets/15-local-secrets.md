# T15：Keychain连接创建、验证与版本选择

**Stage:** D

**Status:** Keychain 主链及受支持连接路径已有验收；4 家 Provider 保留豁免（2026-10-26）。GitHub Issue [#121](https://github.com/DaNN-55/loop-control/issues/121) 为原票引用；本轮仅同步本地状态，不更改或推断其当前云端状态。

## What to build

Owner在本地创建和验证外部连接，蓝图选择版本，Worker只按引用解析密钥。

## Acceptance criteria

- [x] 秘密写入Keychain，业务库只保存不透明引用；页面、日志与备份不回显原值。
- [x] 连接轮换、撤销和验证记录保持原语义；旧版本不静默改用新秘密。
- [x] 导入后秘密缺失可重新录入/绑定；HTTP到受控Worker路径完成脱敏验证，并说明恢复方式。

## Blocked by

- T14：本地账号、蓝图和系列配置闭环

## Execution boundary

仅在优化工作树及隔离环境修改和验证；保留现有生产服务与数据，不合并。使用已认可的HTTP、真实数据库与真实产物测试边界；阶段必要验证不能省略。遵守票单索引中的A→B→C→D执行门禁。

## 当前证据与限制（2026-10-26）

[真实 Keychain 补验](../../verification/stage-d-t15-keychain/README.md)及[最新审计](../../verification/stage-d-close/ad-provider-recheck-20261026/report-149.md)共同接续秘密存储、版本引用和恢复证据。Pexels/豆包固定样本已有真实路径；Google、Freesound、Cloudflare、OpenAI 为 Owner 豁免而非技术通过，本轮不重试或改变凭据。

[本轮普通长度、多镜头隔离功能全流程及发布包](../../verification/tts-production-e2e-20261026/README.md)已完成，包含中断恢复、一次人工对齐和 Agent QC；适用范围与画质限制见[当前票单索引](README.md)，不替代本票的专项验收或未测 Provider 证据。本轮暂不提交、推送或合并；E/F 继续搁置，旧交接与失败记录保留为历史。
