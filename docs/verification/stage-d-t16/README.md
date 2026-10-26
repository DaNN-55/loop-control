# T16 本地 Episode 输入与视觉准备（2026-10-24）

本地 HTTP、原生 PostgreSQL、真实 Worker CLI 子进程、文件产物与浏览器审批链路已实现。视觉规划执行器使用可控离线程序，仅处理自供的合成脚本和视觉参考；这证明本地执行链路，不能证明在线模型生成质量、其他 Provider 或完整多能力 Worker 已验收。本轮新增 Provider 在线请求为 **0**。

**默认 5 秒门禁历史失败及根因未解决的限制继续保留**，参见 [B/T06 补验](../stage-c-t06-followup/README.md)。本轮兜底/重启实测及回归不能关闭该历史问题。未操作生产，未提交、推送、合并或开始 T17。

Owner 已认可本次受控离线本地验收，并授权将 T16 实现、报告、回归日志和证据索引提交到当前分支。下文及原始证据中的“未提交、无暂存、HEAD 不变”描述验收收尾时点；本次本地归档只纳入 T16 精确范围，排除根 PLAN、无关规划和含凭据的私有证据，不推送、合并或开始 T17。默认部署、在线生成、其他 Provider 和完整多能力 Worker 尚未验收的限制不变；归档提交 ID 以本文件 Git 历史为准，验收基线仍为 `aeaf25c`。

## 票单、依赖和范围

