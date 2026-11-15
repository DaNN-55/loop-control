# B1 剩余组合验收

状态：本分支负责的剩余组合已完成。最终固定 `JIgPY2` 单批 **5 项通过、0 失败、0 跳过**；`npm run runtime:prepare` 与完整 `npm run check` 退出 0。只补独立制作基准尚缺的跨输入、任务与修订组合；D 来源恢复及最终 G 由主对话执行。

## 固定起点与隔离

起点为含当前未提交改动的 `parallel-baseline/source`，HEAD 为 `2d1a8ff46318ece0031c0810899a339df71520c9`；约定 manifest SHA 为 `f1dabb6a54afb8f21fcf279a8f15a92ef2dc140ff8631c0d475f7f41ee84eb76`。1770 个源文件已复制至独占目录并逐项核对，差异 0。验证只使用自己的源码／运行目录、真实禁网 tmpfs PostgreSQL、自有媒体卷和端口，不读取日常配置或 Provider 秘密。SDK 只读，重型导出按主对话排期。

## 覆盖表

| 边界 | 沿用的有效证据 | 本次新增组合 | 当前结果 |
| --- | --- | --- | --- |
| 普通正文、v2、v3 首次准备 | `productionDefaultPreparation`、`productionScriptV3`、`currentShotSemantics` 的独立准备／严格解析／无默认任务 | 不新增单独解析或首次准备用例，只作为组合前置 | 沿用；不计为本次新增通过 |
| 当前字幕与口播 | `productionCaptionInputs`、`productionNarrationInputs` 的独立输入、手工音轨、当前任务及 Owner／ACL／迟到结果保护 | prose／v2／v3 图片／v3 混合：逐镜人工字幕＋口播输入＋上传录音候选＋图片／已有视频匹配 → 仅排版修订 → resume → 重启；保留稳定 clip／item／shot、人工编辑、原音轨和冻结输入 | 最终同批前 4 项通过；旧候选明确比较返回 409 |
| 新单无旧写入 | 191／192 默认图片、视频、原声、配乐、Pexels 单路径 | 上述组合全过程核对 `review_packages`、`shot_preparation_drafts`、`approvals`、`workspace_shot_inputs` 均 0；v2 显式原 `a_roll` 分类不进入当前 manifest | 最终 5 项均通过；不另加计数 |
| 文件与来源保护 | 187～190 SHA／大小／字节、来源复合外键、原音轨及冻结任务保护 | 排版子基准建立后，原基准整行／文件字节、人工音轨整行／文件字节、原音轨基准及原请求快照不变 | 最终同批前 4 项通过 |
| 多任务共存 | 191 图片／视频、190 TTS、192 Pexels 的单任务冻结与执行；C2 当前原声真实 Worker | 同一 v3 新单同时提交第一镜图片／TTS、另一镜原声；反序完成真实 Worker、只明确采用原声、重启；候选不隐式写入工程，逐任务冻结输入保持 | 最终同批第 5 项通过；受控图片／TTS 各 1 次，原声由真实本机 Worker 提取 |
| 现有作品及旧来源完整恢复 | 188～197 及 D 各专项有效记录 | 本分支不重复 D 恢复；承接主对话全部来源恢复结果 | 主对话执行 |

当前写入范围仅 `productionPreparationCoverage.integration.test.ts`、本报告及本报告证据目录。未修改产品核心、SQL、SDK、共享夹具或总计划；未提交、推送或运行完整默认套件。

## 排版修订与原候选的合同

原未采用人工录音在排版子基准中保留正文、模式、`audio_track_id`、原轨、文件和冻结任务；原候选仍可追溯，但不会成为新脚本下已经确认的当前请求。这是原保护合同：[`workspaceNarration.inputs`](../../../src/local-app/workspaceNarration.ts) 的指纹包含脚本与制作基准，读取只有指纹相同才返回当前有效 `audioTrackId`；[`readWorkspaceCandidates`](../../../src/local-app/workspaceCandidates.ts) 将旧指纹的候选标为 `stale`，且脚本不相同不能借用旧确认恢复。191 的 [`resume_production_formatting_revision`](../../../db/current/191-default-independent-production-preparation.sql) 明确建立新脚本／子基准并关闭原在线制作授权，保留原工程 SHA，不重写旧请求。

因此验收同时要求「原输入／来源保留」与「旧确认不被当成新确认」，不能把当前指针归空当成丢失原音轨，也不能为保持旧指针而绕过指纹。末尾新增空白用于明确的字节变更与语义相同修订；v2 ASCII 设置边界插入空行不在现有 `scriptBody` 的等价归一化范围内，本轮不扩展产品的排版语义。

