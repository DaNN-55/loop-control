# 最小可观测性接通与隔离验证

日期：2026-11-16（Asia/Shanghai）。本报告按阶段记录首轮实现、只读追查及后续独立整合。未部署或开启日常采集，未修改日常连接、数据库、规则、根 PLAN.md 或共享 SDK；提交与 main 整合结果见末节。

## 可使用的入口

在仓库根目录先编译本地后台，再显式指定 Owner 与北京时间日期范围：

```sh
npm run backend:build
node scripts/production-metrics.mjs --owner <Owner-UUID> --from 2026-11-01 --to-exclusive 2026-11-17
```

日期范围为 1–366 天，结束日期不包含在内；默认排除测试生产单。`--include-test-episodes` 显式纳入测试单；`--deployment /absolute/path/deployment.json` 可指定隔离配置。结果输出到 stdout，失败返回非零退出码。`--help` 不读取数据库或凭据。

命令默认只读正式 deployment 配置，仅解析应用数据库凭据，以 `loop_app` 和显式 Owner 的 repeatable-read/read-only 事务调用现有 V1/V2 汇总。不调用 `readDeployment` 的恢复流程，不启动服务、生成、迁移、采样、清理或自动解锁 Keychain，也不解析 Worker 凭据。

输出含：

- `collection`：未安装 / 关闭 / 开启；窗口内活动事件数与覆盖区间；所选 Owner 的资源采样配置和样本数。配置已开启、零样本不被解释为采集健康；本入口不声称观测到采样进程健康。覆盖观察快照不计作制作活动事件。
- `summary.retained`：既有业务事实汇总；任务累计与区间并集分别保留，不能视为供应商净时或人工劳动。
- `summary.collected`：原有阶段、排队、候选、声音、导出、费用依据、质量和资源采集汇总。关闭期间的旧数据不被清零或补造。
- `definitions`：阶段经过时间、导出流程时间及费用证据的边界。导出时间包含检查和文件登记；预留、估算和任务上报均不等于供应商实扣，未知金额仍为 null。

## 日志改动

固定当前命令和其他实际路由的名称。已通过命令白名单校验的操作记为 `episode.<command>` / `account.<command>`。初始事件保留 HTTP requestId，业务校验后在结束 / 中断事件附加账号、生产单、工作区及可证明的镜头、任务身份；不从原始 URL 或正文猜测归属。

通过请求内 AsyncLocalStorage 传播轻量上下文，不改变命令签名、业务权限、回执、执行快照或 Worker/Provider 协议。身份来自既有拥有者查询、锁定工作区、镜头绑定和入队 SQL 的返回值，无新增业务查询。幂等回放只使用匹配 Owner/内容的既有回执恢复其中可证明的关联，不重新执行命令。

单任务使用 `taskId`；一条命令产生多个相关任务时使用去重的 `taskIds`，最多 16 项，超出显式标注 `taskIdsTruncated`。日志不是事务提交、有效产物或供应商收费的证明。日志 sink 抛错继续被隔离；未修改已有 Provider 未知结果、幂等、lease 或 Owner/只读保护。Freesound 适配器、连接、重试及兜底均未改变。

## 验证结果

隔离环境是本任务新建的 PostgreSQL 17 集群，使用独立临时目录、socket、loopback 端口和角色；schema 从仓库建立，没有连接日常数据库或复制日常业务记录。全部启用操作只发生在该临时集群。测试文件自行清理创建的数据库、HTTP 服务和媒体。

| 检查 | 结果 |
|---|---|
| 本次相关单元用例 | 38/38 通过（日志、CLI 参数、请求保护、V1/V2 汇总、资源采样） |
| 新增真实 CLI/HTTP 集成 | 3/3 通过 |
| 既有指标隔离集成 | 25/25 通过，含覆盖停启、Owner/lease、声音使用、并发导出、质量冻结、重试及响应写入失败不重发 |
| 后台编译、完整 TypeScript 检查 | 通过 |
| `git diff --check` | 通过 |
| 全量非集成单测 | 2272 通过、3 失败，见下方限制 |

