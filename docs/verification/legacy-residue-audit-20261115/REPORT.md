# 旧流程残留与前后端契约审查

日期：2026-11-15。审查起点：本地 `main` 的 `16f1645d` 及当前未提交工作树。三组只读子审查分别覆盖 HTTP／前端契约、SQL／权限与退役依赖、Worker／工作流串联，主审交叉核查并运行隔离复现。未修改产品代码、迁移或重启日常服务、提交或推送。

## 结论

确认 3 个问题：1 个 P1 旧执行面残留，2 个 P2 行为／请求串行问题。旧接口问题按共同根因合并，不把各命令重复计算。当前前端主路径未发现「有调用、后端没有实现」的确定缺口；这项结论来自静态映射及定向测试，未逐个动态执行所有接口。

当前代码和日常运行包均为 `production-workspace/v2`；日常运行版本与 prepared 版本一致，运行包记录的 242 个后端来源文件与工作树逐一匹配。因此下面的旧链残留不能归因于日常仍在运行旧包。

## 1. P1：前端已撤下的旧制作链，后端仍能写入、入队并交给 Worker

入口：`src/local-app/episodeCommands.ts:50`、`:59`、`:119`、`:121`、`:158`、`:200`、`:244`、`:265`。

当前前端通过 `ProductionWorkspacePanel` 提供脚本、素材、剪辑、交付四步，`LegacyProductionSteps` 只展示历史记录与下载。但后端白名单及实现仍接受以下旧命令族，当前非测试 TSX 中未找到这些命令的调用者：

| 命令族 | 仍保留的行为 |
| --- | --- |
| `saveTtsSettings`、`saveTtsDraft`、`saveMediaDraft`、`registerManualMedia`、`saveAudioSelection` | 写旧 Episode／分镜草稿／旧声音选择 |
| `generateClip`、`retryMedia`、`generateSourceAudio`、`requestAlignment`、`generateSyncPreview` 等 | 按旧审核包、逐镜头状态和能力开关创建／恢复任务 |
| `openStudio`、`saveStudio`、`generateReviewVideo`、`submitStudioRevision`、旧 QC／交付命令 | 继续旧 Studio、审核渲染和交付链；仅部分命令在已有当前工作区时被阻止 |
| `generateWan`、`generateOfficialVideo`、`resumeWan` | 按旧 `storyboard_review`、`a_roll`／`b_roll` 和蓝图绑定创建或恢复视频任务 |

视频路径见 `src/local-app/wanCommands.ts:21`、`:24`、`:36`、`:37`：它继续从 `policy[shotType]` 取执行配置、打开 `media_enabled` 并调用 `request_wan_shot_video`／`request_official_shot_video`。这是静态确认的供应商任务路径；本次未发起真实付费请求。

有效 schema 仍有对应写函数和角色授权，例如 `db/current/effective-baseline.sql:8333` 的 `generate_shot_clip`。`db/current/199-worker-responsibility-boundaries.sql:124` 的 `input_task_allowed`、`:89` 的领取入口及 `:260` 的回执入口仍允许有关旧输入路径。单纯撤下前端按钮没有关闭后端执行。

隔离实测使用新的 PostgreSQL 17 集群、当前 clean-v3 基线、真实 Owner HTTP、真实媒体文件和实际 SQL 领取。构造历史已批准分镜及素材后：

1. `saveTtsDraft`、`saveMediaDraft` 返回 200，写入旧草稿。
2. `generateClip` 返回 200，任务类型为 `generate_a_roll`。
3. 以 `loop_worker` 调用当前 `nativeWorkerPort`，成功领取同一任务。

没有执行该任务或调用真实 Provider；Worker 领取已足以证明它不是不可执行的历史名称。证据见 `native-result.json`、`probe-results.json` 和 `native-probe.test.ts.txt`。

这与 `docs/specs/current-workflow-replacement-20261113.md:22-23` 要求旧作品经当前工作区接入、有效 schema／当前代码无旧执行入口不符。当前 `PLAN.md` 头部已记录完整 A–G 完成，不能用下方历史提案中的「D 尚未完成」解释这一残留。

建议：先在认证和归属检查后统一拒绝无当前消费者的旧命令，再按实际依赖退役专属 SQL 写入口与授权。保留历史只读、显式接入、已有未知请求核对及恢复。部分任务类型／执行器可能被当前制作复用，不能按 `generate_a_roll` 等名字直接删除全部 Worker 处理器。

## 2. P2：`planMedia` 返回已排队，实际不创建任务

入口：`src/local-app/episodeCommands.ts:200`、`:231-242`、`:265`；调度边界：`src/local-app/workerDatabase.ts:23`。

该命令通过旧分镜和预检后，只设置旧媒体开关并返回 `{id, queued: true}`，随后唤醒 Worker。旧 planner 已改成 `plan() => 0`，没有后续计划动作补上这次排队。

