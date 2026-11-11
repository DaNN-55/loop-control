# 保留流程的独立验收

日期：2026-11-11。执行 Agent 只读业务代码，使用独立 PostgreSQL `loop-workflow-48-ef6c49f91450`，每个 fixture 建立随机测试库与素材目录。没有访问真实供应商或付费，没有修改日常数据库、SDK、服务或业务实现。

## 环境与实际执行结果

所有集成使用 `LOOP_WORKSPACE_ACCEPTANCE=1`、`LOOP_TEST_CONTEXT_MODULE=.../environment/runtime-context.mjs`、`OPENCHATCUT_ROOT=/Users/dan/Programs/loop-control/.loop-control/local/OpenChatCut`，每个命令设置 `--maxWorkers=1 --fileParallelism=false`。归档、删除、旧 Studio 另显式启用各自 acceptance 开关。

| 执行组 | 实际结果 | 日志 |
| --- | --- | --- |
| 16 个 UI/纯逻辑测试文件 | 171 通过，0 跳过，20.36 秒 | `environment/retained-unit.log` |
| 脚本复用、工作区、Pexels、候选、字幕 5 文件 | 20 通过、1 失败、1 跳过，134.72 秒 | `environment/retained-integration-1.log` |
| 封面输入、原生保存、旧 Studio、归档、删除、旧来源保留 6 文件 | 8 通过、0 跳过，58.28 秒 | `environment/retained-integration-2.log` |
| 人工口播/停用模式定向 | 1 通过、12 非目标跳过，3.71 秒 | `environment/retained-manual-narration.log` |
| 候选实际时长采用与重开 | 3 通过、0 跳过，26.89 秒 | `environment/retained-candidate-impact.log` |
| 普通规划选择与冻结输入 | 3 通过、0 跳过，7.37 秒 | `environment/retained-planning.log` |
| 候选旧断言修正后的定向复验 | 1 通过、6 非目标跳过，6.79 秒 | `environment/retained-candidate-fixed.log` |
| 新增旧 QC 三类真实边界 | 4 通过、0 跳过，21.48 秒 | `environment/legacy-rules-registered.log` |

第一组 1 个跳过是专门的字幕浏览器 UI 门控（`LOOP_CAPTION_BROWSER`），没有将其记作通过。相同文件中实际横竖屏 SDK/Remotion 字幕像素检查已执行通过。人工口播组使用 `-t 'manual narration and disabled modes'`，12 个非目标案例未执行，不能合并计为通过。

## 唯一失败的定位

`workspaceCandidates.integration.test.ts` 的 `explicit candidate duration changes only the stable main voice and stale attempts preserve the saved edit` 最后断言整个 `tracks` 必须与采用前相等。当前迁移 154 将新口播字幕默认设为 `follow_tts`；`src/workspaceCandidates.ts` 在明确采用新口播时调用 `followWorkspaceNarrationCaption`，因此该字幕正文和时序按新口播更新。最小复现仅有这组变化：

- 正文：`原始完整口播。` → `简短新口播。`
- 结束时间：`2000` → `1400` 毫秒。
- 其他轨道、样式、图像位置、音量、转场等断言此前均通过。

复现日志：`environment/candidate-duration-repro.log`（1 失败、6 非目标跳过）。已向主 Agent 建议保留真实跟随行为，将测试收窄为“其他轨道与样式不变 + 当前跟随字幕随明确采用更新”。业务代码未由本 Agent 改动。主 Agent 修正旧断言后，本 Agent 定向复验 1 例通过（6 个非目标跳过，6.79 秒），见 `environment/retained-candidate-fixed.log`。额外提醒已送主 Agent：原生样式在 `captions.sourceEntries` 的 lane 上，保留样式的断言应比较真实 lane 字段，不能只比较可能不存在的 `captions.style`。主 Agent 已加强为只归一化目标 lane 的 words/loopControl.text，其余所有轨道、样式、位置及其他 lane 完整比较；本 Agent 再次复验1通过、6非目标跳过（7.31秒），见 `environment/retained-candidate-final.log`。

## 对照 48 类场景中的保留项

下表只声明实际检查到的断言范围，不用测试文件存在替代执行。