只读核对 [#122](https://github.com/DaNN-55/loop-control/issues/122) 与依赖 T08/#114、T14/#120、T15/#121 的正文和已有本地验收；Issue 的 OPEN 状态与本地实现/验收状态分别记录。本次对应三项验收标准：冻结创建输入与现有预检约束；本地领取、执行、进度和结果；本地脚本确认、视觉审批与刷新，以及受影响操作清单。没有把后续分镜、配音、素材生成或交付接入本地执行。

- 工作树 `/Users/dan/.codex/worktrees/local-first-optimization/loop-control`，分支 `codex/local-first-stage-a`，基线 `aeaf25c25a229573b35c5a3a7daa9bb62c10c918`。
- 沿用 D 原生 PG 容器 `loop-control-stage-d-postgres`、固定镜像/标签、55472、`loop_imported` 与 `loop_empty`。HTTP 使用 `loop_app`，Worker 使用独立 `loop_worker` 最小权限登录；凭据仅保存在私有配置，子进程经 stdin 接收 Worker 配置，执行器不接收数据库凭据。
- 独立验收端口 `127.0.0.1:55179`，同一业务 handler/SQL/CLI，目录只展示本轮账号真实记录。专用 512MB APFS 稀疏映像挂载于 `.loop-control/stage-d/media/t16-volume`，没有放宽真实挂载点、路径、文件摘要等约束。
- 默认 D 启动仅在私有 `native-worker.json` 显式配置时启用输入 Worker；没有安装离线验收执行器到默认服务。默认部署、在线视觉生成及生产运行尚未验收。接续者不得把验收驱动当作部署配置。
- T15 Pexels 预算保持 2/2，专用 Keychain 已删除；本轮没有重新录入 Key、重启该在线驱动或读取生产凭据。其他 Provider 尚未验收。

## 受影响业务操作清单

| 操作 | 本次本地接管与边界 | 源码与证据 |
| --- | --- | --- |
| 创建 Episode | Owner 会话/CSRF、账号锁、事务收据；创建时绑定蓝图/系列版本，后续蓝图修改转为快照；仅保留非秘密连接版本 UUID | `src/local-app/episodeCommands.ts`、`db/local/009-episode-input.sql`；[HTTP](http-result.json)、[冻结元数据](freeze-metadata-result.json) |
| 创建/打开素材目录 | 授权媒体根下的 Episode input/materials；真实挂载、符号链接与路径穿越检查；打开目录为本机精确 argv | `src/local-app/localFiles.ts`；[权限边界](boundary-result.json)、[浏览器刷新](browser-final-reload.txt) |
| 上传、目录导入、主脚本确认 | 沿用原统一导入界面和主脚本格式；不可变摘要快照、材料审批入库；确认后的主脚本不可替换；后补普通材料不改已创建任务输入 | `src/reviews/mainScript.ts`、`src/local-app/episodeCommands.ts`；[HTTP](http-result.json)、[浏览器材料](browser-final-materials.txt) |
| 开始制作/预检 | 预构建完整性、真实 Worker DB 身份及规划/领取/回写权限、同库绑定、媒体根、Adapter/模型/预设/Prompt Harness 与连接引用门禁；无已验收图片生成路径时必须自供视觉参考；失败不写阶段/激活 | `src/worker/runtimePreflight.ts`、`src/local-app/workerDatabase.ts`、`src/local-app/episodeCommands.ts`；[就绪检查](worker-readiness-result.json)、[权限边界](boundary-result.json) |
| 规划/领取/租约/重试 | 仅新登记 enabled 的 prepare_visual_brief，不消费或恢复导入旧任务；共享原全机 capacity/资源锁；本地独立持久轮转 sequence 保留原历史计数；提交后唤醒+4秒扫描 | `db/local/009-episode-input.sql`、`010-input-scheduler-turn.sql`、`src/orchestration/workerDispatch.ts`；[生命周期](resilience-result.json) |
| Worker 执行、进度、结果 | 真实 Node CLI 和可控离线子进程；原 task package、Worker runner、输入/输出验证与 fenced 结果事务；进度/v1、结果/v1、预检/v2；真实产物摘要/字节验证 | `src/local-app/localWorkerService.ts`、`localWorkerCli.ts`、`db/local/012-input-worker-fence-call.sql`；[HTTP](http-result.json)、[事件](events.jsonl) |
| 脚本与视觉审批 | 提供的主脚本经原 import_production_material 写 revision approval，start_episode_production 从 waiting_input 到 script_approved；视觉 review package 对应产物校验后经原 transition 保存批准/退回 | `src/local-app/episodeCommands.ts`；[HTTP](http-result.json)、[浏览器审核](browser-final-review.txt)、[刷新截图](browser-final-reload.png) |
| 状态、增量轮询、产物索引与刷新 | 复用 EpisodeProductionView 与增量 reader；可见页面轮询、URL 保存 Episode、cookie 鉴权读产物/材料、hash 验证；退出清理预览缓存 | `src/local-app/LocalEpisodeDetail.tsx`、`LocalCatalogApp.tsx`、`localRoute.ts`、`src/reviews/localArtifactPreview.ts`；[浏览器请求 URL](browser-final-requests.txt) |
| 未接管操作 | 导入的旧 Episode 保持只读；后续修订、标注、分镜及生产审批无云端写入回退，显式报未接管 | `src/local-app/LocalEpisodeDetail.tsx`；T17及以后未开始 |

## 实测与修复

[HTTP](http-result.json) 验证创建4并发→1 Episode、上传3并发→1 revision、开始3并发→1 task、视觉批准2并发→1 decision；蓝图全 policy/系列保持冻结、任务结果完成、产物 cookie GET 字节及 SHA256 一致。新 Worker 预检使用当前 worker-preflight/v2。晚补材料允许，主脚本替换409，任务 input_snapshot 不变。

[边界](boundary-result.json) 覆盖 Owner 越权404、匿名401/CSRF403（HTTP链）、目录链接/穿越、错误主脚本、未知凭据字段、缺预构建程序、文件篡改、旧租约写回拒绝且行不变、Owner 不能领取/Worker 不能审批或走原全局领取。JSON 属性顺序变化仍返回同一幂等结果。

[独立 Worker 就绪](worker-readiness-result.json) 使用同一隔离 DB 的实际错误密码及临时撤销 planner 权限，验证启动与 create/start 拒绝503、预检为 Worker scope，未新增 Episode、阶段/激活不变、没有 wake。临时权限在 finally 恢复；app/worker 连接池各自被定点终止一条本测试 idle backend 后可以重新连接。

[生命周期](resilience-result.json)：抑制内存唤醒后仍由兜底扫描领取（4022.597ms，以开始事务时间到 claimed_at 保守计）；开始后、规划前关闭服务，重启后247.676ms领取；真实运行中关闭 Worker 和规划器进程组，失败 attempt0 回到 ready，重启 attempt1 完成。热路径前后程序摘要、mtime 和预构建 manifest 一致，没有热编译。这些观测不能关闭默认5秒历史门禁问题。

真实 headed Chrome 使用原表单完成新建、系列v1选择、两文件用途标注、主脚本明确确认、开始、展开视觉清单、填写理由并批准；reload 保留 Episode URL、visual_approved 与产物索引，再实际打开本地目录。[审核](browser-final-review.txt)、[刷新](browser-final-reload.txt)、[截图](browser-final-reload.png)。这是本地基础设施实测，规划内容由可控离线程序生成。

原始失败均保留，未通过放宽超时或业务约束来通过：

1. Owner SELECT FOR UPDATE 被最小权限42501拒绝，新增仅用于已拥有 Episode 的锁函数（011），不授予业务表 UPDATE。
2. Worker 包装 SQL 变量 id 歧义42702，新增前向迁移012。保留失败 attempt；仅本轮受影响 task 受控过期、重新领取完成，没有处理导入旧任务。
3. 增量 HTTP 验收驱动曾误当全量 sections 读取，夹具 macOS /var 别名/系列规则字段错误、主脚本初版不符格式；修正夹具/驱动，不放宽校验。
4. 共用 Vite 依赖缓存出现504，改用验收目录独立 cacheDir；未把加载未完成算作通过。
5. 恢复时原 D SSH 隧道记录指向已退出 PID，DB 容器仍正常；确认进程消失和端口未占用后保存旧记录、按原方案只恢复55472隧道，未重启 VM/数据库或其他服务。连接池 idle 错误曾导致未处理事件退出，已增加处理；原 pg 客户端诊断含协议私有字段，只留私有日志。
6. [停机复测失败](resilience-vite-shutdown-failed.txt)暴露 Vite SIGTERM 在 Worker 失败回写前退出。改用 Vite 等待的 closeBundle 清理、幂等 stop 和已取消启动检查；[修正后](episode-input-resilience-verified.txt)原步骤通过。失败尝试仅本轮 task 通过围栏记录后恢复，未隐藏 running 残留。
7. 第一轮全量驱动误给所有测试设置 VITE_LOOP_BACKEND=local，旧后端用例因此失败；移除该测试环境覆盖后，新增动态客户端导入仍令3个原预览用例失败，定向复跑也复现。改为模块初始化时仅为legacy后端选择一次客户端，native仍不初始化旧客户端；[修正后预览回归](preview-fixed.txt)和[最终全量](application-final.txt)通过，未改测试或超时。[原始失败](application-preview-import-failed.txt)保留，受影响的真实Chrome清单读取也[重新复核](browser-preview-fixed.png)。
8. 两轴复查发现旧预检v1、Worker DB readiness 和 planner 权限漏验，均修复并实际故障注入验证。早期v1证据保留，最终以本报告链接的v2记录为准。

## 回归、历史和接续

最终默认5000ms回归94文件、740项通过；Node为2通过、1既有skip。类型、Worker/编排预构建、本地前端构建均退出0。回归见 [命令及退出码](regression-results.json)、[应用](application-final.txt)、[类型](application-types.txt)、[本地类型](local-types.txt)、[Node](node-final.txt)、[前端构建](frontend-build.txt)。不增加测试超时，不将本轮单次通过解释为历史根因已修复。

[原 C 历史](original-history.json)38表20,379行逐条保留；[本轮开始前历史](pre-t16-history.json)38表20,542行逐条保留。新合成账号、Episode、任务和审核记录保留为证据；原调度器计数未被本地输入轮转消费。迁移009–012为原生D本地适配，未改历史 Supabase 迁移或调用云端业务API；未重新运行 Supabase advisor，原3条WARN和既有 Node skip 保留。

[两轴复查](review.md)、[收尾边界](boundaries.json)、[脱敏扫描](credential-scan.json)及[证据索引](evidence-index.json)记录精确范围。根 PLAN 和既有规划文件不纳入本轮，无暂存、无提交。私有运行目录 .loop-control/stage-d/state/t16-20261024 保存原始诊断、数据库快照、临时令牌和挂载映像；凭据配置、原始 pg 日志与 dump 不进入公开目录，不记录秘密指纹，未采集 HAR。首次扫描把私有DB中按契约持久化的围栏令牌也当作密码误报；[分类记录](credential-scan-initial.json)保留，密码扫描与公开文件令牌扫描分别通过，没有为消除扫描结果修改历史数据。

非秘密连接版本冻结另外在 loop_empty 的整事务 ROLLBACK 夹具中验证；夹具仅构造连接元数据和资格以检查原领域契约，未创建秘密/Keychain或调用Provider，不作为真实live资格证明。真实live证据仍仅限此前T15 Pexels代表路径。

本票只能据此认定受控离线范围的本地链路验收；其他 Provider、在线视觉模型和图片生成、完整多能力 Worker CLI、默认部署及 T24 完整恢复仍未验收。默认5秒门禁历史失败与根因未解决继续限制后续判断。接续不得重置T15在线预算，也不得把测试执行器当生产部署。
