# B 阶段复查

在优化工作树、`codex/local-first-stage-a`分支执行。不要在生产目录运行。

1. 打开[最终恢复控制台55176](http://127.0.0.1:55176)，独立Chrome已登录恢复Owner；打开 `Stage A fixed 3-shot`（13029a1c）检查真实任务和产物索引。`Stage B restore checkpoint`仅为DB审核历史fixture，UI会提示其文本产物路径无效，不用它验证完整审核包。新密码仅在 `.loop-control/stage-b/verified/state/owner-<Owner ID>.json`，不要发送或记录。
2. 真实中断恢复Episode和媒体哈希见 `t05-verified-worker.txt`。媒体在 `.loop-control/stage-b/verified/media` 独立卷。55176只允许经过Owner校验的测试派发入口；其他本机工具503是刻意的隔离边界。早期55174/55175仅历史诊断，不用作验收。
3. `npm run isolated:stage-b-audit -- --verified`：只读检查源A业务/权限指纹、秘密排除、生产PID/Git与loopback。
4. `npm run isolated:leases -- final --verified`：追加独立UUID任务并重做11项真实故障/竞争检查。`npm run isolated:worker-recovery -- --verified`：追加Episode/任务，杀自己新建Worker组后经HTTP重试FFmpeg；都会保留证据，并非只读。
5. `npm run isolated:sql-tests -- --affected --verified`：37项B相关SQL应通过。全部SQL仍有5个已与A基线核对的既有失败文件，详见主报告，不能期望全绿。
6. `npm run isolated:backup`：从A兼容库生成新v2一致性备份，要求暂停媒体写入。现有已恢复目标会拒绝覆盖；不使用reset、删除证据或覆盖旧配置来重复空库恢复。

本轮保留数据库/镜像/服务便于复查。可用 `npm run isolated:restore -- stop-console --verified` 停止且只停止身份匹配的最终恢复控制台；A仍使用原isolated启停入口。不要使用stop-all、pkill、生产reset。其他恢复栈的完整生命周期与环境迁移不属于本次生产切换授权。
