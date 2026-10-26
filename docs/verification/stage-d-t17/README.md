# T17 本地分镜规划、审核与修订（2026-10-24）

T17 的本地规划、审核、注释、退回重规划及确定性结构修订已接入原生服务。HTTP、原生 PostgreSQL、真实 Worker CLI 和真实分镜 JSON 文件贯通；浏览器使用原分镜页面操作。规划内容来自可控离线程序，确定性结构修订使用共享的实际本地执行器。本轮没有新增在线请求，不能将这些结果视为在线模型质量或完整生产流水线证明。

**默认 5 秒门禁历史失败及根因未解决的限制继续保留**；本轮回归不能关闭 [B/T06 历史问题](../stage-c-t06-followup/README.md)。**默认部署、在线生成、其他 Provider 和完整多能力 Worker 尚未验收**。未操作生产、提交、推送、合并或开始 T18。

Owner 已认可本次 T17 受控离线本地验收，并授权将实现、报告、回归日志和证据索引提交到当前分支。下文及原始证据中的“未提交、无暂存、HEAD 不变”描述验收收尾时点；本次归档只纳入 T17 精确范围，不纳入根 PLAN、无关规划或含凭据的私有证据。上述全部验收限制及中间通过日志覆盖的说明继续保留，不推送、合并、操作生产或开始 T18。归档提交 ID 以本文件 Git 历史为准，验收基线仍为 `b82546e`。

## 票单、依赖与隔离范围

