# A–D 实施票单（已发布）

更新：2026-10-23。Owner已认可A–D范围、顺序、测试边界以及25张票的拆分与依赖。25张票已发布并逐一核对ready-for-agent标签、正文和GitHub原生阻塞关系；A、B阶段已完成本地提交并获Owner认可；B最终完整SQL21文件/224条断言通过。C的T06/#112及补验已本地提交并获Owner认可；T07/#113已完成本地实现、验证与复审并获Owner认可，本次提交归档；T08/#114已完成本地实现、验证与复审并获Owner认可，本次提交归档；T09已完成本地实现、真实验收与复审（690项应用/258条SQL通过），T10已本地实现并验证（697项应用/271条SQL通过），T11已本地实现并验证（最终699项应用/280条SQL通过），C本地完成，D待独立对话接续，E/F搁置。

E（界面与流程精简）、F（总体发布验收与切换）搁置，A–D全部完成后再讨论。完全离线生成仍不纳入本轮。阶段内必要的测试、真实数据库验证和恢复演练继续执行，不因F搁置而延期。

## 执行与发布规则

- T编号为本地稳定标识，对应GitHub Issue见下方映射；每张票保留本地正文。
- 按A→B→C→D推进；同阶段只执行前置票已完成的票。下表“Blocked by”记录真实技术依赖，阶段顺序为另外一条Owner执行约束，不把无技术关系的任务伪装成依赖。
- 建议执行顺序为表中编号顺序；不是要求把同阶段独立票互相加锁。T11只依赖备份能力，但仍在C阶段安排；T12已有技术前置完成也必须等C阶段结束后才开始。
- 每张票交付可演示的业务/运行路径，不把整个迁移塞成一张“改数据库”大票。A阶段环境和契约准备属于必要前置工作。
- 统一入口采用“先扩展→迁移调用者→移除旧入口”；本地化采用独立环境按领域路径迁移，每个实体/场景有单一权威写入源，禁止隐式双写。
- 未迁移路径在优化环境明确标为暂不可用，不回落到生产配置；中间阶段CI和已迁移路径保持通过，不把所有失败推迟到最后一票。
- 每票范围以沿用既有行为、迁移访问边界为主，不顺手重写生成算法或删减功能；涉及的新依赖按最小必要清单说明。
- 发布时用项目规定的gh CLI逐票创建到DaNN-55/loop-control，应用ready-for-agent；优先使用实际可用的原生阻塞关系，否则正文引用真实Issue标识。
- 来源当前是本地规格，没有已存在父Issue；不擅自修改或关闭父Issue。本轮只发布获批票单，不启动A阶段或改变生产。
- 发布后记录Issue映射与阻塞关系；按已批准边界从A开始实施，暂不合并。

## 票单总览