| 场景 | 已执行的具体断言 | 结果与限制 |
| --- | --- | --- |
| 1 只读、切步骤、关闭详情 | `LocalCatalogApp.navigation` 路由与旧读取归属；`EmbeddedStudioHost` 关闭与保存分离 | UI 单测通过；不表示所有 GET 均已穷举 |
| 2 权限、版本和路径前置 | `productionWorkspace` 缺画面不进 Studio；`embeddedStudio` 外用户、CSRF、Origin、路径/项目/指纹错误拒绝且不改文件 | 实际 HTTP/文件通过 |
| 3 重复、并发、旧回包 | `LocalCatalogApp.receipts`、`WorkspaceScriptPanel` 保存/启动回执与旧对象隔离；候选 stale revision 拒绝 | 单测及候选集成断言通过；候选 follow 字幕全轨道旧断言另记失败 |
| 10 主脚本输入 | `WorkspaceScriptPanel` 空/无效输入、导入保存和启动分开；旧稿保留 | 单测通过 |
| 11 保存成功但启动失败/未知 | `WorkspaceScriptPanel` 保存成功/start 失败、读取恢复、身份/版本检查 | 单测通过，不实施暂缓的底层发送分类 |
| 12 已确认脚本修订 | `workspaceScriptResume` 纯排版保留精确已编辑工程、旧失效证据；内容变化不能借排版恢复绕过 stale | 实际 HTTP/原生工程 2 例通过 |
| 13 规划选择 | `WorkspacePlanningSelection` 保存不提交、错误留草稿；`blueprintContraction` 真实HTTP保存读取选择，旧任务重试保留原model/budget/harness/tools，新明确规划使用新选择，归档拒绝保存 | 单测及3例集成通过 |
| 14 建立工程 | `productionWorkspace` 未完整匹配可保存，画面不足拒绝打开，补齐后安全重开 | 实际 HTTP/SDK 1 例通过 |
| 15 本地上传 | `ProductionWorkspaceUploadRecovery` 每行恢复、成功不重传；`ProductionWorkspaceManualUpload` 登记与上传分开 | 单测通过；Pexels 实际导入再重启可读亦通过 |
| 16 搜索、预览、导入 | Pexels 6 例检查明确查询→预览→导入→采用、坏 URL/字节拒绝、连接轮换不改旧请求、多镜头搜索保留、不自动采用 | 受控响应/真实字节 HTTP + Worker 6 例通过，无真实网络 |
| 19 候选采用 | 2/1/3 秒的预备影响与真实采用、持久化、SDK 重开一致；旧输入/篡改文件不能覆盖新输入 | 时长 3 例及候选相关断言通过；有 1 个字幕预期旧断言待修 |
| 25 人工口播 | 已登记录音保存，`manual/none` 不发 TTS，短画面冲突可恢复，未增加供应商提交 | 实际 HTTP + 受控 Worker 1 例通过 |
| 26 口播版本/迟到结果 | 候选不可变、拒绝不改工程；旧输入/篡改字节拒绝；本机保存后的采用回执可恢复且不重生成 | 候选集成 6 例通过；停用专项由第一/二批验收 |
| 30 试听 | `WorkspaceSpeechSample.lifecycle` 关闭/离页清理、旧回包与新样音归属、播放错误 | UI 生命周期单测通过 |
| 32 关闭字幕 | `nativeStudioPrimary` 移除原生字幕 lane 后已关闭；`workspaceCaptions` 关闭/开关保存保留原生状态 | 实际原生保存/读回通过 |
| 33 字幕编辑与手工校时 | 每镜 lane 隔离、百分比安全区与秒时序经保存/原生拖动/重开保留；无效字段不改工程 | HTTP/SDK 5 例通过；纯逻辑同时通过 |
| 34 对齐/正文核对 | 请求走真实队列；正文变化后晚到 Worker 结果拒绝；采用口播使受影响字幕证据失效且旧对齐不能恢复 | 实际 PG/HTTP/受控完成记录通过；不代表 WhisperX 真实识别质量 |
| 36 编辑器保存/返回 | `EmbeddedStudioHost` flush/save/close 失败各自保留会话；`embeddedStudio` 实际保存指纹、身份、源拒绝、退出后不可再存、重开保留修改 | UI 和真实 SDK/HTTP 通过 |
| 38 问题与成片确认 | `workspaceExportDelivery` 旧导出/未解决问题不能确认；`nativeStudioPrimary` 成片确认绑定实际文件与字幕 | 纯逻辑和实际导出/确认通过，完整交付由另一审计 Agent 执行 |
| 39 确认后编辑 | 原生样式变化使旧导出 current/confirmed=false；无效字幕阻止新导出；修正后需再次确认 | `nativeStudioPrimary` 实际 HTTP/SDK 通过 |
| 40 封面与元数据 | 真实封面内容、格式伪装、大小、标签数量和字符边界，当前已确认版绑定；UI 保留草稿但不持久化真实 cover File | HTTP/文件集成 1 例 + UI 单测通过 |
| 41 交付 | 本 Agent 执行元数据入口与纯逻辑原失败包重试前置；完整实际打包/下载/失败恢复由独立审计 Agent 执行 | 本报告不重复计另一 Agent 的完整交付结果 |
| 42 归档恢复 | Owner/CSRF/历史/外用户保护，恢复 legacy 不开启新生产，保留状态记录 | 实际 HTTP/PG 1 例通过 |
| 43 当前永久删除 | managed/legacy 精确删除、活跃/未知等围栏、旧 online/offline来源未获删除权不删除；空账号仅已无依赖后删除 | 实际 HTTP/PG/文件 4 例通过；没有真实回收站实施 |
| 47 兼容自动续作 | `scriptProductionContinuation` 暂停不继续、在途/失败付费任务不重发、稳定授权操作身份、工作区已启用停止旧调度、审核不自动批准 | 单测通过；旧专用 `scriptProduction.integration` 要求日常命名 fixture，未擅自运行 |
| 48 旧 QC 修订三分支 | 新增 `workflowLegacyRules.integration` 实际合成冻结/结构退回/逐镜输入→本地SDK预览确认→新审核冻结，权限/旧包/running/文件历史检查 | 初验发现两处真实缺口，主Agent修复158/159后4/4通过；新增登记作用域安全断言同时通过 |

