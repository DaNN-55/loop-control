# 48 类流程优化最终验收矩阵

日期：2026-11-11。依据用户已认可的 `docs/reviews/workflow-rules-20261111/rules.json`，由主 Agent 实施，独立审查 Agent 与环境 Agent 分批核对。这里只记录已检查和已执行的证据；不把“有测试文件”或跳过项算作通过。

## 判定含义与范围

- **修复并验证**：本轮改变了该类涉及的依赖、队列或有效性行为，且有下述具体断言通过。
- **验证保留**：保留已有规则，实际检查对应的代表性门槛；不表示穷举所有状态组合、文件格式或供应商故障。
- **本轮补齐**：4、5、17、24已实现持久发送事实、最多2次未发恢复、只读回执核对、原文件恢复与明确新请求。见[本轮证据](../receipt-rules-implementation-20261111/REPORT.md)和[独立48项复核](../receipt-rules-implementation-20261111/acceptance/REPORT.md)。
- **回收站后续验收**：44 已按用户选择迁入正式产品，160迁移、恢复和安全FIFO已验证；43原精确永久删除保护继续保留。见[回收站报告](../recycle-bin-migration-20261111/REPORT.md)。

本矩阵与日常服务是否已重载、全量默认套件最终结果分别报告。下列是隔离验收证据，不代替部署回执；无真实付费生成、无真实秘密/目录/生产单修改。

目录表示已知任务与审核状态，**不是最新文件完整性保证**。为避免每次列表刷新读取整片大视频计算指纹，目录只读取筛选后、含未完成任务的活动工程验证原生快照与用途；实际采用、编辑保存、导出、确认和交付仍验证所用文件字节与身份。无任务/已完成/历史工程不在这次原生用途投影中全量扫描。

## 实际执行命令与证据索引

下列集成共用环境前缀（不是日常库）：

```sh
LOOP_WORKSPACE_ACCEPTANCE=1 \
LOOP_TEST_CONTEXT_MODULE=/Users/dan/Programs/loop-control/docs/verification/workflow-rules-implementation-20261111/environment/runtime-context.mjs \
OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut \
npx vitest run <下表实际文件参数> --maxWorkers=1 --fileParallelism=false
```

