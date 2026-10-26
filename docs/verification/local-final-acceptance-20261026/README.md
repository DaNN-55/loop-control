# 本地化迁移与新视频最终验收（2026-10-26）

## 最新进度（新视频完成，历史接入待最小修复授权）

本次新生产单 7ac796f5-ca57-4fbe-8e7c-fbcf87db3dbc 已通过原界面完成三镜头脚本、视觉与分镜审核、新素材/配音、字幕对齐、同步确认、Studio、整期审核渲染、Owner QC、最终成片和本地发布包。最终片 57.749333 秒，1080×1920、30 fps，117,898,661 字节；完整解码、工程引用/文件指纹和实际浏览器从头至尾播放通过。原始第二段自动对齐 needs_review 结果保留，Owner 确认后经人工时序接续；第三段河谷素材偏差及现有清晰度已获本次明确接受。未将这些取舍写成自动全部通过。

发布包为清单及四项引用文件，合计 118,141,989 字节。在独立目录复制这五件文件后，正常校验器验证通过，无本机绝对/临时路径或凭据字段。结论只覆盖发布素材，不包括整个 Studio/应用可移植性。详见 [接续05](continuation-05.md)、[最终文件校验](run02-final-render-check.json)、[发布素材可移植性](run02-publish-portability-check.json)。

本轮 Provider 11/11 请求，预留 ¥0.46，实际账单未知；Codex 两个逻辑规划任务，底层 HTTP 次数与实付未知。后续均本地执行，无新增 Provider 或模型任务。四家旧豁免仍为豁免。主程序与本次最终视频保持可查看。

新视频完成后的完整备份，已在本次专用容器新建无 Worker 的恢复库 loop_t24_restore_finalrun02_20261026 实际恢复：51 表、29,530 行、1,085 文件，859 媒体引用通过。首次备份因本次 Studio 编辑占用心跳变化被拒绝，失败副本保留；关闭自有 Studio 标签后第二份备份成功，未弱化检查。

**总体最终验收尚未结束。** 原项目只读核查为 3 个账号、11 单：10 单已归档，日照金山样片 1 单仍为未归档 qc_review。两遍只读导出的 34 表、3,640 行逐表 SHA 一致；337 个独立引用媒体约 2.47 GB，大小/SHA 全匹配。历史接入尚未实施，等待尾斜杠路径兼容与两张旧费用表（17 行）的合并最小修复授权；不会静默遗漏账本、修改原归档状态、恢复历史任务或扩大 Provider 范围。约 22.75 GB 未引用原目录内容仍保留原盘，本次不宣称原项目全量媒体迁移。方案见 [历史接入范围](history-integration-plan.md)。

生产后正常重启仍待验证。日常 Keychain 自动解锁此前失败，最后只读状态再次为锁定；该限制没有因新视频完成而关闭。原项目全量迁移与 Supabase/n8n 清理条件仍不满足。待完成剩余核查后，按 Owner 指定 tech-doc-style-chinese 技能统一整理最终报告；下方初始配置与历史失败证据保留为当时事实。

## 授权前核查结论（历史，保留失败证据）

**验收未通过，停在新生产单创建前。** 本次已现场验证日常原界面、本地 API、独立 PostgreSQL、刷新/正常重启、当前构建、媒体引用和最新日常备份的真实恢复。普通生产账号的新建请求被 HTTP 409 拦截，未产生新 Episode、任务或外部调用；没有本次最终视频或发布包。下游未执行，不能以旧视频、旧测试或历史 Owner 批准替代。

**原项目全量数据迁移不能判定完成。** 当前日常库实际来源是验收库 `loop_t24_restore_ttsproduction20261026_02` 的备份，并非已证明覆盖原项目全部数据的生产快照。日常独立运行的代码边界已建立，但本次真实多镜头生产、人工审核、最终成片/QC/发布包与生产后重启仍待执行。

本次范围：当前 worktree、当前日常配置；未修改业务源码、日常连接/预算或已有业务数据；未提交、推送、合并、发布；未启动、停止或删除 Supabase/n8n。仅正常重启本次应用，并在本次专用 PostgreSQL 容器内新增独立备份恢复目标。历史四家 Provider 豁免仍为豁免。

## 1. 目录、源码和实际构建