| ID | 阶段 | Title | Blocked by | What it delivers |
|---|---|---|---|---|
| [T01](01-isolated-run.md) | A | 隔离环境启动与最小生产单演练 | 无 | 在优化环境启动控制台并读取一条独立测试 Episode，启停与演练均不接触当前生产。 |
| [T02](02-baseline.md) | A | 固定样本与性能资源基线 | T01 | 提供可重复的页面读取、任务派发与本地产物演练，后续可用同样本比较优化结果。 |
| [T03](03-architecture.md) | A | 用最小生产路径固定调度及本地化契约 | T02 | 以现有Episode提交、领取和结果回写演练为依据，形成可供后续小票实现的服务、事务及迁移契约。 |
| [T04](04-restore.md) | B | 完整备份与空库恢复演练 | T03 | Owner可在隔离环境生成备份，并恢复出可浏览的Episode、配置、任务、审核和产物引用。 |
| [T05](05-lease.md) | B | Worker中断后的租约回收和安全重试 | T04 | Worker中断后任务能释放容量并重试；正常执行和新一轮结果不受旧尝试干扰。 |
| [T06](06-queue-entry.md) | C | 即时与定时派发共用一条持久执行路径 | T05 | 同一测试任务无论由按钮还是定时器触发，都通过统一队列领取、执行并回写到Episode详情。 |
| [T07](07-capacity.md) | C | 多Episode持续消费、容量限制与公平调度 | T06 | 多个Episode的待执行任务持续推进，空出槽位后立即领取下一条，长生产单不会独占队列。 |
| [T08](08-fast-dispatch.md) | C | 预构建运行与即时唤醒加五秒兜底 | T07 | Owner提交可执行任务后及时领取，关闭页面也有后台补漏，派发不再反复编译。 |
| [T09](09-notification.md) | C | 新事件提醒、健康与备份状态独立展示 | T06 | Owner只收到新审核/状态/阻塞事件的提醒，能分别查看调度、健康和备份结果。 |
| [T10](10-reads.md) | C | 生产单详情聚合读取与列表完整分页 | T06 | 现有生产单页面通过统一服务读取所需数据，刷新只更新必要范围，历史增加也不遗漏记录。 |
| [T11](11-render-reuse.md) | C | 复用已审核且输入一致的最终成片 | T04 | 冻结工程与导出条件未变时直接生成最终交付记录，避免重渲染同一视频。 |
| [T12](12-local-read.md) | D | 本地PostgreSQL导入与目录只读贯通 | T04, T10 | 独立导入数据在本地数据库中形成一致目录，Owner能经服务读取账号、系列与Episode摘要。 |
| [T13](13-local-owner.md) | D | 本地Owner登录与账号数据隔离 | T12 | 断开Supabase Auth后，Owner仍能登录本地控制台并读取其有权访问的账号和Episode。 |
| [T14](14-local-config.md) | D | 本地账号、蓝图和系列配置闭环 | T13 | Owner可在本地创建和修改账号、蓝图及系列，刷新后保留配置与版本。 |
| [T15](15-local-secrets.md) | D | Keychain连接创建、验证与版本选择 | T14 | Owner在本地创建和验证外部连接，蓝图选择版本，Worker只按引用解析密钥。 |
| [T16](16-local-input.md) | D | Episode脚本、视觉准备与Worker回写本地闭环 | T08, T14, T15 | Owner在本地创建Episode、上传并确认脚本，Worker完成视觉资产准备并返回可审核结果。 |
| [T17](17-local-storyboard.md) | D | 本地分镜规划、审核与修订闭环 | T16 | Owner可由已确认脚本推进分镜，审核或请求结构修订，并保留旧审核依据。 |
| [T18](18-local-narration.md) | D | 本地镜头口播生成和音轨复用 | T17 | Owner保存本期TTS设置并生成镜头口播，任务与音轨记录保存在本地。 |
| [T19](19-local-media.md) | D | 本地人工素材与图片、A-roll、B-roll、配乐任务 | T17 | Owner导入人工素材或执行已注册媒体路径，产物进入对应镜头并可预览审核。 |
| [T20](20-local-alignment.md) | D | 本地音频提取、字幕对齐与同步预览 | T18, T19 | Owner能使用已有镜头音频完成提取、对齐、字幕编辑与同步预览，状态和产物都本地保存。 |
| [T21](21-local-studio.md) | D | 本地Studio编辑、冻结与审核视频 | T20 | Owner打开可编辑工程、保存修改并明确生成审核视频，本地形成冻结快照与审核结果。 |
| [T22](22-local-delivery.md) | D | 本地QC、发布包与Episode生命周期 | T21, T11 | Owner完成QC并生成校验通过的发布包，Episode进入生产完成；归档和删除沿用既有规则。 |
| [T23](23-local-automation.md) | D | 本地接管提醒、健康和备份触发并退出n8n | T09, T08, T22 | 新版本启动后由本地服务持续调度、提醒和触发健康/备份，n8n不再是运行前提。 |
| [T24](24-local-restore.md) | D | 本地数据库、密钥绑定及媒体恢复闭环 | T22, T15 | Owner可备份新本地版本，并在全新隔离环境恢复出可继续操作的Episode。 |
| [T25](25-local-contract.md) | D | 移除Supabase运行依赖并验证断网数据操作 | T23, T24 | 新版本无需Supabase与n8n即可启动并管理本地生产数据，断网时在线任务明确等待前置条件。 |

## 发布核对

25张票、75项验收条件及全部技术阻塞边均已核对。Owner已确认粒度与依赖；不再重复请求确认。A阶段交付见[验证报告](../../verification/stage-a/README.md)，T03 ADR为Proposed。Owner审阅后再进入B阶段T04；E/F搁置，暂不合并。


## GitHub Issue 映射