| 编号 | 实际文件参数/命令 | 已读结果与证据 |
|---|---|---|
| U | `LocalCatalogApp.navigation`、`LocalCatalogApp.receipts`、`WorkspaceScriptPanel`、`WorkspacePlanningSelection`、上传恢复/人工上传、`EmbeddedStudioHost`、试听生命周期、`scriptProductionContinuation`、候选草稿/生命周期、交付、字幕、审核修订共16单测文件（完整命令见日志首行） | [171单测通过](environment/retained-unit.log)，无跳过。 |
| R1 | `src/local-app/workspaceScriptResume.integration.test.ts src/local-app/productionWorkspace.integration.test.ts src/local-app/workspacePexels.integration.test.ts src/local-app/workspaceCandidates.integration.test.ts src/local-app/workspaceCaptions.integration.test.ts` | [初验20通过/1旧断言失败/1浏览器门控跳过](environment/retained-integration-1.log)；候选按154真实follow字幕行为修正断言后[最终定向通过](environment/retained-candidate-final.log)，其余lane/样式仍完整比较。 |
| R2 | `src/local-app/workspaceDeliveryInputs.integration.test.ts src/local-app/nativeStudioPrimary.integration.test.ts src/local-app/embeddedStudio.integration.test.ts src/local-app/episodeArchive.integration.test.ts src/local-app/episodeDeletion.integration.test.ts src/local-app/episodeDeletionRetainedSources.integration.test.ts`；另启用 `LOOP_EMBEDDED_STUDIO_ACCEPTANCE=1 LOOP_EPISODE_ARCHIVE_ACCEPTANCE=1 LOOP_EPISODE_DELETION_ACCEPTANCE=1` | [8实际集成通过](environment/retained-integration-2.log)。 |
| P | `src/local-app/blueprintContraction.integration.test.ts` | [3规划/冻结选择与本地准备集成通过](environment/retained-planning.log)。 |
| CI | `src/local-app/workspaceCandidateImpact.integration.test.ts` | [3实际时长影响与采用通过](environment/retained-candidate-impact.log)。 |
| M | `src/local-app/workspaceNarration.integration.test.ts -t 'manual narration and disabled modes'` | [1通过，12非目标未执行](environment/retained-manual-narration.log)。 |
| A、EX | `src/local-app/workspaceNarrationTabs.integration.test.ts src/local-app/workspaceAudioStorage.integration.test.ts src/local-app/workspaceExport.integration.test.ts` | [初验10通过/2同步预览环境失败](batch1-independent-integration.log)；补 `OPENCHATCUT_ROOT` 后[两例复验通过](environment/sync-preview-diagnosis.log)，其余8非目标未执行。实际音频/字幕存储、开关与导出均有通过证据。 |
| V、S、D | `src/local-app/workspaceVisualCandidates.integration.test.ts src/local-app/workspaceSoundCandidates.integration.test.ts src/local-app/workspaceDelivery.integration.test.ts src/local-app/workflowRules.integration.test.ts` | [初验21通过/9旧协议断言失败](batch2-independent-integration.log)；156已用media.video，测试对齐后[视觉23/23完整通过](batch2-visual-protocol-retest.log)。声音候选1、交付4在初验通过；WF后续单列。 |
| WF | `src/local-app/workflowRules.integration.test.ts` | [4/4通过](workflow-rules-complete.log)：unknown关闭/重启/改输入重开、停用缺文件长尾导出、替换/删除/声音历史、已发送迟到结果只成候选。 |
| TU | `npx vitest run src/local-app/workspaceTaskRetry.test.ts src/local-app/WorkspaceVisualTaskStatus.test.tsx src/local-app/WorkspaceGenerationLocale.test.tsx --reporter=dot` | [29/29单测通过](batch3-independent-unit.log)；此外[工作台/重试/语言30单测复验](operations-retest.log)。两组有重叠，不相加。 |
| RT | `src/local-app/workflowRetryRules.independent.integration.test.ts` | [独立真实边界1/1通过](batch3-independent-integration-retest.log)：持久退避/真实claim、文件恢复实际ffmpeg重试、范围变化和删目标409且不建task。 |
| QS | `src/local-app/workflowQueueStop.independent.integration.test.ts` | [独立队列与权限4/4通过](batch3-queue-stop-independent-accepted.log)：ready/running/unknown/hold、目标删除、current Owner scope、同输入新明确请求。 |
| BW | `src/local-app/workflowRules.browser.integration.test.ts`；另启用 `LOOP_WORKFLOW_BROWSER_ACCEPTANCE=1` | [实际全应用浏览器1/1通过](browser/final-run.log)，[结果](browser/result.json)与[桌面提醒截图](browser/catalog-background-reminder.png)/[移动截图](browser/catalog-mobile.png)：真实Owner HTTP/PG、合成供应商，关闭刷新保持，后台提醒不阻塞，无横向溢出。 |
| QC | `src/local-app/workflowLegacyRules.integration.test.ts` | [新增旧QC三类4/4通过](environment/legacy-rules-registered.log)：迁移158/159修复后真实合成/结构/逐镜输入与安全边界。 |
| RC | `recycleBin.integration.test.ts`、`recycleBin.independent.integration.test.ts`、`episodeArchive.integration.test.ts`、`episodeDeletion.integration.test.ts` | [12真实集成通过](../recycle-bin-migration-20261111/REPORT.md)，新UI4项、16布局组通过，正式160已启用；未删除真实作品。 |
| DEMO | 隔离设置三页设计演示，不连接真实清理 | [本轮紧凑三方案验收](../settings-layout-v3/REPORT.md)，[原回收站语义说明](../settings-comments-20261111/demo/REPORT.md)。 |

上述执行组存在覆盖重叠和定向复验，**不相加为一个虚构的总测试数**。环境 Agent 的保留组为171单测、40独立集成场景（36既有+4 QC新增）；其他本批新测试和全量默认套件另按日志报告。[保留组详细报告](retained-rules-verification.md)、[第一批](batch1-independent-review.md)、[第二批](batch2-independent-review.md)、[第三批](batch3-independent-review.md)保留失败、修复和复验过程。

## 逐项最终矩阵