| 项目 | 本次事实 | 证据 |
| --- | --- | --- |
| 工作目录 | `/Users/dan/.codex/worktrees/local-first-optimization/loop-control` | `initial.json.cwd`；运行 PID 的 cwd 另见 `runtime-process.json` |
| 分支 / HEAD | `codex/ad-closeout-implementation` / `40489c17aedca7a8c177dd40b3b72cae8fc2f782` | `initial.json`、`final.json` |
| 未提交状态 | 开始时已有多项修改和未跟踪材料；完整逐文件清单保存，不暂存、不覆盖 | `initial.json.gitStatus`；首次终端清单与当前证据目录分开识别 |
| 开始时构建 | **失败**：`src/App.tsx` 与 Worker manifest 中的源码 SHA 不同；不是远端服务故障 | `runtime-manifest-before.json`、`initial.json.runtime` |
| 当前构建 | 正常 stop → `npm run build` → start 后指纹匹配；没有为此修改源码 | `stop.log`、`build.log`、`start.log`、`restarted.json`、`readiness.json` |
| 实际前端 | 日常 Vite 直接服务当前 `src/local-app/main.tsx`；生产构建是另行检查的当前产物 | `browser-check.json`、`scripts/runtime/vite.config.mjs` |
| 构建边界 | 本次构建图 1,864 模块；无 Supabase SDK、旧 App 或旧控制面模块 | `readiness.json.frontendGraph`；边界代码 `src/local-app/frontendBoundary.ts` |

本次保存 279 个源码/运行脚本及配置文件的 SHA 基线。未重新运行历史 937 项回归，不把旧测试称为本次通过。构建存在 bundle 大小提示，不影响此次构建完成。

## 2. 初始实际配置清单

以下均来自当前私有部署文件、数据库或进程实查。秘密仅记录是否配置；路径中的 `R` 指当前 worktree 下的 `.loop-control/local`，`M` 指 `R/volume/media`。

