# 48 类流程建议：独立基线审计

审计时间：2026-11-11 18:16（Asia/Shanghai）。本报告仅描述主 Agent 实施本批业务修复前的独立基线；不是最终验收。未修改业务代码、PLAN 或真实生产数据。

## 已证实的主要差距

1. 当前任务关联没有统一检查原生启用/实际采用：口播、声音、候选旧失败可继续进入目录阻塞。
2. 待准备口播计数不检查 enabled；mode=none 与原生开关两个入口不同步。
3. 导出和工程读取仍扫描停用后保留的静音节点文件，需裁剪实际执行依赖与渲染输入，而非只跳验证。
4. 重试按钮缺少服务端退避/失效等证据。max_attempts=1 不能机械禁止 Owner 明确确认的新付费意图；自动尝试与显式新请求需要区分。
5. 发送前失败误归 unknown 是另一项真实差距，但按用户第 3 项暂缓，不可计完成。

## 本次实际执行

- `npx vitest run` 指定 11 个相关单测文件：142/142 通过，耗时 4.70s。文件覆盖脚本、上传恢复、规划选择、原生编辑保存关闭、候选生命周期、试听及音频/字幕/交付纯逻辑。
- `LOOP_WORKSPACE_ACCEPTANCE=1 npx vitest run src/local-app/workspaceCatalog.integration.test.ts`：初始化失败，`Applied fixture migration changed: 139-global-storyboard-planning.sql`，未到业务断言。不能算业务失败或通过；需隔离新 PostgreSQL 上下文。
- 下表列出的其他集成文件是已有测试证据位置，**未执行不等于通过**。默认测试排除 `*.integration.test.ts`，且相关集成多有环境变量门控。

## 逐项矩阵

源码短路径默认位于 `src/local-app/`；`../` 指 `src/`。测试短路径默认位于 `src/local-app/`，纯领域逻辑测试位于 `src/`。