按用户“不新增在线请求”约束，只核对本地已发布的 [T17/#123 票单](https://github.com/DaNN-55/loop-control/issues/123)和 `github-issues.json` 缓存，不联网刷新 GitHub 状态。依赖 T16 已认可并提交为 `b82546e4006a08f5e8e09010c71431ac9458de9e`。本轮基线即该提交，工作树 `/Users/dan/.codex/worktrees/local-first-optimization/loop-control`，分支 `codex/local-first-stage-a`；根 PLAN 和既有无关规划不改。

沿用 D 固定镜像/标签的原生 PG 容器 `loop-control-stage-d-postgres`、55472、`loop_imported` 与 `loop_empty`，沿用独立 app/Worker 最小角色、现有媒体挂载；只新建挂载下 `t17-account` 和本轮合成业务记录。独立验收服务为 `127.0.0.1:55180`，使用原 handler、Owner session/Origin/CSRF、原领域事务、实际 CLI 和文件系统。执行器由验收服务显式配置；没有创建默认 `native-worker.json`，没有改默认部署。

T15 Pexels 预算仍为2/2、原专用测试 Keychain 已删除；不读取/重录 Key，不启动旧在线驱动。验收服务及子进程沿用强制仅允许本机55472的网络 guard，Chrome只允许本机域名；未采集 HAR、请求秘密或原始响应头。

## 验收标准与实现

| 票单要求 | 本轮实现 | 证据 |
| --- | --- | --- |
| 冻结上下文规划，通过统一服务进入分镜页 | 新增显式 `planStoryboard`，仅已批准视觉清单的 Owner 可启用本 Episode；服务前置检查后提交，常驻 Worker 消费原 `orchestrate_storyboard_tasks_for_episode` 冻结的脚本/视觉产物/系列/Harness/Prompt上下文。复用原分镜页和本地增量查询。 | [HTTP结果](http-result.json)、[浏览器正常分镜](browser-normal.txt) |
| 审核、注释、结构修订和新旧引用语义不变 | 同一命令端点经 Owner 锁、当前审核包及实际文件/JSON复核，调用原 `transition_episode`、`create_storyboard_annotation`、`request_shot_structure_revision`；沿用原触发器/收据/围栏。旧文件、context、审批及注释不覆盖。 | [HTTP结果](http-result.json)、[边界](boundary-result.json)、[浏览器刷新审计](browser-after-reload-audit.json) |
| 正常分镜+受控修订的 HTTP/DB/实际产物 | 正常草案v1、批注与批准；受控5秒时长结构修订；另一样本退回并把反馈/批注冻结进重规划v2。浏览器另做规划、注释、退回v2、批准、修改镜头类型及刷新。所有产物SHA、字节数、文件内容与DB回报一致。 | [HTTP](http-result.json)、[浏览器提交](browser-structure-submit.txt)、[刷新](browser-after-reload.txt) |

本轮源码范围见 [索引](evidence-index.json)：

- `db/local/013-storyboard.sql`：新增默认false的 `storyboard_enabled`。仅新登记且显式启用的 Episode 放行 `draft_storyboard` 和 `draft_storyboard_revision`；规划、领取、恢复和结果回写使用一致allowlist。不自动推进 T16 或导入历史。复用既有全机容量、资源锁、attempt、lease token、退避和本地轮转，不增加云端业务写入或双写。
- `src/local-app/episodeCommands.ts` / `LocalEpisodeDetail.tsx`：接管分镜规划、审批/退回、注释及结构修订。当前审核包UUID、Owner归属、阶段、产物SHA及文件内容均服务端复核；重复命令复用持久收据，失败不唤醒。界面阶段切换后重新初始化视图，同阶段版本更新由原组件保留选择与修订跟踪；T18以后的未接管回调明确报不可用。
- `src/local-app/localWorkerCli.ts`：只扩展上述两类任务，并新增分镜文件与回报JSON的强一致验证。结构修订不调用模型。
- `src/worker/storyboardRevisionExecutor.ts` / `codexWorkerCli.ts`：把旧 CLI 的确定性结构执行器抽出共享，继续使用原操作算法与结果契约，文件写入复用安全路径函数。保留 `worker-result/v1`、`worker-progress/v1`、`worker-preflight/v2`。

## 实测语义与边界

[HTTP结果](http-result.json)：3次相同幂等规划只建1个任务；2次批注/批准/结构修订分别只建1条权威结果。修改当前蓝图和系列后，已有分镜及修订的 Harness、系列、Prompt context仍与冻结版本一致。旧分镜文件逐字节保留，旧context、批注和审批仍可追溯。错误镜头/操作400，旧审核包409。

“要求修改”沿用原流程：在当前storyboard_review保存Owner理由和批注，进入storyboard_draft，由原触发器创建下一版draft_storyboard，冻结 `review_feedback` 和 `review_annotations`，仍须Owner审核。确定性结构修订从已批准分镜提出，原SQL冻结明确操作；Worker应用操作后，原触发器将新版本保留为storyboard_approved并记录原请求Owner的授权。这是原有语义，不是Worker自行审批；Worker无权直接调用Owner命令。

[边界](boundary-result.json)：匿名401、缺CSRF403；跨Owner规划/注释/修订/产物读取404，跨Episode审核包409；篡改本轮产物后审批409且Episode整行未变；Owner不能领取，Worker不能注释或请求结构修订；未显式启用的Episode没有分镜任务。没有生成T18以后的任务。

浏览器使用独立 headed Chrome：本轮准备好的合成视觉输入经真实HTTP批准后，页面点击“规划分镜”，进入原两镜时间轴；填写批注、要求修改并看到v2；批准后无需手动刷新进入工作台，再从“更多操作”提交类型变更。刷新后生产阶段、分镜版本、B-roll类型与产物索引保持。最终源代码另在第二镜执行类型变更，页面仍选中第二镜且URL锚点指向新版审核包的shot-2，未因版本更新丢失原跟踪语义。[最终审计](browser-final-audit.json)、[页面](browser-final-shot2.txt)。浏览器登录使用隔离合成Owner，仅将HTTP状态写证据；正文和操作数据不含Provider秘密。[普通分镜](browser-normal.png)、[批注](browser-annotation.txt)、[v2](browser-rework-v2.txt)、[工作台修复](browser-auto-workbench-fixed.txt)、[结构提交](browser-structure-submit.txt)、[刷新审计](browser-after-reload-audit.json)。

## 原始失败与修正

1. 迁移初次生成时pg_get_functiondef未带终止分号；第二次把既有planner的SETOF tasks误声明为uuid。两次事务完整回滚、两库013记录均为0，核对原函数签名后修正；[首次](migrate.txt)、[第二次](migrate-second.txt)、[成功](migrate-third.txt)保留。没有改写已应用的旧迁移。
2. Worker首次类型检查发现task_type为unknown，补类型收窄后通过；[失败](runtime-first.txt)、[修正后](runtime-second.txt)保留。
3. 首轮HTTP驱动把JSONB重新序列化后的键序与原文件文本直接比较，误报差异。改为原字节SHA和JSON结构比较，不改业务输出；[首次](http-first.txt)、[通过](http-second.txt)保留。
4. 浏览器实际发现批准后旧视图内部状态未切换，需手动刷新才见工作台。修正仅在本地页面按阶段重新初始化视图；保持同阶段结构修订的原组件版本跟踪和选择语义，修正后实测批准即进入工作台。[修复后](browser-auto-workbench-fixed.txt)。未接管的后续草稿、TTS、同步预览、Studio操作明确报错，未伪装成功或接管T18。

## 回归、历史与收尾

最终默认5000ms回归为94文件、740项通过；Node为2通过、1既有skip，所有记录的类型/预构建/前端构建退出0。[回归命令和退出码](regression-results.json)、[默认5000ms应用回归](application-final.txt)、[类型](application-types.txt)、[本地类型](local-types.txt)、[Node](node-final.txt)、[前端构建](frontend-build.txt)、[预构建](runtime-final.txt)。既有Node skip与原3条advisor WARN保留；本轮只查原生PG安全属性/迁移摘要，没有重跑云端advisor。[原生权限](native-security.json)确认definer固定search_path、PUBLIC不能执行、两库迁移摘要一致。

[原C历史](original-history.json)38表20,379行逐条保留；[T17开始前历史](pre-t17-history.json)38表21,332行逐条保留，包括T16已验收数据。保留本轮新合成业务记录及原始失败；私有dump、角色凭据、会话/租约原文和原始server日志不进入公开证据。最终回归及原始失败日志按原字节保留，不为消除空白提示改写。中间一次已通过的回归使用同名输出，被最终stage-key版本的回归覆盖；仅保留其[命令与退出码](before-stage-key-regression.json)，不当作另一轮完整原始日志证据。最终版本的完整原日志保留在本目录。

[两轴复查](review.md)、[收尾边界](boundaries.json)、[脱敏扫描](credential-scan.json)、[证据索引](evidence-index.json)区分实现、实际验收与尚未验收范围。默认部署、在线生成、其他Provider、完整多能力Worker、T24完整恢复仍未验收；默认5秒门禁历史失败及根因未解决继续保留。未提交、推送、合并、操作生产或开始T18。