新增集成验证亲自执行真实导出命令：读取前后所有 public/local_identity/loop_internal 表的行数及内容摘要一致，关闭采集时没有新增 controls/events。验证外部零上报成本仍为未定价、任务累计 40 秒与并集 30 秒分别呈现、其他 Owner 看不到目标任务、Worker 角色无法读取该汇总、只读事务不能更新任务。另验证开启但窗口内无活动也不被说成关闭或健康。

HTTP 验证包含账号和生产单命令、工作区/镜头关联、非法和越权请求不带目标身份、并发请求上下文隔离、日志 sink 失败不改变 HTTP 结果。真实生成确认只入队，不调用 Provider；结束日志中的 taskId 与 SQL 实际生成的任务相同，重复确认不新建任务，也没有 task run 或采集事件。

初始失败用例证明了缺失的路由/上下文、只读 CLI 及幂等回放关联。中途修正了新增代码的类型收窄、测试 SQL UUID 类型和测试确认请求字段，未跳过测试、降低校验或修改既有统计语义。

## 性能与存储

业务路径没有新增 SQL 往返、指标事件、采样周期或依赖。保留既有资源采样与保留策略，查询继承现有每类 100000 行上限，超出时缩短日期窗口。本轮没有供应商费用/用量新表、后台轮询或人工活动采集。

空载 loopback HTTP + JSON 序列化微测，原日志和本次实现分别测 500 个请求，均为每请求 2 条日志：p95 约 1.70 ms / 1.63 ms；包含账号/生产单/工作区/镜头关联的样例每请求序列化大小从 674 B 到 926 B，约增加 252 B。这个测量仅检查本地日志边界，不包含真实磁盘 sink、数据库、供应商或生产负载，不能作为容量或线上性能承诺。

## 验证限制与工作区保护

全量单测三项失败位于本轮未修改的界面测试：

- `ProductionWorkspacePanel.completed.test.tsx`：切换工程后 dialog video 的断言；单独复跑通过。
- `WorkspaceVisualPreparation.upload.test.tsx`：图片候选预览按钮断言；单独复跑通过。
- `ProductionWorkspacePanel.legacy.test.tsx`：寻找 `剪辑工作台` 按钮的断言；单独复跑仍失败，未纳入本次修复。

不能将全量回归报告为全绿。没有新增页面，因此未执行浏览器视觉验收；没有执行真实供应商付费调用、日常启用或部署验证。

开始时保留了 108 个既有跟踪文件改动及目标文件原文。在执行中检测到额外的模板/界面并行修改（包括与本任务共用的工作区命令文件），未回退、重排或提交这些内容。私有 before/after 比较可能同时包含并行改动，不应作为本次独占差异；本次仅拥有只读导出、日志上下文及其验证/文档。

私有证据目录：`/Users/dan/.codex/visualizations/2026/11/16/01a1e21d-f3a0-79f3-b30d-0a4f0cc37b16/observability-minimal/`。主要记录为 `focused-unit.log`、`integration.log`、`report-integration.log`、`backend-build.log`、`check-final.log`、`unit.log`、`unrelated-ui-repro.log`、`performance.json`。临时集群在收尾时关闭并删除，清理结果见 `cleanup.json`。

## 后续只读核查：legacy 界面测试与启用条件

2026-11-16 11:04（北京时间）核查：原失败是旧测试选择器与已完成作品查看流程不一致。`ProductionWorkspacePanel.tsx` 对 completed 视图不再提供顶栏第 3 个“剪辑工作台”按钮（`completed && index === 2`）；legacy 分镜台内提供“查看剪辑工程”，进入后提供“返回分镜台”。旧断言仍按 `/^剪辑工作台/` 寻找按钮，因此在执行后续工程查看断言之前失败。