| # | 操作 | 基线结论 | 主要源码 | 已有测试位置 | 差距或核对点 |
|---|---|---|---|---|---|
| 1 | 只读浏览、切步骤、关闭提示/详情 | 保留/已有 | `useWorkspaceOperations.ts;WorkspaceVisualTaskStatus.tsx` | `EmbeddedStudioHost.test.tsx;LocalCatalogApp.navigation.test.tsx` | 详情只开关本地UI；切步骤不发重试。需新增明确停用后的区分用例。 |
| 2 | 保存/修改的共同前置条件 | 保留/已有 | `episodeCommands.ts;productionWorkspaceCommands.ts:315` | `productionWorkspace.integration.test.ts;workspaceCallConfirmation.integration.test.ts` | 服务端Owner、存储、脚本与revision保护已存在；现有集成未在本轮执行。 |
| 3 | 重复点击、并发写入、切换生产单 | 保留/已有 | `useWorkspaceOperations.ts:27;useWorkspaceReading.ts;client.ts` | `WorkspaceScriptPanel.test.tsx;EmbeddedStudioHost.test.tsx;LocalCatalogApp.receipts.test.tsx` | 局部ownership/revision与幂等保护存在；未知写入不得新键自动重放。 |
| 4 | 请求未发出 / 明确被拒绝 | 暂缓分类 | `narrationWorker.ts;workspaceTaskPresentation.ts` | `narrationReceiptBoundary.test.ts` | 0外发的预留/route失败仍误归unknown；用户第3项若为回执暂缓，不能将此项记完成。 |
| 5 | 本机写入503/超时/断线，回执未知 | 日志已有/分类暂缓 | `localRoute.ts;runtimeRequestLog.ts;client.ts` | `runtimeRequestLog.test.ts;LocalCatalogApp.receipts.test.tsx` | 安全requestId日志已新增；仍缺提交阶段权威分类，本轮保留未知保护。 |
| 6 | 后台ready/running | 需修改 | `catalogQuery.ts:61;workspaceGenerationTasks.ts` | `workspaceCatalog.integration.test.ts;workspaceGenerationState.integration.test.ts` | 已舍弃/已关闭内容的在途任务仍可进入当前关联；历史提醒须与阻塞分离。 |
| 7 | 后台failed/blocked | 需修改 | `catalogQuery.ts:61-86` | `workspaceCatalog.integration.test.ts` | 关联的narration/audio/latest visual失败直接汇总，无统一当前需求判定。 |
| 8 | 生成完成但尚未采用 | 部分符合 | `workspaceCandidates.ts;workspaceVisualCandidates.ts;catalogQuery.ts` | `workspaceCandidates.integration.test.ts;workspaceVisualCandidates.integration.test.ts` | 候选与已用分离、采用显式；但无关失败候选仍可能进入目录阻塞。 |
| 9 | 文件已产生但登记/发布未完成（hold） | 部分符合 | `workspaceOutputReconciliation.ts;WorkspaceVisualTaskStatus.tsx;catalogQuery.ts` | `workspaceGenerationState.integration.test.ts` | 同产物恢复且不再外发已覆盖；不再使用时独立提醒依赖目录分层修改。 |
| 10 | 导入/填写主脚本 | 保留/已有 | `WorkspaceScriptPanel.tsx;workspaceScriptInput.ts` | `WorkspaceScriptPanel.test.tsx` | 输入、保存、启动分离，失败保留原稿；本轮相关单测通过。 |
| 11 | 脚本保存成功但制作启动失败/未知 | 保留/已有 | `WorkspaceScriptPanel.tsx` | `WorkspaceScriptPanel.test.tsx` | 实际测试已有save成功/start失败、重读恢复、陈旧回包与revision区别。 |
| 12 | 修改已确认脚本/排版修订 | 保留/已有 | `workspaceScriptResume.ts;productionWorkspaceCommands.ts` | `workspaceScriptResume.integration.test.ts` | 排版复用与内容变化分支已存在；真实集成未执行。 |
| 13 | 保存规划模型/Harness/默认值 | 保留/已有 | `WorkspacePlanningSelection.tsx;planningSelectionStore.ts` | `WorkspacePlanningSelection.test.tsx` | 保存选择不提交任务，单测本轮通过；更换不修改冻结任务。 |
| 14 | 建立/重建分镜工程 | 保留/已有 | `workspacePreparation.ts;useWorkspaceOperations.ts` | `productionWorkspace.integration.test.ts;WorkspaceScriptPanel.test.tsx` | 规划路径独立；打开工程只检查画面/来源，不按旧口播任务阻止。 |
| 15 | 上传/导入本地图片或视频 | 保留/已有 | `ProductionWorkspacePanel.tsx;workspaceUploads.ts` | `ProductionWorkspaceUploadRecovery.test.tsx;ProductionWorkspaceManualUpload.test.tsx` | 逐行上传恢复、成功项不重传；相关恢复单测本轮通过。 |
| 16 | Pexels搜索/预览/导入 | 保留/已有 | `workspacePexels.ts;WorkspacePexelsSearch.tsx` | `workspacePexels.integration.test.ts` | 查询/预览/导入独立、来源与指纹验证；不自动采用。 |
| 17 | 生成图片 | 保留/分类暂缓 | `workspaceImages.ts;workspaceCallConfirmation.ts` | `workspaceGenerationState.integration.test.ts;workspaceCallConfirmation.integration.test.ts` | 显式费用确认已存在；unknown图片新付费例外不可改为自动重试。 |
| 18 | 生成视频/从图片生成视频 | 保留/已有 | `workspaceVisualCandidates.ts;wanVideoProvider.ts` | `workspaceGenerationState.integration.test.ts;workspaceVisualCandidates.integration.test.ts` | providerTaskId恢复查询已存在；0次重复POST用例已有。目录无关旧任务仍待修。 |
| 19 | 采用图片/视频候选、比较时长影响 | 保留/已有 | `workspaceCandidates.ts;workspaceVisualCandidates.ts` | `workspaceCandidateImpact.integration.test.ts;workspaceCandidates.integration.test.ts` | prepare/adopt、指纹、durationPolicy与revision已检查。 |
| 20 | 清除画面引用/删除镜头/重排与片段范围 | 部分符合 | `productionWorkspaceCommands.ts;workspaceShots.ts;catalogQuery.ts` | `workspaceVisualCandidates.integration.test.ts;workspaceExportCoverage.test.ts` | 实际画面空档门槛存在；删除目标后的旧任务目录关联待排除。 |
| 21 | 关闭镜头口播开关 | 需修改 | `workspaceNarrationToggle.ts;workspaceNarration.ts:84;catalogQuery.ts;ProductionWorkspacePanel.tsx:221` | `workspaceNarration.integration.test.ts;workspaceAudioProjection.integration.test.ts` | 仅原生flag+静音；目录忽略enabled；待准备忽略enabled；导出仍扫描静音节点源。 |
| 22 | 关闭口播详情或错误提示 | 保留/已有 | `WorkspaceVisualTaskStatus.tsx;WorkspaceNarrationPanel.tsx` | `WorkspaceVisualCandidatesPanel.test.tsx` | 关闭详情为本地UI状态；不等于停用/撤销外部请求。 |
| 23 | 保存模式/模型/文案/音色/语速、确认本镜 | 需修改 | `workspaceNarration.ts:108-117;workspaceNarrationToggle.ts` | `workspaceNarration.integration.test.ts` | mode=none未统一写enabled=false；tts/manual未统一恢复被关闭marker。无已采用节点时none没有native写入。 |
| 24 | TTS生成/失败重试 | 重试保护已有/分类暂缓 | `workspaceNarration.ts:143-165;narrationWorker.ts` | `workspaceNarration.integration.test.ts;workspaceGenerationState.integration.test.ts;narrationReceiptBoundary.test.ts` | 启用/确认/unknown禁止重发已存在；发送前错误分类是明确暂缓项。 |
| 25 | 人工录音导入/登记/加入候选 | 保留/已有 | `workspaceManualNarration.ts;workspaceNarration.ts:95` | `workspaceNarration.integration.test.ts;ProductionWorkspaceManualUpload.test.tsx` | 本地录音与连接无关，已传素材直接登记；不发送TTS。 |
| 26 | 采用/恢复口播版本、撤回已采用音轨 | 保留/已有 | `workspaceNarration.ts:168-174;workspaceCandidates.ts` | `workspaceNarration.integration.test.ts;workspaceCandidates.integration.test.ts` | adoptFirst显式跳过enabled=false；冻结旧输入不可覆盖新版。需补关闭→迟到→重开专项。 |
| 27 | 原片声音提取/切换主声/分离视频声音 | 保留/已有 | `workspaceAudio.ts;workspaceVideoSound.ts;../workspaceAudio.ts` | `workspaceAudioProjection.integration.test.ts;workspaceAudio.integration.test.ts;workspaceAudio.test.ts` | none合法且不改BGM/SFX；本轮纯逻辑4例通过，真实投影集成未执行。 |
| 28 | 配乐/音效开关 | 需修改 | `workspaceAudio.ts:32;../workspaceAudio.ts;catalogQuery.ts` | `workspaceAudio.integration.test.ts;workspaceSoundCandidates.integration.test.ts` | 开关已阻止新准备/采用且UI隐藏；目录旧准备失败仍聚合，静音源仍进导出依赖。 |
| 29 | 音乐/音效检索、上传、在线准备 | 部分符合 | `workspaceAudio.ts;WorkspaceAudioPanel.tsx:139;catalogQuery.ts` | `workspaceAudioSelection.integration.test.ts;workspaceAudio.integration.test.ts` | 冻结源/原准备重试存在；检索失败作为无关候选时仍可能目录阻塞；重试按钮无完整服务端原因。 |
| 30 | 试听候选/音色样音 | 保留/已有 | `WorkspaceSpeechSample.tsx;WorkspaceAudioAudition.tsx` | `WorkspaceSpeechSample.lifecycle.test.tsx` | 试听仅组件播放错误，页面全局不阻塞；本轮生命周期测试通过。 |
| 31 | 采用声音/音量/闪避/位置/移除 | 部分符合 | `../workspaceAudio.ts;workspaceAudio.ts;workspaceExportCommands.ts:28` | `workspaceAudio.test.ts;workspaceAudio.integration.test.ts` | 实际采用/位置/mix校验已有；停用保留静音节点仍被导出扫描。 |
| 32 | 关闭字幕 | 保留/已有 | `workspaceCaptionsCommands.ts:103;workspaceExportCommands.ts:46-52` | `workspaceCaptions.integration.test.ts` | 关闭保留cue历史、导出required过滤enabled；caption任务不进workspace_task_links。 |
| 33 | 编辑/保存字幕正文、模式、安全区、手工校时 | 保留/已有 | `workspaceCaptionsCommands.ts:133-140;../workspaceCaptions.ts` | `workspaceCaptions.integration.test.ts;workspaceCaptions.test.ts` | 手工保存清task_id并更新evidence；旧失败不会覆盖新版manual。4纯逻辑例本轮通过。 |
| 34 | 请求声学对齐、采用结果、确认正文 | 保留/已有 | `workspaceCaptionsCommands.ts:144-166` | `workspaceCaptions.integration.test.ts;workspaceCandidates.integration.test.ts` | 采用须对应当前task/evidence/input/音轨/正文指纹；关闭/手工后旧结果失去采用资格。 |
| 35 | 进入/重开剪辑工作台 | 部分符合 | `useWorkspaceOperations.ts:55;productionWorkspaceCommands.ts` | `productionWorkspace.integration.test.ts;EmbeddedStudioHost.test.tsx` | 前端不检查旧口播任务；服务端读工程missingSources仍可能将已停用静音文件算依赖。 |
| 36 | 保存编辑器/保存并返回/结束剪辑 | 保留/已有 | `EmbeddedStudioHost.tsx;useWorkspaceOperations.ts:72-87` | `EmbeddedStudioHost.test.tsx` | flush、save、close独立；失败保留session，相关15例本轮通过。 |
| 37 | 导出并技术检查 | 需修改 | `workspaceExportCommands.ts:28-52` | `workspaceExport.integration.test.ts;workspaceExportCoverage.test.ts` | 实际used扫描包括停用静音音轨，需构建仅执行当前内容的渲染project；不能只跳文件验证。 |
| 38 | 记录问题、标为解决、确认成片 | 部分符合 | `workspaceExportCommands.ts:66-84;workspaceExportDelivery.ts` | `workspaceExport.integration.test.ts;workspaceExportDelivery.test.ts` | 成片issues独立且confirm检验严格；目录历史任务提醒仍与issue混成整期blocked。 |
| 39 | 确认后继续编辑/修改实际已用内容 | 保留/显示可完善 | `workspaceExportCommands.ts;WorkspaceExportPanel.tsx:22,39` | `workspaceExport.integration.test.ts;workspaceExportDelivery.test.ts` | current由revision+contentSha绑定，旧包失效；已有工程已变化提示和历史版本，可增加当前对照版本。 |
| 40 | 封面、标题、简介、标签 | 保留/已有 | `WorkspaceDeliveryPanel.tsx;workspaceDeliveryCommands.ts` | `workspaceDeliveryInputs.integration.test.ts;WorkspaceDeliveryPanel.test.tsx` | 封面/标题/标签校验与已确认成片绑定，本地不检查无关Provider。 |
| 41 | 生成交付包、失败重试、下载 | 保留/已有 | `workspaceDeliveryCommands.ts;workspaceDeliveryWorker.ts;catalogQuery.ts:94` | `workspaceDelivery.integration.test.ts;workspaceExportDelivery.test.ts` | 实际verifyPublishPackage决定完成，completed目录优先done；历史失败不倒退。 |
| 42 | 归档/恢复归档 | 保留/已有 | `episodeLifecycle.ts;docs/adr/0001-episode-archive-and-permanent-delete.md` | `episodeArchive.integration.test.ts` | 归档保留文件/审计；目录排除归档待办，不等同回收站。 |
| 43 | 当前永久删除与文件清理恢复 | 保留/不迁移Demo | `episodeLifecycle.ts;episodeDeletionTargets.ts` | `episodeDeletion.integration.test.ts;episodeDeletionRetainedSources.integration.test.ts` | 当前仍精确stage→DBcommit→cleanup；本轮不得把恢复暂存声称恢复整期。 |
| 44 | 建议回收站容量与恢复（尚未实现） | 隔离Demo范围 | `settings-review-v2.prototype.tsx` | `docs/verification/settings-comments-20261111/demo/REPORT.md` | 真实软删除/恢复/自动清理未实现，用户此次仍要求Demo选择；不能记正式回收站完成。 |
| 45 | 连接/密钥/模型/额度/目录 | 保留/已有 | `LocalConnectionsPanel.tsx;ConnectionWorkspace.tsx;MediaRootSettingsDialog.tsx` | `workspaceAudioSelection.integration.test.ts;connectionLifecycle.integration.test.ts;MediaRootSettingsDialog.test.tsx` | 选择所用连接才验证，设置读取错误局部呈现；目录迁移仍需明确计划确认。 |
| 46 | 自动退避、重试次数耗尽、旧版本被替代 | 需完善证据/展示 | `workspaceTaskPresentation.ts:27;workspaceGenerationTasks.ts;codexRunner.ts:819` | `workspaceGenerationState.integration.test.ts;codexRunner.test.ts` | canRetry仅failed/blocked且非unknown/hold，无退避/耗尽/失效原因投影。注意maxAttempts=1不等于禁止Owner明确新付费重试；只禁止无限自动。 |
| 47 | 旧整期自动续作的配置、暂停和恢复 | 保留/已有 | `scriptProductionRunner.ts:12-15;scriptProductionContinuation.ts:27;episodeCommands.ts` | `scriptProductionContinuation.test.ts;workspaceCallConfirmation.integration.test.ts` | workspace_enabled直接停止legacy安排，授权hash+script校验；旧授权不绕过新单次确认。单测本轮通过。 |
| 48 | 受控QC合成修订、分镜结构退回、逐镜输入修订 | 保留/已有 | `studioCommands.ts;episodeCommands.ts;docs/adr/0016-formal-preparation-lineage.md` | `nativeStudioPrimary.integration.test.ts;embeddedStudio.integration.test.ts` | 旧审核基准、内容/结构/输入修订独立；新导出与revision绑定，旧证据不覆盖。 |

## 后续验收约束

每批实施后以本矩阵复查相关行，并运行真正跨 HTTP / PostgreSQL / 原生工程 / Worker 的受控集成；不调用真实供应商。全量回归不能替代门控集成。正式流程与隔离回收站 Demo、回执暂缓项分别报告，不将所有 48 行笼统标为正式功能已上线。