| 配置 | 实际值及当前状态 | 来源文件 / 记录 | 本次验证方式 |
| --- | --- | --- | --- |
| 主程序 / 启停 | `http://127.0.0.1:5174/`；`npm start` / `npm stop`；重启前 PID 50926，重启后 PID 53086 | `package.json`、`scripts/start.mjs`、`scripts/runtime/start.mjs`、`R/app.json` | 身份、cwd、监听端口；正常启停日志 |
| 本地 API / 前端入口 | 同源 `http://127.0.0.1:5174/api/local/*`；`VITE_LOOP_BACKEND=local`；不读取 `.env*` | `scripts/runtime/vite.config.mjs`、`src/local-app/client.ts` | Chrome 实际请求、API 200 / 新建 409、当前模块图 |
| PostgreSQL | 17.6；`127.0.0.1:54329`；数据库 `loop_control`；应用角色 `loop_app`，Worker 角色 `loop_worker`，两者密码均已配置 | `R/deployment.json`、`scripts/runtime/environment.mjs` | 真实 SQL 身份、版本、连接绑定与角色校验 |
| 容器 / 数据卷 | Colima profile `loop-control`；`loop-control-local-postgres`；卷 `loop-control-local-data`；容器内 `/var/lib/postgresql/data` | Docker inspect、`R/deployment.json` | inspect 证实 volume 挂载与固定镜像 SHA；**不是 SQLite 文件** |
| 宿主机持久化 | 卷在专用 VM 内 `/var/lib/docker/volumes/loop-control-local-data/_data`；宿主机 VM 磁盘 `/Users/dan/.colima/_lima/colima-loop-control/disk` | Docker inspect、宿主机 realpath | 实查；宿主机文件不是可直接当 PGDATA 使用的目录 |
| 本地身份 / 会话 | PostgreSQL `local_identity.owners/credentials/sessions`；scrypt-v1 密码摘要；64 hex 随机会话，DB 仅存 SHA-256；12 小时；HttpOnly、SameSite=Strict Cookie；变更需精确 Origin 和 CSRF | `src/local-app/password.ts`、`sessions.ts`、`ownerTransaction.ts`、`localRoute.ts` | 原界面真实登录，刷新及服务重启后会话仍可读；未输出 Cookie/摘要 |
| Owner 初始化材料 | `R/owner-login-private.json`；此文件含首次登录材料，不随以后改密自动更新 | 日常运行说明、实际文件 | 仅本地读取用于 UI 登录；未输出密码 |
| Provider 凭据 | 独立 `R/keychain/loop-control.keychain-db`；解锁密码在私有文件；应用 API 与 Worker 使用同一 Keychain 配置 | `R/deployment.json`、`src/local-app/keychainStore.ts` | helper SHA 与归属/路径通过；Keychain 已解锁，但文件为 **0644**，应用校验拒绝；两条所需引用直接查询均 `missing` |
| 媒体 / 过程产物 | `M`；按账号目录下 `episodes/<id>/...`；`R/media.sparseimage` 挂载到 `R/volume` | `R/deployment.json`、媒体映射与恢复回执 | 975 个文件与最新备份匹配；812 条实际媒体引用大小/SHA 校验通过 |
| 临时文件 | Codex 使用 Node `tmpdir()` 下 `loop-content-*`，任务 finally 清理；其他中间产物留 Episode/任务目录；`TMPDIR` 继承启动环境，配置没有固定独立临时根 | `scripts/runtime/codex.mjs`、本地 Worker 代码 | 静态核查；本次未运行 Codex/渲染，未伪称核实了本次模型临时目录 |
| 日志 / 状态 | `R/app-private.log`、`R/state/*`、`R/app.json`；任务/尝试/审核在本地数据库 | `scripts/runtime/start.mjs`、`nativeAutomation.ts` | 进程记录、状态 API、DB 基线；原始私有日志不转公开 |
| 模型 / Python | `R/python/venv`；缓存 `M/whisperx-models`；`scripts/runtime/offline-python` 强制 HF/Transformers 离线并用 macOS sandbox 拒绝网络 | 部署文件、offline-python | 缓存作为媒体备份逐文件核验；本次未跑声学对齐 |
| Studio | 日常副本 `R/OpenChatCut`；配置 `127.0.0.1:5175`，按生产单打开；本次未启动 Studio | 部署文件、`studioCommands.ts` | 5175 未监听；没有新生产单可载入，不冒称 Studio 已运行 |
| 完整备份 | `R/backups/loop_control/<job-id>`；最新已有备份 `93b82876-03a4-4dc8-8478-4db57fbd48b4` | 备份 manifest、`scripts/runtime/backup.mjs` | 完整校验后在新库实际恢复成功，见第 5 节 |
| 最终发布包 | 一般为账号 Episode 目录下 `publish-package`；本次无生产单，因此实际输出路径 **尚未产生** | `src/local-app/deliveryCommands.ts`、发布包 Worker | 未执行，未借用旧发布包 |
| Worker / 并发 | 应用内持久 scheduler + 按任务子进程；进程并发 1；DB 全机 capacity 2，领取取更小值并受 Provider/Adapter/连接资源限额约束 | 部署 `worker.concurrency`、`worker_scheduler_settings`、`localWorkerService.ts` | 当前 DB 定义导出至 `database-functions.sql`；本次空闲调度通过，未跑满载生产 |
| 重试 / 恢复 | 持久 attempt/max_attempts/available_at；租约 30 分钟，续租和结果有 task/attempt/token 围栏；调度每 4 秒扫描；规划蓝图 max_attempts=1；没有盲目在线重试 | DB 实际函数、`workerScheduler.ts` | 本次证明重启不重放已完成任务；未对新任务做杀进程恢复实验 |
| 定时 / 提醒 / 健康 / 备份 | 都由主应用负责；上海时间每日 09:00 健康/完整备份；自动化每 4 秒扫描；桌面提醒由 osascript | `scripts/local/application.mjs`、`nativeAutomation.ts` | 当前运维计划/API/调度实查；6 条历史提醒结果未知，17 条未来完成记录污染状态页，不能统称正常 |
| 外部 Provider | 登记有 Pexels、豆包、Google TTS、Freesound、Cloudflare、OpenAI；网络策略 `enabled=false`、maxRequests=0、金额上限 0、providers=[]；实际 used=0 | `R/state/provider-network/{policy,state}.json` | 前/后账本一致；本次未在线验证任何一家 |
| 模型 / 音色 | 生产账号蓝图 v1：规划 `codex/gpt-6.1-sol`；B-roll `pexels-video-v1`；TTS `seed-tts-2.0`、`zh_female_vv_uranus_bigtts`、zh-CN、rate 1 | 本地蓝图 `a467cbba-de5a-404d-8d64-34d0406bf3f6` | DB 读回；仅是当前配置，凭据/资格未就绪，不代表可调用 |
| Codex 授权 / 费用 | 本机 Codex CLI 0.164.0，登录方式 ChatGPT；调用由 Owner 操作触发。`actualCostCents=0` 是写回配置，不是实际账单；Provider 网络策略不覆盖 Codex CLI | `scripts/runtime/codex.mjs`、部署文件 | 本机 `codex login status`；本次未运行模型，不能据登录推断新预算授权 |
| 画幅 / 分辨率 / 帧率 / 字幕 | 新生产未创建，未冻结本次参数。代码默认 9:16、1080×1920、30 fps、字幕开启/cinematic/lower_third；**这是代码默认，不是本次生效输出** | `src/reviews/reviewComposition.ts`、`worker/durationDecision.ts` | 只读代码；预案明确采用这些值，仍须正常界面冻结并读回 |
| 素材 / 配音质量 | 当前账号 B-roll 外部、旁白外部，A-roll/配乐人工；既有质量取舍保留。本次拟取 3 个新视频，不沿用旧成片。当前 Pexels 文件选择没有充分的最低高清保证 | 蓝图、`src/worker/mediaProviders.ts` | 未获取新素材，因此清晰度、语速、音量和字幕可见性未验证 |