## 48 类兼容修订的最小补测前置

已给主 Agent 提供来源：`studioCommands.ts:30–43,66–88`、`episodeCommands.ts:315–327`、`c-baseline.sql` 的 `current_openchatcut_review_package`、`request_review_render_revision`、`request_studio_storyboard_revision`、`request_shot_structure_revision` 及 `orchestrate_review_render_tasks`。

可基于 `embeddedStudioFixture({runtime:{wake(){}}})` 构造真实 HTTP 用例：查询当前 QC 包 ID，加入 `review_kind=openchatcut_review_render` 与 `pre_render_review_package_id`；插入同 Episode 的 `production_ready` 包并指向当前 `storyboard_review`；补有效 storyboard approval；保留真实原始任务输入和文件指纹。合成重渲染需 pre-render 冻结成员和批准决定、storyboard/confirmed_shots 等上下文，不能仅插入空包后断言失败即覆盖成功。结构退回和逐镜输入修订须分别断言，不能互相替代。

后续主 Agent 授权本 Agent 独占编写新 `workflowLegacyRules.integration.test.ts`；本 Agent 仍不修改业务或其他共享测试，实际补测及主 Agent 修复结果见下文。


## 补充：旧 QC 三类真实边界测试

根据主 Agent 后续授权，新建并独占 `src/local-app/workflowLegacyRules.integration.test.ts`。这不是通过人工登记结果跳过产品接口的测试：合成/逐镜输入经真实 Owner HTTP、PG 与不可变文件；逐镜输入还执行实际本地 SDK 同步预览 Worker、确认、打开 Studio、再冻结新审核请求。

首次测试发现并报告给主 Agent：

1. 结构退回在存在 running 分镜修订时仍成功，旧 API 缺少任务冲突门槛。
2. 主 Agent 初次用 `SELECT tasks FOR UPDATE` 添加门槛后，最小权限 loop_app 正常调用均403；独立复验捕获，主 Agent 改为迁移158受控 definer 锁。
3. 迁移123的 `owned_studio_frozen_reference` 要求冻结文件先有 artifacts 登记，而 `NativeStudioCommands` 直到任务排队后的 scope 才插入该记录，导致新合成修订和新逐镜审核冻结均被拒绝。真实 HTTP400，复用同一冻结文件在隔离 Owner 事务直接调用公开SQL得到 `Invalid frozen Studio project`。不能在测试中替产品预先登记以掩盖问题，已交主 Agent 修复。

测试前置中出现的缺项也已逐一补齐：临时 invalidated task 必须有 reason、旧 editable draft、显式 loop_app 身份、Worker capacity 与旧 input enabled。这些仅是测试 fixture 前置，不计作业务缺陷。原始过程日志全部保留：`legacy-rules-first.log`、`legacy-rules-fixture-retest.log`、`legacy-rules-fixed.log`、`legacy-rules-input-retest.log`、`legacy-rules-input-enabled.log`、`legacy-rules-input-diagnostic.log`。`legacy-rules-after-lock.log` 记录锁修复后2通过/2失败，保留了真实红灯。主 Agent 后续迁移159登记顺序修复后的完整独立验收：**4/4通过、0跳过，21.48秒**，见 `environment/legacy-rules-registered.log`。


最终新增断言包括：

- 同一已核对冻结文件在 Owner 事务内登记，再绑定新任务；重复登记保持只有一条 `studio_frozen_project`，`producer_task_id` 为本次请求任务。
- 外国 Owner 的冻结登记拒绝（42501）；过期/不存在 basis 拒绝（55000）；路径越界、无效 SHA/大小拒绝（22023）；同路径不同合法 SHA 拒绝（55000）。这些调用使用真实 `loop_app` 身份和事务，失败均回滚。
- 主 Agent 修复后的任务冲突在打开/冻结文件前拒绝409；目录中没有新 frozen 文件，且 `loop_app` 依旧没有 `public.tasks UPDATE` 权限。
- 结构退回只使原 QC/pre-render 下游资格失效；原 storyboard、任务快照和全部旧文件字节保留。
- 逐镜新草稿先不能进入整期工作台；实际本地预览完成并确认后才可打开、冻结新审核快照。新包引用实际新片段、无声/字幕关闭意图；旧 QC 不能用于新修改的合成修订。

本 Agent 本轮最终执行覆盖171个独立单测与40个独立集成场景（36既有+4新增）。各诊断/复验命令包含重复执行，不额外累加。非目标与浏览器门控跳过仍按日志单列；没有声称真实供应商/WhisperX识别质量或回收站生产功能通过。
