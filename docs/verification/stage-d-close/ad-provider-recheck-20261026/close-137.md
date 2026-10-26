按 Owner 本轮明确授权关闭：保持原配置复测一次，仍不可用则记录原因、跳过完整测试并关闭。此关闭原因使用 `not planned`，表示接受本轮范围豁免，不代表 Google TTS 验收通过。

沿用此前固定连接及版本、原 Keychain 引用和 Google 资格端点，实际发送 1 次 GET，仍返回 HTTP 403；允许列表错误原因为 `BILLING_DISABLED`。无自动重试、合成、下载或新凭据；完整真实语音闭环仍未验收。

本地未提交证据：`docs/verification/stage-d-close/ad-provider-recheck-20261026/google_tts-retry-result.json`、`provider-recheck.md`。旧失败、旧预算与原验收清单保持原样；新一次性授权已禁用且计数保留。不得解释为服务恢复或生产可用。

#146/#147 已只读复查通过；四家处理完后再执行 #149。不修改业务代码、不提交、不推送、不进入 E/F。