真实 Worker 领取会通过 `claim_next_worker_task` 的[领取阶段资源约束登记](../../../db/current/upgrade-from-legacy-v1.sql#L39)，调用 `worker_resource_limits` 向 `runtime_constraints` 追加本次资源限制回执。新增组合只允许这项合同规定的增量，原业务输入及原全部提交约束精确比较；不忽略整个执行快照。原声以容量 1 领取，与其提交约束一致。

## 失败与阶段结果

首轮 4 项失败属于新夹具前置错误：旧镜头输入表没有 `episode_id`，须经 `workspace_id` 关联；v3 按合同拒绝旧首帧／生成时长字段。第二轮 4 项失败分别是将旧候选有效指针误当成来源保存，以及 v2 的 ASCII 边界空行不满足现有排版等价判断。停止重跑后读取上述指纹、候选及排版合同，改为来源精确保留与旧确认拒绝；未修改产品逻辑。随后 `WufA4f` 实际 4 项全部通过，完整类型与 runtime 构建通过。

第 5 项首轮为 1 项失败、4 项筛选未运行：三个实际 Worker 均完成，工程／逐镜字幕／候选与明确原声采用断言通过，最后的原快照整对象比较因合法追加 `resource_limits` 失败；该次不计通过。后续一次 runner 因资源排期在静态检查与容器初始化交界被终止，退出 143，未建立运行上下文、未进入测试；其空 PostgreSQL 容器经主对话与 C2 双方核对后按唯一名称／标签删除。C2 窗口结束后，最终同一源码的 5 项实际一次全过；不将早期 4 项通过加成 9 项，也不把筛选未运行项计入通过。

## 最终指纹、证据与清理

最终运行源码 SHA：`55f22ed23f9d2da2c27b2ddcd1609e8c5f2914afd2c0f05a5328e68f378c7883`。构建和测试开始前记录 1680 个运行所需文件，结束后逐项 SHA 完全相同，覆盖测试与本工作区文件相同。原 1770 文件基准保持；runner 只省略无需运行的文档，并将 11 个 `tsBuildInfoFile` 改为自有路径，移除此路径字段后配置与基准一致。产品源码、SQL、脚本与版本化媒体均未变更。

最终本文件 5 项用时约 24.7 秒。没有 SDK 导出、浏览器验收或真实 Provider API；新增部分没有 UI／产品行为修改。Owner／RLS／ACL、attempt／lease、未知不重发、费用、精确导出和完整来源恢复沿用原有效专项及主对话矩阵；本分支不声称重新执行了这些全范围验收。本分支范围内待修项 0；v2 在 ASCII 设置边界插入空行仍返回 409 的现有支持范围限制保留并已报主对话，不据 5 项通过声称全部等价 Markdown 排版均可接续。

| 证据 | 内容 |
| --- | --- |
| [最终测试](evidence-b1-remaining/run-JIgPY2/vitest.json)、[原始日志](evidence-b1-remaining/run-JIgPY2/tests.log) | 同批 5 通过／0 失败／0 筛选或跳过 |
| [类型](evidence-b1-remaining/run-JIgPY2/types.log)、[runtime 构建](evidence-b1-remaining/run-JIgPY2/build.log) | 完整 `npm run check`、Worker／backend 准备通过 |
| [运行前指纹](evidence-b1-remaining/run-JIgPY2/source-manifest.json)、[运行后保持](evidence-b1-remaining/run-JIgPY2/source-unchanged.json) | 固定源码与测试前后逐文件对账 |
| [基准对账](evidence-b1-remaining/baseline-verified.json)、[汇总](evidence-b1-remaining/summary.json) | 1770 原文件、运行配置差异、调用数与逐轮真实结果 |
| `run-JIgPY2/b1-input-*.json`、[任务组合回执](evidence-b1-remaining/run-JIgPY2/b1-mixed-task-receipt.json) | 稳定身份／新旧基准、人工轨、三任务、明确采用与确切原声文件 |
| [诊断](evidence-b1-remaining/diagnosis.md)、各轮 `coverage-test.txt`／原始日志 | 保留夹具失败、断言修正与原实际测试源码，不覆盖失败证据 |
| [清理](evidence-b1-remaining/cleanup.json) | 6 次运行均终态，6 个准确自有容器均实际查询确认移除；不动其他容器 |

私有基准、运行源码和原始证据保留在 `/Volumes/Ebuget 1T/loop-workflow-private-backup-20261114-5bk8z1hx/b1-remaining-5ijpg0qj/` 供复核；它们不属于日常部署。测试媒体卷随 fixture 关闭，没有活动 B1 Worker／测试进程。未运行最终 G 的默认完整套件，未操作日常数据库、配置或服务，未提交或推送。