## 3. 本地化完整性分层判断

| 项目 | 代码已实现 | 当前配置已启用 | 本次实际运行证据 / 结论 |
| --- | --- | --- | --- |
| 业务数据 / 本地 API | 是：pg 连接本地；Owner 事务和本地路由；旧 Supabase 调用在原生版本 fail closed | 是，应用与 Worker 同库 | 登录/目录/会话/连接/系统状态/新建拦截经同源 HTTP；真实生产的每条读写路径未跑全，不能称全部路径都验过 |
| 身份 / 权限 / 产物访问 | 是：本地身份、RLS/Owner 事务、精确来源、CSRF、归属与文件指纹校验 | 本地身份启用；Provider 秘密能力不可用 | 原界面登录和重启会话通过；本次无新产物访问可验；Keychain 权限/引用阻塞 |
| 即时 / 定时 / 领取 / 并发 / 重试 / 审核 | 是，本地 SQL + Node scheduler/Worker；审核命令经本地 API | scheduler/运维启用；网络生产关闭 | 重启后真实空闲扫描成功，5,533 条任务不变；新任务执行、竞争、租约恢复及人工审批链未执行 |
| 持久化 | 数据库卷、媒体 sparseimage、Keychain、备份均有本地位置 | 是 | 应用正常重启后业务表和任务摘要相同，媒体/备份恢复通过；凭据当前缺失，不能宣称“凭据重启恢复”通过 |
| 原项目全量迁移 | 有备份/恢复/校验实现 | 当前恢复的是验收库 | **未证明**；缺少原生产源清单、切换时点、全表/全媒体覆盖与双边对账，见第 5 节 |
| Supabase/n8n 运行依赖 | 日常入口不加载旧环境；本地原生模块不需要它们 | 当前日常进程没有启动/调用它们 | 本次当前构建、进程连接及本地操作验证独立；未完成新视频，完整生产独立性仍未验收 |
| 构建/历史代码 | Supabase CLI/SDK 仍列 devDependencies，历史目录与 legacy 入口保留 | 日常 `envFile:false`、local backend；原生图拒绝 SDK/旧控制面 | **运行不依赖 ≠ 仓库/构建环境没有历史依赖**。本次构建仍使用已有 node_modules；未验证干净机器安装 |
| 浏览器外访 | 同源本地 API；没有直连 Supabase 的原生代码入口 | 本次 Chrome 所见资源 origin 仅 127.0.0.1:5174 | `browser-check.json`；只覆盖本次观察窗口，不代表后端没有外访 |
| API/Worker 外访 | Pexels/TTS 走签名策略与持久账本；Codex CLI 是独立外部路径；本地对齐拒绝网络 | Provider 关闭；新建在预检失败，无 Worker 子任务 | 账本 0；API 进程 TCP 快照只有本地浏览器/PG。**没有本次生产期 Worker 流量可验，也没有全进程连续抓包**，不宣称全系统零外访 |