| Ticket | 阶段 | Issue | 原生Blocked by |
|---|---|---|---|
| T01 | A | [#107 [A][T01] 隔离环境启动与最小生产单演练](https://github.com/DaNN-55/loop-control/issues/107) | 无 |
| T02 | A | [#108 [A][T02] 固定样本与性能资源基线](https://github.com/DaNN-55/loop-control/issues/108) | #107 |
| T03 | A | [#109 [A][T03] 用最小生产路径固定调度及本地化契约](https://github.com/DaNN-55/loop-control/issues/109) | #108 |
| T04 | B | [#110 [B][T04] 完整备份与空库恢复演练](https://github.com/DaNN-55/loop-control/issues/110) | #109 |
| T05 | B | [#111 [B][T05] Worker中断后的租约回收和安全重试](https://github.com/DaNN-55/loop-control/issues/111) | #110 |
| T06 | C | [#112 [C][T06] 即时与定时派发共用一条持久执行路径](https://github.com/DaNN-55/loop-control/issues/112) | #111 |
| T07 | C | [#113 [C][T07] 多Episode持续消费、容量限制与公平调度](https://github.com/DaNN-55/loop-control/issues/113) | #112 |
| T08 | C | [#114 [C][T08] 预构建运行与即时唤醒加五秒兜底](https://github.com/DaNN-55/loop-control/issues/114) | #113 |
| T09 | C | [#115 [C][T09] 新事件提醒、健康与备份状态独立展示](https://github.com/DaNN-55/loop-control/issues/115) | #112 |
| T10 | C | [#116 [C][T10] 生产单详情聚合读取与列表完整分页](https://github.com/DaNN-55/loop-control/issues/116) | #112 |
| T11 | C | [#117 [C][T11] 复用已审核且输入一致的最终成片](https://github.com/DaNN-55/loop-control/issues/117) | #110 |
| T12 | D | [#118 [D][T12] 本地PostgreSQL导入与目录只读贯通](https://github.com/DaNN-55/loop-control/issues/118) | #110, #116 |
| T13 | D | [#119 [D][T13] 本地Owner登录与账号数据隔离](https://github.com/DaNN-55/loop-control/issues/119) | #118 |
| T14 | D | [#120 [D][T14] 本地账号、蓝图和系列配置闭环](https://github.com/DaNN-55/loop-control/issues/120) | #119 |
| T15 | D | [#121 [D][T15] Keychain连接创建、验证与版本选择](https://github.com/DaNN-55/loop-control/issues/121) | #120 |
| T16 | D | [#122 [D][T16] Episode脚本、视觉准备与Worker回写本地闭环](https://github.com/DaNN-55/loop-control/issues/122) | #114, #120, #121 |
| T17 | D | [#123 [D][T17] 本地分镜规划、审核与修订闭环](https://github.com/DaNN-55/loop-control/issues/123) | #122 |
| T18 | D | [#124 [D][T18] 本地镜头口播生成和音轨复用](https://github.com/DaNN-55/loop-control/issues/124) | #123 |
| T19 | D | [#125 [D][T19] 本地人工素材与图片、A-roll、B-roll、配乐任务](https://github.com/DaNN-55/loop-control/issues/125) | #123 |
| T20 | D | [#126 [D][T20] 本地音频提取、字幕对齐与同步预览](https://github.com/DaNN-55/loop-control/issues/126) | #124, #125 |
| T21 | D | [#127 [D][T21] 本地Studio编辑、冻结与审核视频](https://github.com/DaNN-55/loop-control/issues/127) | #126 |
| T22 | D | [#128 [D][T22] 本地QC、发布包与Episode生命周期](https://github.com/DaNN-55/loop-control/issues/128) | #127, #117 |
| T23 | D | [#129 [D][T23] 本地接管提醒、健康和备份触发并退出n8n](https://github.com/DaNN-55/loop-control/issues/129) | #115, #114, #128 |
| T24 | D | [#130 [D][T24] 本地数据库、密钥绑定及媒体恢复闭环](https://github.com/DaNN-55/loop-control/issues/130) | #128, #121 |
| T25 | D | [#131 [D][T25] 移除Supabase运行依赖并验证断网数据操作](https://github.com/DaNN-55/loop-control/issues/131) | #129, #130 |

## T07 本地实现交接

Owner已认可T07本地验收结论，并授权将实现及证据提交当前分支；票单/云端依赖核对后在verified实现容量、公平和持续消费。证据见[报告](../../verification/stage-c-t07/README.md)。本轮默认5000ms完整回归通过，不清除T06/B曾失败且未修时序不稳定的历史限制；三条既有RLS性能告警保留。实现及证据在当前分支本地提交，未操作生产、推送、合并或开始T08。

## T08 本地实现交接

Owner已认可T08本地验收结论并授权提交当前分支；云端票单及T07依赖核对后在同一verified环境实现预构建与常驻调度。证据见[报告](../../verification/stage-c-t08/README.md)。默认5000ms本轮72文件/681项通过，仍保留T06/B此前默认5秒门禁失败且根因未解决的限制。实现及证据在当前分支本地提交，未操作生产、推送、合并或开始T09。

## T09 本地交接

T09/#115已在verified完成投递账本、独立运维结果及完整备份接入。真实晚提交/1005同时间戳/并发/SIGKILL/HTTP及空库恢复通过；默认5000ms74文件690项、SQL258条通过。两轴终审无剩余阻塞。保留B/T06此前默认5秒失败且根因未解决、Node原生校验跳过及三条既有RLS性能WARN。完整备份与REST部分快照分别展示，未知投递不自动重发。[报告](../../verification/stage-c-t09/README.md)。本地归档不代表Owner事后审阅或云端关票，未操作生产/推送/合并；T10/T11后续，D仍受C阶段门禁。

T10/#116已完成详情分区/任务行增量、会话隔离与完整分页，真实1005记录及相反表顺序并发通过。小样本首次载荷略增、后续刷新显著下降；分页并发变化明确报错。保留真实超时及T09测试时钟失败记录。[报告](../../verification/stage-c-t10/README.md)。T11接续，D仍受C完整门禁。

T11/#117完成受审视频复用、输入/产物完整性和失效重渲染。两组真实HTTP/Worker/视频/QC/发布包通过；最终C全回归699项应用、280条SQL通过，38表20379行282媒体完整备份/新空库恢复通过。两轴终审无阻塞。[报告](../../verification/stage-c-t11/README.md)。C本地完成，未代表Owner事后审阅或云端关票；[独立D交接](../../verification/stage-c-to-d.md)，从T12/#118开始。