同一隔离 HTTP 探针实测：返回 200、`queued: true`，调用前后任务数相同。它没有当前前端消费者，但残留调用方会得到错误的成功回执并一直等待。

建议随旧命令族退役；如果另有必须保留的调用方，应明确返回退役状态，不能继续声称已入队。

## 3. P2：目录请求与连接列表串行绑定，连接故障阻止整个目录显示

入口：`src/local-app/LocalCatalogApp.tsx:155-160`。

`refresh()` 先等待 `catalog`，再等待 `connections`，两者完成后才 `setCatalog(next)`。连接列表失败时，目录虽已成功返回，仍跳到外层失败处理；首次打开会落入错误页，后续刷新可能保留旧目录。正常情况下，这也把两次独立读取的等待时间相加。已有 `catalogOnly=true` 的列表轮询说明目录可以独立读取。

对真实 `LocalCatalogApp` 的故障注入测试中，目录返回 200、连接列表返回 503，最终显示连接错误，主导航未出现。证据见 `catalog-probe.test.tsx.txt` 与 `probe-results.json`。该测试验证组件及请求边界，未模拟真实连接服务的超时长度。

建议让目录先显示，连接列表独立／并行读取并局部报告错误；保留现有请求代次、Owner 切换和迟到结果保护。

## 现有检查为什么没有发现第 1 项

`src/local-app/retiredExecutionSurface.test.ts:7` 只枚举已删除的六个脚本命令和一组 SQL／执行名称，没有覆盖旧分镜手工命令族。这条扫描通过，不能证明全部旧入口都已退役。

`src/local-app/workflowLegacyRules.integration.test.ts:118-132` 还把旧草稿、预览、旧 Studio 和审核视频作为成功路径。该文件由 `LOOP_WORKSPACE_ACCEPTANCE` 控制；默认单元套件又排除集成文件。即使启用，也是在检查旧链继续成功，而非退役后必须拒绝。本次没有运行该完整链，不把源码中的正例当作本轮通过证据。

## 已排除的误报与覆盖范围

- 静态核对脚本、当前制作命令、素材／图片／口播／Pexels、原生工作区和交付主要路径，均找到后端实现。`claim_next_worker_task` 是当前传输层映射名，实际转到 `claim_managed_worker_task`，不是缺失 RPC。
- migration 198 删除的九个函数未见当前执行来源继续调用；空 planner 不再自动扫描旧生产。旧 repair、planning 入口的拒绝路径与当前来源读取分开。
- 新建库实际采用 `effective-baseline.sql`／clean-v3；日常仍使用合法 clean-v2 账本加 198、199、200，全部 SHA 校验通过，待迁移数为 0。不能把旧 `baseline.sql` 中已被增量覆盖的定义单独算成当前问题。
- 日常库只读核对为 0 账号、0 生产单、0 任务。残留函数存在，但没有日常业务样本可验证其对具体旧单的影响。
- `LegacyProductionSteps`、`legacy-project`、来源选择、`read_legacy_workbench_source` 和历史回执投影有明确历史读取／接入职责，不建议按 `legacy` 字样批量删除。
- 蓝图旧模型／连接的一次初始预填受到 `CONTEXT.md` 明确允许，实际提交仍经过当前选择解析；本轮未发现它覆盖明确选择的确定缺陷。

## 本轮验证与限制

| 检查 | 结果 |
| --- | --- |
| 主审 9 文件定向测试：退役扫描、schema 账本、命令回执／CSRF、旧来源面板、当前操作、详情轮询、调度器、口播 Worker | 52 项通过 |
| API 组当前调用确认、口播、Pexels 组件测试 | 实际运行 3 文件，48 项通过；命令另列的 `useWorkspaceOperations.test.ts` 不存在，不计覆盖 |
| API 组 `npm run check` | 通过，无 TypeScript diagnostic |
| 原生 PostgreSQL／Owner HTTP／旧任务领取探针 | 1 项通过，确认第 1、2 项 |
| 目录成功＋连接失败的真实组件故障探针 | 1 项通过，确认第 3 项 |
| 日常 schema 账本、函数存在性、业务计数及运行包来源 | 只读核对完成 |

API 组测试有 jsdom `HTMLMediaElement.pause` 和 React `act` 警告，未造成失败。原生探针前两轮因简化夹具缺少历史批准／草稿失败，原失败 JSON 保留；补齐历史前置后通过，未放宽产品检查。

浏览器 CLI 未能连接现有 Chrome；界面工具打开当前控制台只看到登录页，未登录或创建日常样例。因此未完成真实浏览器内逐项旧单操作、宽窄屏全流程、真实供应商调用、最终视频导出及完整恢复矩阵；本报告不声称这些检查通过。未重跑默认全套。

本次原生集群仅监听私有 Unix socket，已停止并删除；临时测试从产品目录移除，源码以 `.txt` 留作复现证据。日常数据库只读、真实付费调用为 0。仅新增本审查目录，保留其他未提交工作。