| # | 场景 | 最终判定 | 实际证据 | 已验收内容及限制 |
|---|---|---|---|---|
| 1 | 只读浏览、切步骤、关闭提示/详情 | 验证保留 | U、BW | 查看步骤/关闭详情只改变视图，不撤销已保存内容或自动重放写命令；导航、保存关闭分离测试通过。 |
| 2 | 保存/修改的共同前置条件 | 验证保留 | U、R2、QS、QC | Owner、CSRF、Origin、工程版本/路径/指纹及只读状态拒绝有实际断言；158/159新增入口另验非法scope与过期基准。 |
| 3 | 重复点击、并发写入、切换生产单 | 验证保留 | U、R1、RT、QS | 同一请求互斥、迟到回包归属、候选旧版本拒绝；真实退避不重复入队，重开不自动请求。 |
| 4 | 请求未发出 / 明确被拒绝 | 修复并验证 | [本轮RX/RCPT/浏览器及独立证据](../receipt-rules-implementation-20261111/REPORT.md) | 新协议持久区分准备/预留/进入发送/已收/拒绝；明确未发临时故障跨attempt最多2次恢复；参数、权限、输入变化与可能外发不自动重试。合法首音频前已知SSE拒绝与HTTP4xx明确拒绝可经新确认重试；旧未知不倒推。 |
| 5 | 本机写入503/超时/断线，回执未知 | 修复并验证 | [本轮RX/RCPT/浏览器及独立证据](../receipt-rules-implementation-20261111/REPORT.md) | 本机写入断线/503后只读核对同Owner同完整意图回执，命中恢复原成功；缺回执仍未知且不自动POST。私有删除清单复用正常公开投影；工作台提供重新读取。不能追溯旧503唯一原因。 |
| 6 | 后台ready/running | 修复并验证 | WF、QS、BW | 当前需求才影响制作；关闭的未知任务转独立提醒；未发送ready停止，已发送结果仍可完成但不自动采用。 |
| 7 | 后台failed/blocked | 修复并验证 | WF、BW、V | 旧失败不再无条件整期阻塞；替换/删除/停用后目录阻塞解除，任务历史仍保留。列表不是媒体实时全量哈希证明。 |
| 8 | 生成完成但尚未采用 | 修复并验证 | WF、V、R1 | 候选与已用内容分开；失败未采用候选不会阻塞已完整画面，采用仍需显式确认。 |
| 9 | 文件已产生但登记/发布未完成（hold） | 修复并验证 | TU、QS | hold有独立恢复入口与防重发；取消未用队列显式保留publication hold。后续回执批次已补真实COMMIT丢失与received登记失败故障注入，原发布恢复通过。 |
| 10 | 导入/填写主脚本 | 验证保留 | U、P | 脚本空/无效/过限等校验、草稿保留、导入保存与启动分离；不声称覆盖每种不支持文件格式。 |
| 11 | 脚本保存成功但制作启动失败/未知 | 验证保留 | U | 保存成功/start失败或未知后保留脚本，用权威读取恢复启动；旧回包或旧脚本回执不能启动新版本。 |
| 12 | 修改已确认脚本/排版修订 | 验证保留 | R1 | 实际排版修订保留精确原生工程和历史证据；实质内容变化不能借排版恢复绕过stale。 |
| 13 | 保存规划模型/Harness/默认值 | 验证保留 | U、P | 保存规划选择不生成；真实HTTP持久化；旧失败重试沿用冻结model/budget/harness/tools，新明确规划使用新选择。 |
| 14 | 建立/重建分镜工程 | 验证保留 | R1、P | 不完整匹配可保存，画面不足不能进Studio；补齐后安全重开；v2本地准备不要求未使用的规划/媒体连接。 |
| 15 | 上传/导入本地图片或视频 | 验证保留 | U、R1 | 逐行上传/登记恢复、成功项不重传；实际Pexels导入和重启可读亦通过。 |
| 16 | Pexels搜索/预览/导入 | 验证保留 | R1 | 受控Pexels查询→预览→导入→采用，坏URL/字节拒绝，连接轮换不改旧请求，多镜头结果保留且不自动采用。 |
| 17 | 生成图片 | 修复并验证 | [本轮RX/RCPT/浏览器及独立证据](../receipt-rules-implementation-20261111/REPORT.md) | 图片接入持久发送事实与同一未发恢复预算；完整文件+私有发布凭据后才登记received，失败恢复原产物不重发。未知可先核对后经新费用风险确认建retryOf新任务，保留原请求。 |
| 18 | 生成视频/从图片生成视频 | 修复并验证 | V、QS | 保存Provider ID恢复原任务且不再POST的current/legacy路径通过；已删除目标不可继续旧请求，UI不可恢复。 |
| 19 | 采用图片/视频候选、比较时长影响 | 验证保留 | R1、CI | 2/1/3秒预备影响与实际采用、持久化和SDK重开一致；旧输入/被篡改字节拒绝。字幕跟随新口播的旧断言已校正，样式/其他lane仍完整比较。 |
| 20 | 清除画面引用/删除镜头/重排与片段范围 | 修复并验证 | WF、QS、V | 本地替换/删除原目标后旧失败不阻塞；删除还停止未发送ready。最后一个有效镜头仍不能删除，真实画面空档校验保留。 |
| 21 | 关闭镜头口播开关 | 修复并验证 | WF、QS、BW | 关闭口播同步当前用途/待准备/目录与执行图；保留任务和可逆媒体；关闭刷新仍生效，已发送请求不被伪装取消。 |
| 22 | 关闭口播详情或错误提示 | 验证保留 | TU、BW | 关详情仍只是UI动作，不清未知证据；实际浏览器操作开关后才改变需求。没有把关闭错误弹窗等同舍弃内容。 |
| 23 | 保存模式/模型/文案/音色/语速、确认本镜 | 修复并验证 | WF、QS | mode=none与原生enabled统一；tts/manual显式保存可重启用途；历史请求/素材保留，重启并重新启用仍不绕过旧unknown。 |
| 24 | TTS生成/失败重试 | 修复并验证 | [本轮RX/RCPT/浏览器及独立证据](../receipt-rules-implementation-20261111/REPORT.md) | 口播接入同阶段/计数/发布恢复；未知请求经独立风险确认可建唯一新子请求，保留原记录和费用预留；新完成不再被旧unknown遮蔽。无全期默认时回填当前镜已保存配置，仍需明确确认且只进候选。 |
| 25 | 人工录音导入/登记/加入候选 | 验证保留 | M | 真实录音登记/保存，manual或none不发TTS；时长冲突不伪造成功，无关语音连接不成为上传前置。 |
| 26 | 采用/恢复口播版本、撤回已采用音轨 | 修复并验证 | WF、R1、QS | 已发送口播关闭后仍可完成为候选，但不会恢复用途/自动采用；重开亦需明确采用；原候选不可变、恢复不重生成。 |
| 27 | 原片声音提取/切换主声/分离视频声音 | 修复并验证 | RT、A、U | 实际原片ffmpeg提取、当前窗口校验与原准备失败恢复通过；无主声是合法状态；修正冻结relativePath键名误判失效。 |
| 28 | 配乐/音效开关 | 修复并验证 | WF、QS、TU | 配乐/音效关闭从当前依赖移除；未采用声音失败只留提醒；配乐ready退避停止，running/unknown/hold保留，重开不检索。 |
| 29 | 音乐/音效检索、上传、在线准备 | 修复并验证 | RT、QS、S | 真实source失败恢复同一文件可重试，改范围/删目标409且不建任务；Freesound合成响应冻结多候选、来源和许可，采用显式。 |
| 30 | 试听候选/音色样音 | 验证保留 | U | 试听关闭/离页清理、旧样音归属和播放错误局部呈现通过；没有把播放错误升级为制作阻塞。 |
| 31 | 采用声音/音量/闪避/位置/移除 | 修复并验证 | TU、A、RT、WF | 原生音量/闪避/位置逻辑保留；导出依赖移除显式停用音轨，普通音量0仍是文件依赖；实际启用媒体仍校验字节。 |
| 32 | 关闭字幕 | 验证保留 | R1、R2 | 关闭字幕保留正文与cue，实际原生保存读回与导出enabled过滤通过；旧对齐不强制当前已关闭字幕。 |
| 33 | 编辑/保存字幕正文、模式、安全区、手工校时 | 验证保留 | R1、U | 每镜lane、手工时序/安全区/原生拖动重开、无效字段不写工程；有效手工证据不被旧失败覆盖。 |
| 34 | 请求声学对齐、采用结果、确认正文 | 验证保留 | R1、A | 真实队列+当前正文/声音指纹；正文变化后迟到对齐拒绝，采用新口播只过期受影响字幕证据。不是WhisperX真实识别质量测评。 |
| 35 | 进入/重开剪辑工作台 | 修复并验证 | A、R1、WF | 剪辑入口仍检查实际画面/来源和工程身份；执行图排除停用音轨，旧口播失败不再是整期入口门槛。 |
| 36 | 保存编辑器/保存并返回/结束剪辑 | 验证保留 | U、R2 | 真实frame flush→save→close分开；错误不关闭会话、不伪造已保存；外项目/路径/指纹拒绝，SDK重开保留实际修改。 |
| 37 | 导出并技术检查 | 修复并验证 | WF、A、EX | 实际渲染用裁剪执行图，停用且文件缺失/长尾的口播不影响导出；重开该媒体后used_content失败；成片技术检查仍针对执行图。 |
| 38 | 记录问题、标为解决、确认成片 | 验证保留 | U、R2、EX | 成片未解决问题、旧导出、检查失败不能确认；用户问题与历史后台提醒分开；关闭面板不等于解决问题。 |
| 39 | 确认后继续编辑/修改实际已用内容 | 验证保留 | R2、U | 原生样式或已用内容变化后旧导出current/confirmed失效，修正后重新导出确认；显示变化提示、导出 vX → 当前 vY；最终界面定向 33 条通过，不声称有逐项剪辑差异分析。 |
| 40 | 封面、标题、简介、标签 | 验证保留 | R2、U | 真实封面内容、伪格式、大小、标签数量和字符边界及当前确认版绑定；不因不使用的外部服务阻止本地打包。 |
| 41 | 生成交付包、失败重试、下载 | 验证保留 | D、U、WF | 实际Worker打包、完整性校验、篡改/缺失拒绝、重试、下载及重启通过；当前确认版变化不得完成旧请求，完成状态不由历史失败倒退。 |
| 42 | 归档/恢复归档 | 验证保留 | R2、QS | 真实归档恢复保留状态、权限/历史/CSRF保护；恢复legacy不启用新生产；只读scope不能执行新的队列停止函数。 |
| 43 | 当前永久删除与文件清理恢复 | 验证保留 | R2 | managed/legacy精确清单删除与旧online/offline来源保护通过；提交前暂存恢复不冒充生产单回收站，未扩大自动永久删除。 |
| 44 | 回收站容量与恢复 | 修复并验证 | RC | 正式160已启用：默认可调5GB、恢复原ID/原归档状态、真实字节去重与安全FIFO。保护刚入站、单项超限、共享/未知/离线/在途；旧清理回执保留，未释放仍计占用。迁移/启动/读取不自动清理。 |
| 45 | 连接/密钥/模型/额度/目录 | 验证保留 | P、RT、V；上一轮设置验收 | 本次实际所用连接/本地路径与冻结执行选择门槛保留；设置页临时错误不成为内容状态。秘密/目录设置未在本轮做真实修改；既有设置单测沿用。 |
| 46 | 自动退避、重试次数耗尽、旧版本被替代 | 修复并验证 | TU、RT、QS | 真实available_at拒绝提前claim；过期/删目标禁止旧任务重试；自动尝试耗尽不剥夺新明确意图；未发送退避ready停止，已发送/费用/hold证据保留。 |
| 47 | 旧整期自动续作的配置、暂停和恢复 | 验证保留 | U、P | 暂停、稳定授权身份、在途/失败付费不重发、workspace_enabled停止legacy调度的决策测试通过；未运行依赖日常命名fixture的旧整期跨进程集成。 |
| 48 | 受控QC合成修订、分镜结构退回、逐镜输入修订 | 修复并验证 | QC | 三类旧QC实际HTTP/PG/文件与SDK预览/确认/打开/新冻结4例通过；修复running结构退回、123登记前置与queue后登记死结；非法/旧基准/冲突拒绝、幂等登记和本次task绑定通过。 |