证据代码：`src/local-app/catalog.ts`、`localRoute.ts`、`sessions.ts`、`artifactRoute.ts`、`connections.ts`、`workerDatabase.ts`、`localWorkerService.ts`、`nativeAutomation.ts`、`src/orchestration/workerScheduler.ts`、`scripts/runtime/environment.mjs`、`vite.config.mjs`、`src/local-app/frontendBoundary.ts`、`retiredRemoteClient.ts`。`LOOP_N8N_STATE_DIR` 在日常显式绑定本地 state，仅是沿用的变量名，不等于启动 n8n。

## 4. 本次实际步骤与新视频执行状态

时间为上海时间。没有任务的步骤明确标记无任务 ID，不能用命令进程 PID 代替业务任务 ID。

| 步骤 / 输入与版本 | 执行器、时间与耗时 | 结果 / 数据与文件 / 外部调用 | 状态与证据 |
| --- | --- | --- | --- |
| 初始源码/运行/DB/预算基线，当前 HEAD 与未提交源码 | Node + 只读 SQL；12:57:33 开始；完整耗时未单独记录 | `initial.json`；发现 1 个源码指纹差异、预算 0；无业务任务 ID | 已执行；原始失败保留 |
| 正常停应用 → 当前 build → 正常启动 | npm/Node/Vite；12:58 左右；Vite 打包 1.02 秒，整个启停耗时未单独记录 | 原 PID 50926 → 53086；源码未修改；无外部 Provider 调用 | 已执行；三份启停/构建日志 |
| 刷新与当前会话/业务表/任务读回 | Chrome、本地 API、SQL；12:58:36 起 | 会话仍有效；所有 5,533 任务行、业务摘要相同；无新增尝试 | 已执行；`restarted.json`、`readiness.json`、`browser-check.json` |
| 975 文件备份完整性 / 当前引用 / 导入媒体核验 | 现有 readNativeBackup + verifyRestoredReferences；12:58:26 起；6,717 ms | 975/975 大小/SHA 匹配，812 引用匹配，原始 974 导入文件未变 | 已执行；`storage-check.json` |
| 日常生产账号 v1 原界面新建：全新三镜头题目，不关联系列 | Chrome → `POST /api/local/episode-commands`；13:00:01.991；34 ms | **HTTP 409**；生产前检查失败，未创建 Episode/任务/文件，未发 Provider 请求 | **失败/阻塞**；`browser-check.json`、`new-production-blocked.png` |
| 最新日常备份在新库真实恢复 | 当前专用 PG 容器 + 同一 restoreNativeBackup 实现，注入显式日常恢复上下文；13:01:37.190 → 13:01:55.805；18,615 ms | 新库与独立媒体；51 表/29,099 行/975 文件及权限/外键/序列/引用校验通过；不接入 Worker | 已执行；`restore-check.json`；不是借用 stage 服务运行生产 |
| 本次脚本/镜头规划 | 已准备新脚本草案，3 段 277 个正文字符；预案 3×22 秒；尚未导入/冻结 | `script-proposal.txt`、`shot-plan-proposal.json`；没有模型任务 ID | **未执行生产步骤**；不是模型规划成功证据 |
| 素材获取/生成 | 拟 Pexels 新获取 3 个视频；规划后以真实素材时长/清晰度验真 | 无任务、无新素材、无调用 | **未执行**，等待网络及凭据授权 |
| 配音 | 拟豆包 3 段指定音色，rate 1；实际时长待测 | 无任务、音轨与调用 | **未执行** |
| 对齐/字幕 | 拟本地离线 WhisperX；逐镜头正文确认与同步预览 | 无任务、字幕、预览 | **未执行** |
| 镜头准备 | 拟确认新素材/音轨/字幕的关联、时长及准备状态 | 无新镜头产物 | **未执行** |
| Studio/剪辑 → 审核/修改 | 拟原界面和日常 Studio；尊重视觉/分镜/成员/QC 的 Owner 边界 | 无本次工程/时间线/审核记录；未代替 Owner 批准 | **未执行** |
| 渲染 → QC → 最终片 → 发布包 | 拟当前本地 Worker/OpenChatCut/FFmpeg | 无本次视频、QC、SHA 清单或发布包 | **未执行**，不能播放/听取/抽帧/解码，也未验证便携性 |
| 完成生产后的重启/去重 | 必须等本次新生产完成后再验证 | 当前已证明旧数据/任务重启保留，尚无本次已完成任务可比较 | **未执行生产后验收** |

