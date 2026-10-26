# #145 / C14 最终 Spec 复核（只读）

## 结论

**C14 可关闭。** 本结论只覆盖已批准的 Pexels 最小真实副作用窗口，不宣称 Provider 远端取消、远端 exactly-once 或最终费用已证实。

## 对照验收

1. 正常入口与中断：`npm start`、正常 Owner API、新 B-roll task 均真实执行。request2 的真实 Pexels response headers 为 200，原 response 在真实 Worker 内持住而未替换；Root 以 PID/PPID/PGID/lstart 核对后只 SIGKILL 自有 Worker `73275` 组，Vite `72858` 保持存活。私有 transport trace 未含 secret/header/payload。
2. 结果未知及后续：进程被杀不能称作远端取消。持久 ledger 保留 `pexels.search=reserved`、`used=2` 和 request.lock；正常 lease 后的 attempt1 在发送前得到 `provider_result_unknown`，数据库 task 为 `blocked`、`retry.shouldRetry=false`，Owner 可见核对路径。显式 retry 得 409、不建 task、不发 request；正常 stop/start 后 ledger SHA、used2、lock 与 blocked 状态不变。
3. 预算与边界：verify1/search1 是全部两次真实请求，第三授权未用；没有 refund、清零或自动 resend，未改 SQL/租约。最终正常 stop 完成，专用 Keychain 回到初始 locked 状态。固定离线规划只构造 transport 夹具，并非模型质量证据。

## 保留限制

- 200 仅证明真实传输已返回 headers；Worker 被杀前未把 body 交给业务完成，故采用“结果未知”是正确且保守的表达。
- `remoteCancellationConfirmed=false`、`remoteExactlyOnceConfirmed=false`、`externalFinalCostConfirmed=false` 必须继续留在关闭说明中；本地 SIGKILL 不能替代任何一项。
- 不推断生产切换、E/F、其他 Provider 或历史门禁完成。
