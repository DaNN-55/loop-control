# #145 最终验收结果

结论：本票代码、本地失败分支和真实 Pexels 丢失结果恢复验收通过。产品补丁 SHA256 `d63057adb14728b60c0f354797271f584d8d5b6bef9e24cb7f7235f1f0c455af` 保持冻结，未新增 SQL。主 Agent 整合后已报告 112 files / 889 tests 和 npm check 通过；本代理本地 5 files / 89 tests、应用与 Worker 类型检查通过。

真实验收使用当前新隔离库 `loop_t24_restore_adclose20261025`、本票独立部署和账本，经正常 npm 入口、fresh Owner 登录和正常 HTTP 命令完成。仅在运行时从批准的测试 Keychain exact ref 取值，再正常 API 新建连接；秘密、密码和会话未写入本报告。

本票实际只用 2 次读取：Pexels verify 1 次（HTTP200，3119 bytes 已完整验收）、正常 B-roll Worker search 1 次（真实 HTTP200 headers）。搜索的原始 response 在本机消费前被保留，主 Agent 核实 PID/PPID/PGID/lstart/完整身份后仅向自身 native Worker 进程组发出 SIGKILL，父 Vite 未中断。没有替换响应、直连旁路、Provider 自动重发、下载或第三次请求。

正常父进程观察真实退出，使用原 attempt/lease 报告失败；正常调度在原尝试上限内恢复，任务历史保留 attempt0 failed、attempt1 blocked，任务最终 attempt2/max2。正式 `last_result` 包含 `provider_result_unknown`、`retry.shouldRetry=false`。首次失败记录未删除，未修改 claimedAt、attempt、lease、任务预算或 SQL。

原账本保持 `used=2`、verify1/search1，最后事件仍为 search reserved，原 request.lock 保留，未清锁、退款或重置。正常 Owner `retryMedia` 返回409，未新增任务或请求。同部署、同数据库、同账本正常 stop/start 后仍 blocked；最终正常停止后账本 SHA256 仍为 `412fff1ffb3ba2476072bfc2724ce8fdf6c96b037c5b8abf7da1734534635752`。

23:37:51（Asia/Shanghai）的只读进程核对确认本票观察到的 PID72858、73137、73184、73275、73429、73643 均已退出，55189 无监听。专用 Keychain 初始 locked，收尾恢复 locked。此后 #141/#142 接手独占窗口；该时间点的端口空闲证据不冒充其后状态。本代理不再启动服务或发出网络请求。

边界：这证明真实传输后的本地结果丢失和正常恢复，不能证明 Pexels 远端处理中止、远端 exactly-once 或最终费用。固定离线规划只准备本票的一镜头输入，不作为真实 AI 规划证据。本地账本 cost0/任务成本0 不证明外部最终费用为0。

所有历史失败和未验收门禁保持原样。私有诊断还保留了初次沙箱 Keychain status 失败、两次额外 readback 脚本误以为 Owner taskRuns 暴露 result JSON 的失败说明；已按实际 Owner 合同改为读取 task.last_result，不计作产品失败或通过证据。本阶段收尾没有修改总报告、总证据索引、Issue 或代码，没有提交、推送或进入 E/F。

可追溯证据位于 `/private/tmp/ad-closeout-145-live/evidence-manifest-private.json`，包括正常启动/停止、实际传输 trace、root 中断回执、blocked/显式重试/重启核对、进程退出、Keychain 初态恢复及全部文件 hash。`live-acceptance-result.json`、`live-readback-result.json` 为本次实际结果；局部红绿历史仍完整保留。