本次失败/干预：初始构建指纹失败 1 项，经正常构建/重启恢复；新建生产单失败 1 次，无重试；验收脚本初版使用了不存在的 `native_task_enabled` 函数名，查询报错后改为实际存在的 `input_task_allowed`，仅修改本次核查脚本，未改产品或数据库函数。没有手工补业务数据、替换媒体、绕过审核或回填成功状态。

## 5. 数据迁移与备份恢复

| 范围 | 实际证据 | 本次能得出的结论 |
| --- | --- | --- |
| 日常恢复直接来源 | `restore_record.source_database=loop_t24_restore_ttsproduction20261026_02`；快照 `2026-10-26T03:40:54.224Z`（上海 11:40:54）；archive SHA `d8b1b8d1e71f5d749b6893009cfe50fe6e7d36231ef588a432d4fdc3b6d6b308` | 是验收库快照；不是原生产全量迁移证明 |
| 初次恢复范围 | 51 表、29,060 行、974 文件、811 媒体引用；既有回执说明 Owner 凭据/会话清空、资格清零、冻结业务行未改写 | 这份历史恢复回执本次已读取；原始 974 文件本次重新 SHA 校验通过；历史行/权限校验不改写成本次执行 |
| 更早迁移链 | `import_record` 保留 stage-b/verified 来源，源时间 `2026-10-23T16:42:53.747Z`；当前保留多个历史媒体逻辑根并映射到日常副本 | 不能把这些 stage 来源合并称为“原项目全部生产数据” |
| 最新日常备份 | `93b82876-03a4-4dc8-8478-4db57fbd48b4`，创建 `2026-10-26T04:47:23.974Z`；51 表、29,099 行、975 文件，812 引用；archive SHA `f088e9d70e41ea30c95421ef1d481240b0af23f60ee42b500965287eb672428f` | 本次完整性核验通过 |
| 本次新恢复目标 | 同一专用容器中的 `loop_t24_restore_dailyfinal20261026`；`R/restore-check-20261026/media`；新归档副本 `R/imports/daily-final-f088e9d70e41ea30c95421ef1d481240b0af23f60ee42b500965287eb672428f` | 本次真实恢复通过；当前 `loop_control` 没有被替换/重置，没有接入恢复库 Worker |
| 关联/安全/序列 | 恢复实现逐表 COPY SHA、权限清单、序列值及 is_called、所有外键孤儿检查、975 文件、812 引用校验；证据见 `restore-check.json.receipt` | 本次成功恢复的是最新日常备份限定的范围 |
| 明确排除 | Owner 密码摘要、会话/Token、Keychain 值、宿主 DB 密码、系统卷元数据 | 完整业务备份不包含可直接登录/调用的秘密；恢复后必须重新初始化 Owner 并重绑 Provider，不承诺秘密自动恢复 |
| 原项目未证明范围 | 缺少原生产快照标识、全部源表/记录清单、全部媒体清单及截止时点、源/目标逐项对账、遗漏与切换账本 | **原项目全量迁移未验收完成**；只读取得原生产清单与批准的快照，再做覆盖/遗漏对账，不应先清理旧服务 |

恢复目标与证据保留，不连接日常主程序，不删除任何旧库/备份/媒体。

## 6. 对外数据、预算与待确认的最小生产方案

### 已发生的访问

本次业务 Provider 调用 **0**，Codex 内容 Worker 调用 **0**，Provider 重试 **0**，费用预留 **0**。新建失败发生在本地事务预检内。浏览器只观察到同源本地资源/API；主 API 进程 TCP 快照只有本地浏览器和 PG。只读查阅了官方价格文档，这些网页访问不属于视频生产 Provider 调用。实际 Provider 账单未查询；本次没有新生产调用可计费，不能把旧预算或部署的 actualCostCents=0 当成历史实付证明。

### 新生产预案（未授权、未冻结）

