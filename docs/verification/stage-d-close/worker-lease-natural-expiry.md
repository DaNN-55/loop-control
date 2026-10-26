# 30 分钟 Worker 自然租约与进程边界验收

2026-10-25，Asia/Shanghai。优化 worktree、`codex/local-first-stage-a`，基线 `bca697b`，保留上轮未提交稳定性修复。本轮只关闭**当前原生 Worker 的 30 分钟自然过期接管及已列出的进程边界验收**。不扩展秒级故障切换，不追认历史运行通过，不改变其他未验收门禁。

## 自然等待与正常入口

本机 HTTP harness 装载原 `createNativeApplication` 和 Owner handler，任务由 HTTP 配置、上传合成输入并提交，真实常驻调度器→原生 Worker CLI→PG→文件；没有替换领取、续租或结果函数。该装配不是 `npm start`、Chrome、默认/新主机部署验收。三个新隔离数据库分别用于自然任务、事务竞争/预算和进程边界；媒体为本轮独立 APFS 副本，无 Keychain 或在线 Provider。

主样本最后一次续租为 `2026-10-25T03:27:53.750116+00:00`。真实杀死本轮父服务及 Worker 进程组后立即恢复消费，原尝试保持运行中，未修改 `claimed_at`、系统/数据库时钟或 30 分钟窗口。被动观察器只记录状态转换，不写任务字段。

| 验收 | 观察结果 |
| --- | --- |
| 自然回收 | 数据库 `clock_timestamp()` 记录在最后续租后 **1800.913066 秒**发生 running→ready；观察脚本首次发现新尝试为 1805.104 秒。[转换](evidence/worker-lease-natural-expiry/natural-transition-result.json)、[连续采样](evidence/worker-lease-natural-expiry/natural-observations.jsonl) |
| 原任务完成 | 原 attempt 0 failed、新 attempt 1 completed；新 token 不同，只有一条新 run，HTTP 产物大小/SHA 一致。[结果](evidence/worker-lease-natural-expiry/natural-acceptance-result.json) |
| 预算自然到期 | 独立样本真实等待 1800.411 秒后回收，预算用尽仅保留失败 run，不多领一次；过期心跳在回收前也被拒绝。[结果](evidence/worker-lease-natural-expiry/competition-final-result.json) |
| 真实竞争/续租 | 两个独立连接经真实 advisory-lock 屏障同时阻塞，实际返回数量 `[1, 0]`，只领一次；续租持有真实行锁时，另连接不回收有效尝试。未声称覆盖所有临界时刻的竞态 |
| 迟到回写 | 旧 attempt 的心跳/进度/结果、错误 token 返回 42501；自然主任务完成后回放含篡改产物哈希的旧结果，task/run/产物索引原字节不变。[结果](evidence/worker-lease-natural-expiry/natural-late-fences-result.json) |

原任务没有重新提交或定向唤醒。等待早期曾有两个其他样本在同一库执行 HTTP start，之后移至独立库；这些全局唤醒不等于原任务重提，仍须披露。到期前后由正常周期扫描回收。原 observer 的宽泛 `noPostRestartHttpWake` 口径不接受；其运行中还假设旧 attempt 始终 running，不能识别到期后的合法 ready/退避。到期前已并行补充严格的 running→ready（旧 run failed、token 清空且已满 1800 秒）→新尝试检查，旧观察器及原日志保留，[限定后的结论](evidence/worker-lease-natural-expiry/evidence-corrections-result.json)为验收依据。

## 发现与最小修复

父服务 SIGKILL 后，独立 Worker 仍有有效租约，但向关闭的 stdout 读端写进度触发未处理的 EPIPE，进程退出，任务暂留 running。[真实故障](evidence/worker-lease-natural-expiry/parent-exit-02-observed-failure.json)。独立真实 CLI 关闭输出读端复现 exit 1/EPIPE/running；没有以数据库或租约错误替代该根因。

仅在 `src/local-app/localWorkerCli.ts` 增加注释和 stdout error listener，忽略 EPIPE，其余错误仍抛出。心跳仍 5 分钟，租约仍 30 分钟，task/attempt/token 围栏、领取、退避和预算均不变。修复后同一故障路径 exit 0/completed，实际 HTTP 产物 SHA 通过；原父服务 SIGKILL 路径复验中，旧 Worker 在**原有效尝试**完成，单 run，无重复领取。[red](evidence/worker-lease-natural-expiry/broken-pipe-red-result.json)、[green](evidence/worker-lease-natural-expiry/broken-pipe-green-result.json)、[HTTP](evidence/worker-lease-natural-expiry/broken-pipe-green-http-result.json)、[原场景复验](evidence/worker-lease-natural-expiry/parent-exit-03-result.json)；[修复前](evidence/worker-lease-natural-expiry/localWorkerCli-before.ts.txt)、[修复后](evidence/worker-lease-natural-expiry/localWorkerCli-after.ts.txt)。

