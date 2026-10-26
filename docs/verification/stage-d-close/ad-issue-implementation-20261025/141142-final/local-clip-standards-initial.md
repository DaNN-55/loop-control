# #142 local clip preflight Standards 审查

审查对象：`142-clip-preflight.patch`（SHA-256 `46458e9734a58663d87bb5918e7bbba6d0ba39d60674ab0e4b922442d93b3d3e`）与 manifest。主区尚未合入；未运行服务、SQL、Provider 或测试。

## Critical issues

`src/local-app/episodeCommands.ts` 的 `generateClip` 新分支虽然跳过了过期外部引用检查，但仍无条件写入 `local_identity.input_episodes.media_enabled=true`，并在事务提交后调用 `wake(episodeId)`。这不是“仅本机 clip”状态：`input_task_allowed` 用 `media_enabled` 共同允许 `generate_a_roll`、`generate_b_roll`、`generate_soundtrack` 和 `extract_embedded_audio`；`workerScheduler.wake({episodeId})` 会调用 `plan_input_tasks`，而其 storyboard-approved 分支会规划 A/B-roll 与声轨任务。

因此，一个因在线 policy 过期而本应 409 的外部 Pexels/Freesound 配置，可先用 `generateClip` 绕过全蓝图预检，再由 wake 规划和领取外部任务。`input_media_connection` 只要求已有 qualified/live probe，不读取这份已过期的本机 Provider policy；Worker 随后可在 transport 拒绝前读取 Keychain secret。账户/Owner 校验并不能缓解同一 Owner 触发的越权。此补丁不应合入。

## Important improvements

`localClipReady` 本身正确：仅走现有 `ready`、资产根、媒体库和 ffmpeg/ffprobe，不伪造在线 policy，也没有改动 #145 unknown 处理。问题在它之后复用了过宽的 `media_enabled` dispatch 旗标。

## Optional notes

现有新增 HTTP 测试只断言 `generateClip` 的 mock wake 计数和独立 `planMedia` 的 409；它没有启动真实 scheduler，也没有断言 wake 后不会创建/领取外部任务或读取 secret。

## Verification suggestions

最小修复必须使 FFmpeg clip 获得独立、仅该 task 的可领取资格，不能写入泛媒体 `media_enabled`，并新增真实 Owner HTTP + scheduler/claim 负测：过期外部策略下 clip 可领取，但 Pexels/Freesound 不创建、不领取、零 secret read/transport。保留原 #145 `unknown` 门禁。