工作区中的并行界面工作已更新该测试，当前 legacy 文件 11/11 通过。本轮没有修改 UI 或该测试。在私有目录重放 git 中的旧测试，仍复现同一旧按钮选择器失败；同时对日志上下文和只读汇总模块设置“若被 UI 导入则抛错”的 mock，未触发这些模块。该用例以 mocked fetch 和 command 运行，不会执行新增后台日志或数据库汇总路径。因此原失败属于独立界面调整后的旧断言，不由本次可观测性改动引起。核查期间两份工作区 UI/测试文件哈希保持一致；证据在 `legacy-repro/diagnosis.json`、`legacy-repro/repro.log` 和 `legacy-diagnosis-current.log`。这不等于当前整个混合工作区已重新做过全量验收。

同次只读核对日常数据库：controls、已启用 Owner、覆盖区间、事件、资源样本均为 0；deployment 未配置资源采样。正在运行的 release `3eb52fbc…` 不含本次新增 report 和日志上下文实现。当前 `codex/completed-works-review` 与 `main` 的提交头均为 `16f1645d…`，本次改动仍未提交，不能以一次 merge 将工作区内容自动纳入 main。

隔离环境已经验证开启后的事件、资源样本及实际导出等路径，但日常启用后的闭环尚未验证。后续顺序应为：整理并保留并行变更，形成已审查的固定版本并完成最终回归；整合 main；在没有活动任务时更新实际运行构建并核对 release；显式开启 Owner 事件采集，如需资源指标则再配置同一 Owner 的运行时采样；用正常制作活动核对新覆盖起点、事件、样本、日志和只读汇总。新日志/只读入口本身不要求启用采集。本轮没有执行提交、合并、部署、启用或任何生产数据写入。

## 独立 main 版本最终回归（新增提交授权）

用户随后明确授权单独整理本次改动，最终回归后提交并合入本地 main，继续禁止部署、启用日常采集或推送。

以 `main=16f1645d74374a821ae9a21e8c528f6fe292a200` 新建独立工作树，从首轮 before 快照逐块提取本次改动。排除全部 UI/完成作品改版、模板设置、旧流程清理、数据库迁移和 SDK 修改。`episodeCommands.ts` 与 `workspaceAudio.ts` 按主线原有业务结构仅移植日志；旧命令处理、输入与费用语义保持主线原样。原工作区没有 stash、整文件覆盖或全量暂存。

最终验收针对这份独立版本：

| 检查 | 结果 |
|---|---|
| 全量非集成单测 | 303 文件、2210/2210 通过 |
| 日志/只读汇总及关联指标集成 | 29 个用例通过：准备隔离运行时后原有 28 个通过，保留事实汇总用例修正测试输入后通过 |
| TypeScript、前端构建、后台编译、Worker 编译 | 通过 |
| 独立运行构建准备 | 通过；只在临时工作树创建，不是日常部署 |
| 差异与代码审查 | 通过；只包含日志、只读入口、相关测试、构建入口及本报告/计划，无新增依赖、权限、迁移或采集开关写入 |

集成初跑因新工作树缺少 SDK/准备构建而有环境失败；随后使用工作树自有 SDK 源码副本和临时运行构建，未修改共享 SDK。额外的既有 `productionMetrics.integration.test.ts` 漏传 `reviewPackageId`，在完全未修改的 main 工作树同样于准备阶段报 `Owned confirmed script required`。仅补入夹具已有的 `f.board`，让测试走其原有制作基准；未修改断言、业务代码或权限保护，完整用例随后通过。

这份独立 main 版本没有混合工作区中的 UI 失败；原工作区其他未提交功能仍应由其各自任务验收。证据目录为前述私有目录下 `integration-main/`：`unit.log`、`build.log`、`backend-build.log`、`worker-build.log`、`runtime-prepare.log`、`integration-final.log`、`retained-baseline.log`、`retained-final.log`、`check-final.log`、`scope.json` 和 `staged.patch`。