自然主样本在修复前已终止旧 Worker；等待过程中显式重建了最终运行程序，接管后的新 Worker 使用最终修复版。租约 SQL 和主样本原 token/时间戳全程不变。没有把原版本的父进程故障失败改判通过。

## 进程边界与回归

- 仅 Worker 进程组退出、父服务仍在：正常带围栏的失败回写释放任务，保留旧失败，新尝试完成。[最终结果](evidence/worker-lease-natural-expiry/worker-exit-03-result.json)
- 仅父服务退出、Worker 仍持有效租约：新服务不撤销其租约；EPIPE 修复后原尝试完成。这不是接管或秒级故障切换证明。
- 正常停止：本轮 Worker/执行器进程组被结束，失败历史保留，ready 任务在重启后完成。[结果](evidence/worker-lease-natural-expiry/graceful-stop-02-result.json)
- DB 领取正等待锁时正常关闭：真实等待后释放锁，关闭过程没有遗留有效租约；重启后一失败/一完成。[结果](evidence/worker-lease-natural-expiry/stop-during-claim-result.json)
- 最终代码默认 5000ms 回归 **102 文件、766/766**，排除项与上轮相同，无 timeout 覆盖；类型、显式运行程序准备和内容指纹通过。[全量](evidence/worker-lease-natural-expiry/full-default-01.log)、[类型](evidence/worker-lease-natural-expiry/typecheck-01.log)、[运行指纹](evidence/worker-lease-natural-expiry/runtime-integrity-result.json)。本轮未新增组件 UI 行为，不启动浏览器冒充进程证明。

## 历史失败、夹具及口径纠正

首次环境脚本误用不存在的 automation enabled 字段；后改为远期计划日期，infinity 引发的 PG_INVALID_DATE 警告也保留并改为明确远期日期。竞争夹具先违反同 Episode 单活跃视觉任务约束，再遇 Codex 资源上限；没有绕过约束，使用不同 Episode 并按顺序结束夹具，最终全机容量恢复原值 2。初始同库 Worker/父服务测试因主样本有效租约占用 Codex 容量而超时，保留并移至独立克隆。父服务退出真实失败和独立 EPIPE red 均保留。

初版 observer 若在合法 ready/退避时报错，属于已识别的观察器状态假设错误，不是任务提前失败；最终使用到期前启动的 followthrough 观察器和被动数据库转换记录。中间 `competition-continue` 摘要将连接顺序写死，不能作为竞争验收；该原始摘要仅私有保留。最终使用 `competition-finish` 实际采集的阻塞连接与返回数组。独立只读代码审查 0 项发现；证据审查提出上述竞争计数及宽泛 HTTP 唤醒两处口径问题，均明确限定，原记录不覆盖。

原 690 项公开和 862 项私有证据保留；仅更新活动 README/review，其旧版分别归档为 [README](README-before-natural-lease.md) 和 [review](review-before-natural-lease.md)，旧索引私有快照保留。B/T05 的模拟过期、T23 的重启超时及修改 claimed_at 的历史演练仍按原时间解释；本轮新证据不追认它们为自然等待成功。上轮默认 5 秒修复及全部历史红/绿记录不改。

## 继续保留的门禁

**秒级故障切换、仍存活且过期的执行器对同一路径写文件的隔离、已发在线请求取消/远端去重、真实 WhisperX、在线 Provider/Keychain 完整链路、完整多能力 Worker、默认/新主机部署、真实通知送达及 E/F 继续未验收。** 数据库拒绝旧回写不等于文件沙箱或外部副作用取消。当前自然主样本的旧执行器已被杀，迟到围栏采用 RPC 回放；不冒称仍存活的过期执行器不能写文件。

SQL 一致性建议继续暂缓，没有修改 SQL 源码/迁移；专用克隆的夹具 DML 和被动观察表只服务本轮验收。收尾只停止本轮服务，保留三个克隆、APFS 媒体和私有证据，不提交、不推送、不新增在线请求、不进入 E/F。[摘要](evidence/worker-lease-natural-expiry/verification-result.json)、[收尾](evidence/worker-lease-natural-expiry/cleanup-result.json)、[总索引](evidence-index.json)。
