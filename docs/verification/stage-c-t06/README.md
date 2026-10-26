# T06 / #112：统一持久执行入口

2026-10-23，基线 `474b0d3`，分支 `codex/local-first-stage-a`。Owner 已认可 B，授权 T06 实现、验证、审查及本地提交；不推送、不合并、不关闭 Issue，不操作生产。已实际使用 GitHub connector 和 gh JSON 读取 #112 全文及全部评论（0条）。

## 实现与契约

- `tasks` 继续是唯一持久任务队列，任务 ID 对应既有冻结输入；生成任务/开始生产的现有业务事务就是持久提交。即时 HTTP 只唤醒这条队列，定时扫描能够找回丢失的唤醒；不另建重复队列或公开 API。
- `dispatchWorkerTasks` 是任务、Episode、全局定时共用的编排/扫描/执行入口。范围仅限制本轮候选；所有 Worker 仍通过同一 `claim_next_worker_task` 原子领取、现有资源组容量、Worker 预检、租约 token/attempt/有效时间检查和业务结果回写。B 数据库契约及 231 条迁移保持不变，本票无 schema 迁移。
- 消费扫描现有 ready 和过期 running，含空 claimed_at；不依赖本次 planner 返回新建任务。按稳定顺序完整分页候选。规划函数、冻结输入、Owner/RLS、旧结果拒绝和业务阶段保留。
- 既有 `/_episode-dispatch` 返回持久任务 ID、真实排队/运行/完成状态和同一路径的查询地址；已完成重复 POST 返回200及同一任务，不再执行。GET 在任务完成、服务重启后仍可用。进程退出/202/idle 均不等于成功。Map 只合并同一进程内的唤醒，无完成或幂等权威。
- POST 必须提供 Origin，并精确匹配实际监听端口及固定 loopback 主机，拒绝缺失来源和伪造 Host 的跨站请求；身份仍为显式 Bearer Owner 会话，无 Cookie 授权，继承跨账号 Owner 和 Task→Episode 校验。执行环境与 HTTP 数据库 URL 必须一致，明确的 verified 进程环境优先，不能静默加载 A shell 配置。
- verified 控制台沿用恢复用限制路由，只开放该既有 HTTP 派发入口；移除旧 B 的 Worker 注入，改走普通 T06 dispatcher。其余本机工具503保持原边界。它不是生产切换或D应用服务。

## red / green 和真实运行

HTTP 旧状态在新服务返回 unknown（`http-state-red.txt`）；旧提交只返回 started（`http-submit-red.txt`）；旧 Episode 不扫描已有任务，单任务 CLI 不接受参数（`unified-entry-red.txt`）。逐片修复后针对性 HTTP/CLI 测试通过。跨站 Origin 也先 red 再 green。

真实演练见 [real-path.json](real-path.json)，命令 `node scripts/isolation/queue-entry.mjs --verified`：

- 最终 verified API55461/DB55462/console55176，真实 Owner 登录、普通 middleware、统一模块、真实预构建 Worker CLI、FFmpeg、结果事务与磁盘产物。
- 同组容量被合成 holder 占用时，末次HTTP约271ms返回可查询排队，独立 Worker 空领取后任务仍ready、attempt0、0条run。holder仅用既有fenced结果API释放，不执行媒体或调用Provider。
- 5次重复HTTP提交与真实全局定时CLI同时运行；先在定时器启动前观察HTTP的claim等待，再启动真实全局定时CLI并观察至少两个claim事务并发等待（排除定时器自身两个消费者的假阳性），释放后仅1条attempt0 completed、1件产物。重复完成提交返回200，不重跑。
- Episode范围CLI在planner无新任务时仍消费已有任务，亦仅1次完成。两件真实MP4均23297字节、SHA-256一致，冻结的executor/media/output/input_artifacts未变，产物关联当前Episode。
- 实际停止并重新启动身份匹配的55176隔离控制台后，GET仍返回completed/succeeded。旧A/B任务全程由独立事务行锁保护，演练前后全部旧任务逐字节一致，未删除历史fixture；没有在线Provider调用。

## 验证进度与边界

类型检查、Worker/orchestrator构建、4个受影响隔离脚本语法和两轴审查已通过；完整SQL21文件/224条断言通过（[sql-final.json](sql-final.json)）。只读边界复核见 [boundaries.json](boundaries.json)：A源数据/安全指纹一致，生产PID/Git保持，全部测试listener为loopback。

完整应用首轮默认并发2文件12项失败；两文件maxWorkers=2复核剩2项超时；完整集合单worker剩审核台1项默认5000ms超时（69文件/673项通过）。未修改这些UI测试/组件或原断言。完整原始日志保留/tmp，版本化摘要见 [application-red-history.json](application-red-history.json)。末次在相同完整集合、单worker、显式运行器默认15000ms预算下 **70文件/674项全部通过**；Node **2通过/1项本机n8n节点检查跳过**，进程退出码均0，见 [tests-final.txt](tests-final.txt)。不称原默认5秒预算全绿，也不从测试预算推导产品性能。测试集合将旧Map/源码字符串检查替换为HTTP/CLI行为检查，数量不等同B的675项。

类型/构建完整输出见 [types-builds.txt](types-builds.txt)。最终代码后的真实演练再次通过（先HTTP等待再启动定时器），见real-path.json；本次仅新增fixture，未改生产或覆盖旧证据。

本轮浏览器复查未完成：现有Chrome未开放CDP9222，CUA inventory报native pipe启动失败；本票没有UI代码变化，真实HTTP/DB/文件链已验证，不冒称本轮浏览器验收。

T07全机容量、公平/持续消费，T08完整预构建与五秒唤醒目标，T09通知，T10读取优化，T11复用与D本地化都未实施。每轮仍构建一次Worker，无常驻调度/五秒保证；n8n既有定时入口继续提供丢失唤醒的后续扫描。未测完整Owner审批链或在线Provider；DB fencing不取消已发出请求，也不提供同UID文件沙箱。

新red日志为尾空白规范化后的复制摘录，/tmp完整原始输出未修改；B原日志均保留。总体规格/backlog及T04/T05未跟踪票单仅在本地同步状态，仍未跟踪；提交仅收T06、票单索引及必要B交接更新，不混入其余旧规划。

## 交付状态

T06实现、必要状态同步、真实验证、完整应用/SQL与两轴审查完成。当前分支本地提交以包含本报告的提交记录为准；不推送、不合并、不关闭Issue。完成T06后停止，T07/D不开始。
