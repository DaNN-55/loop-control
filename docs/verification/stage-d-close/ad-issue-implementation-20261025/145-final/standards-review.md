# #145 Standards 只读审查

审查 patch：`d63057adb14728b60c0f354797271f584d8d5b6bef9e24cb7f7235f1f0c455af`。

## Critical issues

- 未发现最小 patch 引入的硬风险。

## Important improvements

- `providerNetwork.ts` 将 caller signal 与本地超时合并，发送前持久 reserved、发送后任何异常保留 unknown/预算并停止后续请求；请求锁在 state 持久化前不释放。abort 的输家 transport 不再有状态写入，响应完整读取且受声明/流式大小上限约束。
- `ProviderOutcomeUnknownError` 在 media/narration 仅透传安全类别，`codexRunner` 转为 blocked、`retry=false`，并输出不自动重发的 Owner 指引；不会把网络异常原文、取消原因或 Authorization 写入账本/CLI。
- `unknown`/`reserved` 的新进程和锁等待后 fresh read 均拒绝派发；预算不退款。blocked 不会成为 ready，保持“仅 ready 自动领取”契约。

## Optional notes

- 取消恰好发生在 reservation 落盘后、transport 调用前会保留已消费预算并标作 failed（而非 unknown）。这是保守但会阻止自动重试；若要区分为“确定未发送”，需额外持久 dispatch 边界，当前不构成绕过或退款风险。

## Verification suggestions

- 已有本地 HTTP abort、完成后 abort、锁交错 89/89 覆盖所审变更；无需重跑。真实 Provider 授权仍等待根任务明确 GO。
