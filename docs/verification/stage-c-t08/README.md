# T08：预构建、即时唤醒与五秒内兜底

2026-10-23，基线 `e62dce8`。T08/#114 已在当前优化工作树实现并完成本地验收，Owner 已认可结论；本次提交归档实现、验收报告、回归日志和证据索引，未推送或合并，T09 未开始，没有操作生产。

## 结论与限制

- 编译已移到显式准备/服务启动阶段。缺失、被改写的产物及源码变化均使 CLI 和 HTTP 明确拒绝执行；重新准备并重启后恢复。普通派发与暖重启前后所有构建产物的内容哈希、修改时间相同。
- 同一服务拥有一个常驻调度器，即时唤醒与兜底共用持久任务队列和 T07 原子容量/公平领取。**实际兜底周期为 4 秒，为 RPC 和宿主调度留出 1 秒预算；提交成功/ready 到原子领取仍按不超过 5000ms 验收。** 业务规划、领取扫描分别防重入，长任务及慢规划不会占住领取扫描。
- 本次真实 HTTP/Worker/FFmpeg 的三类健康空槽样本分别为 **130.337ms、3663.163ms、296.040ms**；真实 DB/受控长执行期间、没有浏览器或显式唤醒的兜底样本为 **3896.427ms**。这些是已执行样本，不是任意宿主负载或生产吞吐保证。
- **保留 T06/B“默认 5 秒门禁此前未通过、时序不稳定根因未解决”的限制。** 本轮 Vitest 无 timeout 覆盖，默认 5000ms、单 worker 为 72 文件/681 项通过；这既不改写旧失败，也不构成旧时序问题已经修复的结论。产品领取时延与测试用例超时分别报告。
- 满载、数据库不可达、程序过期和主动中断另列，不混入健康空槽样本。没有在线 Provider 或完整 Owner 审批链验证；本票无 UI 改动，未新增浏览器复查。T07 的三条既有 RLS 性能告警继续保留，本票无数据库迁移或权限修改，未重跑 advisors。

## 票单、依赖与实现

只读 gh 核对 #114 OPEN / ready-for-agent、正文/评论和原生 blocked_by：唯一依赖 #113。T07 本地实现、已认可验收和提交 `e62dce8` 满足技术前置；云端两票保持 OPEN，没有代替 Owner 改标签、评论或关票。[票单快照](ticket-114.json)、[依赖快照](ticket-dependencies.json)。

- [runtimeBuild](../../../src/orchestration/runtimeBuild.ts) 将源码、package/lock、两份构建配置及全部 Worker/编排输出的 SHA-256 与工作目录、Node 主版本绑定。`runtime:prepare` 是唯一准备入口，先使旧清单失效、串行构建，再原子发布清单；编译失败/准备期间源码变化不会保留有效旧清单。独占准备目录防止并发构建；中断残留明确报错。
- [准备脚本](../../../scripts/prepare-runtime.mjs)、[CLI 包装](../../../scripts/run-prepared.mjs) 与 Worker/编排 CLI 本体均执行相同准备契约。`worker:run`、`orchestrator:run` 不再热编译；未准备时应先 `npm run runtime:prepare`。启动脚本在服务/兼容定时器前准备；Vite 开发/预览服务在监听前准备并注册调度器，Vitest 模式不启动服务。
- [workerScheduler](../../../src/orchestration/workerScheduler.ts) 合并重复任务唤醒，保留扫描中到达的唤醒；规划独立串行，完成后唤醒短领取扫描。扫描只预留空槽并启动既有子进程，不等待长执行；执行结束立即补位。没有新增公开队列 API，也没有新增 npm 依赖或第二套定时服务。n8n 的原兼容流程保留，但入口只运行准备好的产物；没有改动运行中的生产工作流。
- [workerService](../../../src/local-control-plane/workerService.ts) 保留 HTTP/Worker 数据库绑定及服务端凭据边界。现有 `/_episode-dispatch` 保留 Owner、Origin、成员关系和持久状态语义；准备无效时 POST 明确 503，而不是隐瞒阻塞或执行旧程序。
- 生命周期关闭清理定时器、等待扫描/规划并只终止本服务创建的 Worker 进程组。中断尝试通过原有 token/attempt 围栏事务写入失败重试，不能借进程退出直接改写数据库；断网时仍以既有租约回收为恢复权威。服务内不保存无界的完成结果列表。

## 验收证据