类别核对（回执补齐后）：验证保留26项；修复并验证22项，合计48项。4/5/17/24新增持久发送阶段、最多2次未发恢复、原回执核对和显式新生成均有本轮证据；48类逐项代表性验收通过，不表示穷举所有组合或真实供应商扣费。此前阶段结果保留在相应历史报告。

## 159 冻结登记边界的最后只读复核

`NativeStudioCommands` 先按当前基准打开/冻结，并经 `verifyProjectSources` 校验真实来源字节；随后在同一个 Owner 事务中调用 `register_owned_studio_freeze`，再排队并绑定 producer task。SQL 自身限制 Owner、可写阶段、当前未失效 basis、Episode 当前路径中的 `openchatcut-frozen/<uuid>/project.json`、SHA/正大小与允许字段；同路径不同身份拒绝。后续绑定只给尚无 producer 的登记补本次任务，不把旧 producer 的历史直接改指新任务。队列失败时数据库登记随事务回滚，不能把仅有文件当成已完成任务。

环境 Agent 的4例实际验证包含外国Owner、旧basis、非法路径/SHA/大小、同路径冲突、幂等一次登记、本次task producer、冲突前不写frozen、无直接tasks UPDATE权限，以及逐镜实际SDK preview→confirm→open→新审核冻结。此次复核未发现需继续扩大测试的新疑点。

## 明确未作出的保证

- 未解决发送前/已发送/结果已收到但登记失败等底层分类，也未还原旧503的唯一历史原因。
- 未删除或恢复任何真实作品；回收站真实行为仅在隔离数据验证。正式升级只启用新能力，现有6张生产单保持原状。
- 未证明所有供应商在线生成成功、扣费、WhisperX真实识别质量或所有输入组合。
- 未把浏览器门控/定向非目标跳过算作通过；旧整期专用跨进程集成未擅自使用日常命名fixture运行。
- 没有以目录状态替代实际导出与交付时的媒体字节校验。
