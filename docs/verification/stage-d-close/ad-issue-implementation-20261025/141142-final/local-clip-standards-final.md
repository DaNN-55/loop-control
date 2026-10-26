# #142 local clip Critical closure final review

审查对象：当前 `src/local-app/episodeCommands.ts`（SHA-256 `458c03237eac140bf42054cedeb606f503e2c379013633c5535e4030f5b9a6ca`）及 compile-correction patch `7722b2bad16de493d2701933167422200004742c78edce55f406767ab9609035`。此前两份 hard 报告保留，未运行服务、SQL、Provider 或测试。

## Critical issues

已关闭。`generateSourceAudio` 已恢复原无条件 `media_enabled=true`，不再引用不在词法作用域内的 `localClip`；当前源码中 `localClip` 的唯一引用均在 generateClip 所在的同一 media-command block（`episodeCommands.ts:155-158`）。

原授权扩大也已关闭：先以 `SELECT media_enabled ... FOR UPDATE` 读取并锁住 input row。仅既有 `media_enabled=true` 的 generateClip 使用 `local_clip` 和 ffmpeg readiness，且不写任意 dispatch flag；首次/false 状态则走原 full preflight、`requireMedia` 和首次 enable 流程。因此过期在线 policy 不能以本机 clip 新开广域媒体资格。

## Important improvements

此前真实 Owner HTTP/PG 3-case 证据覆盖 false+过期 policy 的 409、实际 planner=0、exact external claim=[]、零 secret/transport，和 true case 的 FFmpeg task/完整 input row 不变。单行 correction 仅恢复 source-audio 原行为，未改变该测试的 generateClip 逻辑；主 full test/build 仍由 root 执行。

## Optional notes

无新增范围或 #145 unknown 门禁退化。

## Verification suggestions

无需新增设计；记录 root 的主 full test/build 结果后，可将本 Critical 标为已修复并保留前序 red/compile-failure 证据。