主题「从森林到山谷：跟着水流看自然」；已有生产账号「普通长度三镜头端到端验收」v1，蓝图 ID `a467cbba-de5a-404d-8d64-34d0406bf3f6`，创建时由系统冻结新 Episode 快照；不关联旧系列。新脚本见 `script-proposal.txt`，3 段分别 90/91/96 字符，合计 277 个正文字符；3 个镜头预期约 66 秒，实际以配音/素材与正常审核结果为准，必须满足 45～90 秒。

拟新取森林、河流、山谷三段 Pexels 视频；不使用图片生成、配乐、音效或其他四家 Provider。指定豆包 `seed-tts-2.0` / `zh_female_vv_uranus_bigtts` / zh-CN / rate 1。字幕使用本地对齐和逐镜头确认；拟 9:16、1080×1920、30 fps、cinematic/lower_third、fade。代码默认不等于实际冻结值；真正开始时须在生产单读回，检查新素材大小、源分辨率和音轨时长。

| 待授权调用 | 预计数量 / 硬范围 | 目标与发送数据 | 预算与停止边界 |
| --- | --- | --- | --- |
| Codex 内容规划 | 2 次：视觉规划 1、分镜规划 1；每任务 max_attempts=1 | 由本机已登录 CLI 调用；发送冻结 task package、脚本/提示词、账号/蓝图/任务标识、路径和 SHA；CLI 可读取并提交允许素材根内为任务读取的内容。不是纯本地模型推理 | 使用当前 ChatGPT 登录额度，不切 API Key、不购买额外额度；金额/实际扣费不可由本地 CLI 查得。Provider 的网络金额上限**不约束 Codex CLI**，只能按两次任务限制；失败即停 |
| Pexels 资格 | 1 次 | `api.pexels.com`；Authorization、固定 nature 查询 | 免费内容/API，受自身配额限制 |
| Pexels 素材 | 3 次搜索 + 3 次下载 | `api.pexels.com` 与允许的 Pexels 视频 CDN；英文检索词、方向/数量参数、选中视频 ID；不上传本地媒体 | 6 次，不自动翻页/补采/重试；源质量不够则保留结果并停，不静默伪称高清 |
| 豆包资格 | 1 次 | `openspeech.bytedance.com`；认证头、指定资源/音色、短验证句 | 也可能计费，纳入新账本 |
| 豆包配音 | 3 次 | 同上；逐镜头完整旁白、音色/语速/音频格式及请求标识 | 3 次；277 字符正文+不超过 10 字符验证句，公开标价估计约 ¥0.0861；不是实付 |
| 对齐/预览/Studio/渲染/QC/发布包 | 本地任务，不使用新的外部 Provider | WhisperX 离线缓存，FFmpeg/OpenChatCut 和本地数据库/媒体 | 没有新增 Provider 费用预算；仍需实际运行与人工审核 |