| 标准 | 实际执行与观测 | 原始证据 |
| --- | --- | --- |
| 预构建、拒绝旧版 | 删除 Worker 产物、改写内容、添加新的源码文件；Worker/编排包装 CLI 和直接编排 CLI 全部拒绝，HTTP 503 并说明 runtime:prepare。任务保持 ready/attempt0；生产启动接口也返回503，完整Episode行（含预检记录）未改；准备+重启后真实 Worker 完成。 | [准备完整性](preparation-final.json) |
| 派发不编译 | 普通 HTTP 派发、连续真实产物、暖重启前后清单及所有输出的 SHA/mtime 不变；单元回归也验证热路径不调用 npm/编译器。 | [HTTP](http-final.json)、[针对性检查](targeted-final.txt) |
| 真实 HTTP 即时领取 | 同一任务5次 POST202，130.337ms 原子领取，单个 attempt0 run 与实际 MP4；身份与持久状态查询均经普通 middleware。 | [HTTP](http-final.json) |
| 无页面、无显式唤醒 | 不进行 POST，也不保持浏览器连接，兜底3663.163ms领取；实际 Worker/FFmpeg完成。 | [HTTP](http-final.json) |
| 长执行期间兜底 | 先确认扫描和规划均结束、长任务仍占一个槽，再创建新任务且不唤醒；下一轮兜底3896.427ms领取，峰值2。20次重复唤醒不重复执行。 | [受控长执行](controlled-final.json) |
| 慢规划不挡领取、防重入 | 规划RPC被门闩持有未返回，新的即时任务仍能领取；短领取请求峰值1。 | [针对性检查](targeted-final.txt) |
| 重启补漏 | 停服务后写入ready任务，无POST；暖重启296.040ms领取、真实MP4。再次重启GET仍成功。 | [HTTP](http-final.json) |
| 运行中退出与恢复 | 真正服务/Worker执行中，用明确标注的私密慢FFmpeg包装器暂停执行；71ms内Worker和子进程退出，任务由围栏事务变ready/attempt1、token清除。重启后普通FFmpeg完成，run历史failed0/completed1，实际产物哈希匹配。 | [退出与续接](shutdown-final.json) |
| 满载及异常另列 | 满载时新任务ready/attempt0，无第三个执行器；释放后补位。真实连接拒绝被明确记录，程序过期503。中断恢复不算健康五秒样本。 | [受控执行](controlled-final.json)、[准备](preparation-final.json)、[退出](shutdown-final.json) |

普通 HTTP 的各条真实 MP4 均为23,297字节，SHA-256 `52ee826ea305bfd0e4e82e357905efdbc6ee3c2297313d22f66341e6012f911c`，磁盘与数据库一致。受控长任务使用真实数据库/结果事务及真实文本文件，未调用在线TTS；退出样本的首轮慢FFmpeg包装器是故障注入，重启后才用正常FFmpeg。各真实演练在开始前保护已有任务行，结束后完整行字节一致；配置、生产、A基线未改。验收后 verified 控制台已停止，避免常驻消费者继续处理历史测试队列，数据库与媒体仍保留。

## 回归、失败记录与复跑

- [默认5000ms应用回归](full-default-5000.txt)：72文件/681项通过，已有React act提示原样保留。单worker，只排除既有n8n节点/集成项和`.loop-control`生成的对照快照，无业务用例排除或超时放宽。
- [完整SQL](sql-final.json)：22文件/249条通过，沿用T07数据库232条迁移，无新迁移。[类型](types-final.txt)通过；准备阶段实际执行Worker和编排构建成功。[Node](node-tests.txt)：2通过/1项本机n8n原生节点校验跳过。
- 首片准备及调度器模块缺失、旧热路径会调用npm均先留red再实现；复审关闭了多次规划RPC阻挡即时领取、直接编排入口绕过准备检查，以及生产启动后才检查准备状态三项风险。最后一项先复现500，再将检查移至运行探测和任何写入前，[HTTP回归](preflight-order-green.txt)及真实库都验证503、无预检记录或状态迁移。
- 原始失败保留在[red-history](red-history/)及[私密证据索引](private-evidence-index.json)：首次受控fixture误用容量1的codex，把资源满载误作空槽；改用已注册、默认容量2的google_tts受控资源，未放宽上限或5秒断言。准备fixture漏传直接CLI要求的LOOP_PROJECT_ROOT；慢FFmpeg包装器最初误用CommonJS而未进入执行；均只修fixture后重验。初次类型检查的未使用导入、Vitest配置钩子曾尝试启用服务的绑定拒绝，也保留日志。没有把这些失败删成全绿历史。
- 私密原始文件含各轮成功/失败、生成物备份、进程包装器及日志快照；索引记录绝对路径、字节、SHA-256，不把私密任务全量快照或认证材料复制到报告。

仅在本工作树现有 verified 目标复跑：

```sh
npm run runtime:prepare
node scripts/isolation/fast-dispatch.mjs --verified --controlled
node scripts/isolation/fast-dispatch.mjs --verified
node scripts/isolation/fast-dispatch.mjs --verified --shutdown
node scripts/isolation/fast-dispatch-preparation.mjs --verified
node scripts/isolation/sql-tests.mjs --verified
```

应用完整命令为 `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --exclude n8n/import-workflows.test.mjs --exclude '**/*.integration.test.ts' --exclude '**/.loop-control/**'`，使用verified的cleanEnvironment，无testTimeout覆盖。五秒时延从同一DB时钟的created_at/ready到claimed_at计算，不用跨宿主/VM时钟相减。退出、失败退避与资源满载样本单独标注。

两轴最终复审见[review.md](review.md)，Standards与Spec均无剩余阻塞项。
