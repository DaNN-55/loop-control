# T23：本地提醒、健康和备份触发

2026-10-24，分支 `codex/local-first-stage-a`，基线 `8a9c7eb5d609c61038e01bd0fbc2555b8741a895`（T22）。

**T23 实现及受控离线本地验收完成，本报告随实现按后续授权纳入当前分支的本地提交。** 最终默认 5000ms 回归为 **97 文件、747/747 通过**。**T21 当次及历史默认 5 秒失败继续保留，根因未解决；本轮通过不关闭历史问题。** 未新增在线请求、操作生产、推送、合并或开始 T24。

## 票单、依赖与范围

依据本地已发布 T23 / [#129](https://github.com/DaNN-55/loop-control/issues/129)，核对三项验收：复用统一队列和事件语义、持久化计划/消费状态并在重启后续接；用可控时钟验证上海计划及备份触发、演示真实服务重启；新版启停和状态不依赖 n8n，生产 n8n 保持原样。遵守“不新增在线请求”，未联网刷新 GitHub 状态或改票单。

依赖为 [T08 / #114](../stage-c-t08/README.md)、[T09 / #115](../stage-c-t09/README.md)、[T22 / #128](../stage-d-t22/README.md)。沿用实际预构建、原子任务领取、T09 事务内事件入账与随机 token 完成规则。仍使用同一隔离工作树、专用 PostgreSQL（55472）、既有媒体卷；本轮在该实例新增 `loop_t23` 克隆库及合成账号，应用为 `127.0.0.1:55186`。克隆库内先关闭旧测试生产单的 Worker 资格，只执行本轮新单。原 `loop_imported` / `loop_empty` 仅应用前向本地迁移，未启动其自动消费者。

## 实现与行为

- [原生自动化](../../../src/local-app/nativeAutomation.ts)随 Node 应用启动、停止，与既有 Worker 服务组合。生产任务继续使用原统一队列；提醒经 [036](../../../db/local/036-native-automation.sql) 的内部网关消费 **同一 T09 账本**，不使用文件游标或时间戳高水位。首次历史初始化、并发领取、持久 reserved、token 完成及 unknown 不自动重发的语义保持不变。接口接受不代表可见或已读。
- 私有计划默认上海时间每日 09:00，健康与备份分别记录唯一的计划时点、任务、尝试、退避和租约；每次扫描最多补排每类 32 个逾期时点，后续扫描继续补漏。补漏备份保存实际生成时间，不冒充曾在错过时点完成。没有浏览器时仍运行；服务端测试时钟不开放给 HTTP。
- [037](../../../db/local/037-automation-attempts.sql)保留运维尝试历史。原子领取、防重、30 秒租约与续租/丢失中止、完成 token 围栏、正常停止后的 ready 续接、崩溃后的过期回收均持久化。失败间隔一分钟重试，最多 3 次；耗尽记录失败，次日计划不受阻。健康和备份的当前/最近成功/最近失败由数据库尝试历史读取，避免文件缓存丢失后显示假成功。仅内部应用角色可消费，Owner/Worker/匿名无计划表或提醒领取权限。
- 健康只检查本机 PG、媒体目录和已准备运行程序，不执行在线模型或连接健康探测。[原生备份端口](../../../src/local-app/nativeBackup.ts)使用固定隔离脚本、受控 stdin 和本服务子进程组；[备份实现](../../../scripts/local/backup.mjs)校验目标实例和库，导出同一 PostgreSQL 快照，核对所有索引媒体及复制前后文件清单，验证后按 job ID 发布不可变归档。同一 job 可复核复用；未完成目录与死锁标记保留后重建，链接和损坏归档拒绝。
- 备份包括业务、原生身份映射/内部状态、迁移与权限 DDL、媒体；排除 Owner 密码摘要、登录会话/认证 token、Keychain 内容和主机 DB 凭据。业务租约/提醒围栏属于私有恢复状态，保留在私有归档中。首轮 49 表/842 文件，后续最终为 50 表/848 文件；**备份生成与完整性检查通过，T24 的真实新环境恢复、密码重设和秘密重绑尚未执行**。
- [原生启动](../../../scripts/local/start.mjs)显式准备运行程序后启动；[服务装配](../../../scripts/local/vite.config.mjs)不查询、启动或停止 n8n。启用 Worker 时由原 Worker 记录调度结果，避免两个空闲成功记录交替覆盖；未启用 Worker 时由自动化记录自己的扫描。原有 `npm start` 兼容入口和生产 n8n 文件保留，T25 尚未实施。
- [系统状态](../../../src/local-app/LocalSystemStatus.tsx)经既有 Owner 会话和精确 Origin 的只读端点展示调度、提醒、健康、完整备份和部分快照；支持手动刷新、重载，明确保留旧失败及 unknown。没有把“无需 n8n”显示成全部生产能力已健康，也没有启用部分快照冒充完整备份。

## 真实验收

| 验收路径 | 已观察结果与证据 |
| --- | --- |
| 上海计划边界 | 08:59:59 未触发，09:00 只有健康与备份各一项，推进至次日 09:00；真实 PG 快照与媒体生成。[日检](evidence/daily-02-daily-result.json) |
| 提醒并发与晚提交 | 两个独立进程处理 120 条同时间戳新事件，87/33 条，ID 全部唯一；早开始晚提交的旧时间戳事件仍消费，错误完成 token 被拒绝。[结果](evidence/concurrent-01-concurrent-result.json)。另有单进程 25 条新事件通过 |
| unknown 与真实崩溃 | 一条受控接口接受后抛错保留 uncertain；一条接口接受后真实 SIGKILL 保留 reserved。重启各只有一次接口记录。克隆库继承 4 条 unknown，加本轮 2 条后共 6 条，页面始终“需处理”，没有自动重发。[故障](evidence/crash-02-crash-result.json)、[重启](evidence/restart-02-restart-result.json) |
| 真实桌面接口 | 消费一条合成事件，实际 `osascript` 返回并登记 accepted；只证明调用接口成功，**未证明可见送达或 Owner 已读**。[结果](evidence/desktop-interface-result.json) |
| HTTP 队列重启 | 新单通过真实 Owner HTTP 提交；仅该任务注入 8 秒 available_at，移除测试触发器后 SIGKILL，重启无再次命令/唤醒，实际原生 CLI 完成、一任务一 run、产物 SHA 匹配。没有修改此样本租约。[崩溃前](evidence/ready-crash-01-ready-crash-result.json)、[续接](evidence/ready-restart-01-ready-restart-result.json)。规划器为离线合成替身，不是在线生成 |
| 运维恢复与预算 | 正常停止留下 ready/interrupted，真实重启继续；真实 SIGKILL 后将**测试时钟**推进 31 秒，回收并完成，旧尝试保留。健康/备份分别失败后重试成功，各自旧失败仍在；3 次耗尽后无第四次，次日仍执行。[正常重启](evidence/maintenance-restart-result.json)、[崩溃恢复](evidence/maintenance-crash-restart-result.json)、[独立失败](evidence/failures-01-failure-recovery-result.json)、[预算](evidence/maintenance-budget-result.json) |
| 迟到结果围栏 | 主进程健康动作受控挂起、租约在测试时钟下过期，第二进程接管成功；原动作因丢失租约中止，不能覆盖 attempt2 的成功。[结果](evidence/late-completion-result.json) |
| 备份边界 | 相同 job 不增归档；故意破坏现有归档后拒绝，随后恢复并核验原字节；人工构造的部分目录/死 PID 锁保留后实际重新备份；链接目标拒绝，控制文件未变。额外恢复请求为合成夹具，非计划任务。[结果](evidence/backup-boundary-result.json) |
| Chrome | 登录、五类独立状态、手动刷新、跨真实服务重启后的整页重载通过；旧失败和 6 条 unknown 可见，最终健康/备份通过。检查 416 个实际网络目标均为 loopback；内联 SVG 的 namespace 不是网络请求。[摘要](evidence/browser-final-result.json)、[实际整页截图](evidence/browser-15-full-status.png) |
| 边界、空闲与历史 | 匿名 401、错误 Origin/CSRF 403，内部权限拒绝；空闲观察 8.5 秒跨两轮兜底，调度结果内容/mtime 不变。[权限](evidence/boundary-01-boundary-result.json)、[空闲](evidence/idle-schedule-result.json)。[审计](evidence/audit-01.json)：原库 38 表/26,552 行按 COPY 多重集完全一致，43 个无关文件哈希不变；三库迁移 SHA、10 份私有备份/8,474 文件指纹一致，认证数据确实未导出 |

## 回归和失败记录

最终 [默认 5000ms 命令与结果](evidence/default-5s-02-result.json)、[原日志](evidence/default-5s-02.txt)：97 文件/747 项通过，无 timeout 覆盖。TypeScript、原生编译、runtime 完整性及 [本地前端构建](evidence/frontend-final-02.txt)通过；[Node](evidence/node-final-02.txt)为 2 通过/1 项既有跳过。首轮默认回归已通过；后因修正空闲调度记录的重复写入，才进行最终同命令回归，没有反复跑到掩盖失败。

保留以下原始失败与口径：

1. 初始测试网络 guard 未解包 Node 的规范化 socket 参数，HTTP 在连出前被拒绝；修正测试 guard 后通过。首次合成账号漏配分镜执行器，真实前置检查正确 409；只通过 Owner HTTP 修正该测试账号及夹具。[初次 guard](evidence/daily-01.txt)、[前置拒绝](evidence/crash-01.txt)。
2. 第一次崩溃样本以容量 advisory lock 挡住领取；应用退出后等待中的 DB 领取仍可能提交，任务进入既有 **30 分钟有效租约**。首个重启检查超时，未当作成功。随后仅将该合成任务的 claimed_at 模拟为过期，由真实常驻 Worker 回收并完成，failed0/completed1 历史保留；**未实际等待 30 分钟，也未证明立即故障切换**。独立的 ready 队列重启样本另行通过。[超时](evidence/restart-01.txt)、[受控过期](evidence/controlled-worker-lease-expiry.json)。没有修改 Worker 的既有租约实现。
3. 一次额外 `query_timeout` 写法未通过当前 pg 类型定义，已移除；[原始类型错误](evidence/local-types-07.txt)保留，最终类型和构建通过。一次组件裁剪截图为空，保留在私有原始材料，不作通过证据；随后实际整页截图已查看。最初网络文本扫描把内联 SVG 中的 `www.w3.org` namespace 算成 URL；改按实际请求目标审计，无外部请求，不把这次解析错误伪装为一轮成功检查。
4. 时钟、controls、runtime 和运维“最近结果”是滚动状态，事件日志追加；编号 stdout/结果独立保留。未声称每一个中间状态都有独立原始归档。[T17 中间日志覆盖说明](../stage-d-t17/README.md)继续有效。

## 保留限制与收尾

- **T21 当次及历史默认 5 秒失败、根因未解决**继续保留；本轮未修复或关闭该问题，产品领取时延和 Vitest 超时分开。没有新增 T08 产品五秒时延保证。
- 真实 WhisperX 成功推理、默认部署、在线生成、其他 Provider、完整多能力 Worker 尚未验收。既有 Provider 最小验证范围不扩大。T24 新环境恢复、T25 依赖清理尚未开始；不能把本机专用隔离脚本视为通用生产部署证明。
- 模拟 `live/verified` 资格、SecretStore 替身限制保留。本轮未创建新的在线资格、解析 Provider 秘密或调用 Keychain；合成规划器、时钟、挂起/抛错/过期/部分目录夹具均明确标注，不冒充在线、真实 30 分钟等待或完整恢复。
- 独立应用/Worker/专用 Chrome 和合成浏览器认证项已收尾；数据库、媒体卷、私有备份及失败证据保留。[证据索引](evidence-index.json)区分公开与私有；密码、会话、token、原始网络记录、备份和数据库原始材料均不复制到报告目录，未生成 HAR。
- 本轮未操作生产、推送、合并或更改 GitHub 状态。根 PLAN 与无关规划保持原样。[本地复核](review.md)由主 Agent 完成，不代表独立评审或整个 D 阶段验收。

最终全量回归后仅新增并实际执行只读审计脚本及整理报告；业务实现未再变动。提交范围与敏感值检查记录见[最终范围检查](evidence/scope-final-result.json)，提交状态以 Git 历史为准。

## 本地提交归档

验收完成后获用户授权，将实现、报告、回归日志和证据索引归档到当前分支。原始证据中的 `noCommit`、`indexEmpty` 等字段描述验收收尾时的快照，保持原样。此次仅调整归档说明与索引状态，业务实现及原始日志未改动，未重跑已通过的验收。T21 当次及历史默认 5 秒失败、根因未解决、既有 30 分钟 Worker 租约等待和即时故障切换未证明，以及所有既有未验收项、模拟资格、SecretStore 替身和 T17 日志覆盖说明继续保留。无关规划文件、原始网络记录、备份及其他含凭据的私有证据未纳入提交。