合计 **2 次 Codex 任务 + 11 次 Provider HTTP 请求**。建议新建本次独立授权账本：仅 Pexels/豆包、硬上限 11 请求、费用预留总上限 **¥1 CNY**；不复用任何旧账本，不自动增加请求。官方按量价格的网页检索结果为豆包 TTS 2.0 ¥3/万字符，账户实际计费/资源包未知；参考 [豆包计费说明](https://docs.volcengine.com/docs/DoubaoVoice/Billinginstructions-21?lang=zh)。Pexels 免费范围参考[官方 API 文档](https://www.pexels.com/api/documentation/)。估价仅用于新授权，不代表已有授权或实际支出。

最小处理范围：修正日常 Keychain 文件为私有权限，并验证正常启停后仍符合校验；仅从本 worktree 中此前明确配置的 Pexels/豆包材料重绑到日常专用 Keychain，不读取其他项目凭据、不显示秘密。若本树不能安全取得这两项材料，应通过原界面录入，不能在聊天中索要明文。再为本次批准的操作建立独立新策略并同步绑定 application/media/narration；保留关闭的初始策略和全部历史账本。需要源码修复时先限定文件/最小变更，不能把未知权限绕过写成修复。

授权调用不等于内容审批。视觉、分镜、逐镜头确认、QC 中要求 Owner 的判断，必须展示本次实际内容后等待，不沿用历史 Agent 测试 Owner 的批准授权。

## 7. 剩余问题与清理条件

| 类别 | 问题 | 最小方案 / 取舍 |
| --- | --- | --- |
| 已恢复的环境问题 | 初始源码/构建指纹失效，scheduler 报错 | 已通过正常 build/start 恢复，当前真实健康/空闲扫描通过，保留初始红证据 |
| 生产阻塞 | 闭网、额度 0、两个所需秘密缺失、Keychain 0644、不具备当前资格 | 获得第 6 节新授权后，只处理本次日常 Keychain、重绑/验证与专用新账本；不解除审核、不重置旧预算 |
| 最终验收阻塞 | 没有新的生产单、视频、QC 或发布包 | 获准后原界面重新新建并记录全部任务/产物；播放、听音、字幕/时长/指纹/可移植性与生产后重启全部保留为待验 |
| 迁移验收缺口 | 当前仅验收数据快照，原项目全量范围无对账证据 | 先取得批准的原生产源清单/快照并比对，不擅自导入或修改原项目 |
| 日常可观测性错误 | 系统状态聚合恢复的历史 future 记录：健康/备份显示 2026-11-01 成功，本次实际为 10-26；本次查得未来完成记录 17 条 | 按当前部署/恢复世代区分运维结果或为导入记录保留来源标记，不删除历史记录；本次使用实时健康与真实备份恢复独立判断，未修源码 |
| 日常提醒未完成 | 6 条历史提醒 in-flight/unknown | 核对具体历史事件与实际投递；保留未知，不自动重发或强写 delivered |
| UI 错误文案 | 闭网/资格预检失败，却展示“Worker 已执行真实网络探测”；新建页能力摘要未展示两个阻塞的外部能力 | 按结构化 preflight 原因区分策略关闭、缺秘密、未资格与实测网络失败；不声称已探测；本次只报告，不改产品界面 |
| 质量改进 | 素材选择可能低清、字幕遮挡/错位、配音质量要实测 | 沿用已接受的质量取舍，但新素材/成片仍需实际检查；功能缺失、损坏、黑屏/静音不可豁免 |
| 已豁免 | Google TTS、Freesound、Cloudflare、OpenAI | 不新增在线请求，保持“豁免/未通过”，不扩大在线范围 |

**当前不具备 Supabase/n8n 清理条件。** 这里只列清单，不执行：

| 资源类别 | 当前处理结论 |
| --- | --- |
| 日常服务对 Supabase/n8n 的进程依赖 | 本次本地操作无需它们；完整新生产尚未实证，不据此批准删除 |
| 可列为后续清理候选 | 当前项目独占且完成全量迁移、备份恢复、历史取证与所有权确认后的 Supabase/n8n 运行资源；目前没有可直接认定安全删除的已命名实例 |
| 必须保留 | 原生产数据库/媒体/认证与连接材料；本树全部历史快照、迁移、账本、备份、审核、生产产物和失败证据；legacy 源码/脚本在完成替代与引用审查前保留 |
| 本次需保留 | 日常 PG 容器/卷/profile、媒体 sparseimage、Keychain、Studio/Python/模型、现有四份备份、新恢复库/媒体/归档副本及此报告 |
| 共用/归属未核实 | 原项目或其他项目的 Supabase/n8n、Docker/Colima 实例、共享服务、端口、存储；本次未停止/修改，不能清理 |

## 8. 交付入口与证据

- 日常原界面：<http://127.0.0.1:5174/>。本次 Chrome 保留在“新建生产单”的真实阻塞现场；主程序保持运行。
- 本次生产单链接、视频预览、发布包路径：**未产生**。当前页面展示的历史已完成视频均不是本次通过证据。
- 新内容预案：`script-proposal.txt`、`shot-plan-proposal.json`，仅草案，不计生产步骤完成。
- 配置/基线：`initial.json`、`restarted.json`、`final.json`、`runtime-process.json`、`readiness.json`。
- 浏览器/失败现场：`browser-check.json`、`new-production-blocked.png`、`initial-system-status.png`。
- 存储/恢复：`storage-check.json`、`restore-check.json`、`database-functions.sql`。
- Keychain 定位：`keychain-diagnostic.json`，仅权限、指纹与返回码，不含秘密。
- 启停/构建：`stop.log`、`build.log`、`start.log`、`runtime-manifest-before.json`。

本报告是本轮已执行部分及阻塞交付。后续获准后应在这里追加真实新生产证据，保持失败/未执行/豁免/历史通过各自状态，不重写为“全部通过”。
