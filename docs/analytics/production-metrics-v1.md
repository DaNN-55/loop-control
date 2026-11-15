# 第14项 A/B：生产统计口径与只读数据映射

日期：2026-11-13。状态：A/B 的统计合同及只读实现；不是新增采集或 Dashboard。实现位于 `src/local-app/productionMetrics.ts`，不替换 `episodeMetrics.ts`，不接入页面、路由、定时任务或生产写入。

用户决定：第15项搁置，未来可基于本合同补充；第12/13/16/19项跳过；第17/18项等待第14项整体完成。本次 A/B 完成不代表后续缺口采集已经完成，也不自动启动第17/18项。

## 范围与时间

- 数据范围：当前数据库中此 Owner 可见且仍保留的 `public.episodes` 及关联事实。通过现有 Owner 只读事务和成员归属限制读取，默认排除 `is_test=true`，可显式包含测试单。没有权限的 Owner 不会得到其他账号数据。
- 已归档或回收但仍可见的记录不因页面筛选而自动丢弃；独立历史资料库、已经物理删除的记录不在本汇总中。不能宣称覆盖全部历史生产量。
- 输入为北京时间自然日期 `from`、`toExclusive`，半开区间 `[from 00:00, toExclusive 00:00)`。数据库时间保存/比较为时间点，日期分组固定 `Asia/Shanghai`；其他部署不直接替换为宿主时区。
- 例如 2025 年 11 月：`from=2025-11-01`、`toExclusive=2025-12-01`，对应 UTC `[2025-10-31T16:00Z, 2025-11-30T16:00Z)`。
- 每次读取采用同一 `REPEATABLE READ READ ONLY` 快照和数据库观察时间。尚未结束的区间截到观察时间，输出 `complete=false`。尚未开始的统计窗口拒绝执行。
- 只接受 1～366 天；每类事实最多读取 100000 行，超过上限明确失败、不返回截断的假总数；每条 SQL 设置事务内 10 秒超时。没有验证高峰生产负载，后续第18项需实际测量。

## 指标合同及数据映射

| 指标/输出字段 | 统计单位与时间归属 | 当前来源 | 限制 |
| --- | --- | --- | --- |
| `production.episodesCreated` | 生产单 ID；创建时间落在窗口 | `episodes.id/created_at/account_id/is_test` | 现存可见记录，不重建已删除单 |
| `production.firstDeliveredEpisodes` | 同一生产单只计一次；首次成功交付时间落在窗口 | `workspace_deliveries.task_id → tasks`，限定 `prepare_publish_package + completed`，取每单全部已完成记录的最早 `completed_at` | 不能用排队时间、导出确认时间或 `episodes.updated_at` 替代；重复交付不增加首次产量 |
| `production.completedDeliveryJobs` | 交付任务 ID；完成时间落在窗口 | 同上，`task_id` 唯一 | 同单多次成功交付单独计交付次数，与首次产量分开 |
| `tasks.created` | 任务 ID；任务创建时间落在窗口 | `tasks.id/created_at` | 不是执行次数，更不是供应商 HTTP 请求数 |
| `tasks.generationTasksCreated` | 现有生成任务类型，排除人工上传、Pexels/Freesound 检索及原声/预览/渲染等类型 | `tasks.task_type/provider/input_snapshot.capability` | 生成任务不等于付费或已发送；完整类型名单在实现中固定 |
| `tasks.retryLinkedTasksCreated` | 明确带原任务关联的新任务数；新任务创建时间落在窗口 | 画面/口播请求 `request_snapshot.retryOfTaskId`，用 EXISTS 查询 | 是明确关联的替代/重做，不是所有返工，也不是同一任务的 attempt 重试 |
| `tasks.createdCohortCurrentStatuses` | 在窗口创建的任务的**查询时状态** | `tasks.status` | 不代表历史月末状态；重试可能清空 `tasks.completed_at`，不能用当前行重建所有失败 |
| `attempts.started` | `(task_id,attempt)`；`task_runs.started_at` 落在窗口 | `task_runs` 唯一键 | 不以缺少运行行的任务快照补造 attempt；轮询、刷新、重开均不增加 |
| `attempts.finished/finishedOutcomes` | `(task_id,attempt)`；`task_runs.completed_at` 落在窗口 | `task_runs.completed_at/status` | 与开始 cohort 分开，跨月尝试可在不同月份分别开始和完成 |
| `attempts.successRateKnownOutcomes` | 已结束且明确 completed 的数量 / 已结束且明确 completed 或 failed 的数量 | 上一行 | 空样本返回 null；其他结果单列，不强行归为失败或成功 |
| `attempts.durationSeconds` | 窗口内完成尝试的完整起止时长，非裁剪片段；P50/P95 使用 nearest-rank | `task_runs.started_at/completed_at` | 输出有效样本数；负时长排除，不把未结束尝试当已完成 |
| `time.recordedRunSlotSeconds` | 所有可确认运行区间裁剪到窗口后相加 | `task_runs` 起止 | 包含等待外部 API 的时间，不是 CPU/GPU 实耗；历史运行缺口不能补成零 |
| `time.recordedRunUnionSeconds` | 同一 Owner 的上述区间合并重叠后计墙钟时间 | 同上 | 与累计槽位时间不同，也不同于既有逐单 `workerRunSeconds` 的汇总 |
| 活动/不完整运行区间 | 无结束时间时，只有 task/run 均 running 且 lease 匹配，才截到观察时间 | `tasks.status/lease_token` 与 `task_runs.status/lease_token` | lease 不输出；不活动且未结束的运行只计缺口，不推测结束时间 |
| `money.reportedPositiveCentsForStartedAttempts` | 窗口内开始的 attempt 所上报的正金额小计 | `task_runs.actual_cost_cents` | 上报金额不是供应商实付账单；有正金额又有未知项时仍只是部分小计；全为未知时返回 null |
| `money.unpricedGenerationAttemptsStarted` | 潜在外部生成且上报金额为零的开始尝试数 | 任务类型、Provider、`task_runs.actual_cost_cents` | 零不能证明免费；Provider 缺失也不自动当免费。人工、受控、本地工作不伪装为外部扣费 |
| `money.grossReservedCentsCreated` | 新预留记录按 `task_id` 一次计入；预留创建时间落在窗口 | `paid_generation_reservations.task_id/created_at/reserved_cents` | 毛预留，不是消费、净冻结或余额；与 attempts 分开查询，避免多次尝试放大金额 |
| 请求/发送/提交状态分布 | 窗口内创建的预留记录的**查询时快照** | `request_state`、`provider_dispatch_observation()`、旁白/画面 submission outcome | 原字段分别输出，不把 succeeded、received 或未发送自行翻译成账务结算；缺字段标记 not_recorded |
| `candidates.retainedDecisionRecords/firstRecordedDecisions` | 现存候选首次决策行，按其创建时间 | `workspace_candidate_decisions` | PK 为 `(workspace_id,candidate_id)`，写入为 ON CONFLICT DO NOTHING，且存在删除路径；不代表完整采用、撤回和重做流水 |
| `byDay` | 北京时间自然日的创建、首次交付、尝试开始/完成 | 上述各自时间归属 | 不混用创建月和交付月 |
| `byService` | 账号 ID、任务类型、Provider、模型下的开始/完成尝试 | `episodes.account_id`、`tasks`、`task_runs` | 不按当前下拉框、当前蓝图或供应商账单维度推测 |

该合同中的费用单位标为 `application_cents`，沿用现有应用金额字段。行级币种及供应商实付对账事实不足，不承诺多币种合计或人民币实付总额。未来不得把此正金额小计直接标为“实际总消费”。

## 本轮无法可靠汇总的内容

以下输出保留 null/缺口说明，不用 0 代替。它们构成后续 C 阶段的候选范围，而非本次采集授权。

| 内容 | 现有事实及缺口 | 建议与实际影响 |
| --- | --- | --- |
| 每阶段停留、人工等待 | 当前阶段及零散审计不能自动证明完整阶段事件链 | 后续核对状态事件覆盖；现在不输出看似完整的阶段耗时 |
| 每次重试的排队等待 | 有任务创建/可用/领取及 attempt 开始，但没有每次排队的完整不可变事实 | 不用最新 `claimed_at - created_at` 冒充逐次等待；会影响后续瓶颈定位精度 |
| 供应商 HTTP 请求数与单次外部等待 | task/attempt 可能包含未发送、轮询、批次和恢复；提交阶段的更新时间可被覆盖 | 不用 attempt 数当 HTTP 请求数；后续需要明确提交/响应事实 |
| 实付、释放与结算 | 有预留和应用上报金额，缺少完整结算/释放时间与币种事实 | `supplierPaidCents/releasedCents` 保持 null，不把预留当实际消费 |
| 统一估算总额 | 既有 `episodeMetrics.ts` 可按部分冻结确认或当前费率估算，但确认绑定完整性、批次/尝试归属须另外核对 | 本轮 `estimatedCents=null`，保留原列表估算不变；避免批量累加或把今天费率当历史报价 |
| 完整采用率/返工率 | 当前选择、首次决策、撤回和替代关联不是同一完整事件流水 | 只输出已有记录与明确 retryOf，完整采用/返工统计留空 |
| 整单低/中/高质量 | 没有统一业务质量档；图片 quality 是供应商参数 | `businessQualityTier=null`，不把图片 quality 强行当整单质量 |
| CPU/GPU/内存、真实可生产量 | 运行时段不是资源采样，也未做真实供应商峰值生产 | 不据此直接调整并发或承诺日产量，第18项另验 |
| 历史月末状态、删除单及独立历史库 | 当前可见行不等于完整历史快照 | 范围显式标注，不补造过去的计数 |

## 使用方式与边界

供后续已经认证的服务端调用；Owner ID 必须来自认证会话，不能直接信任请求传入的 ownerId：

```ts
import {readProductionMetrics} from './productionMetrics.js';

const summary = await readProductionMetrics(appPool, session.id, {
  from: '2025-11-01',
  toExclusive: '2025-12-01',
  includeTestEpisodes: false,
});
```

实现使用现有 `ownerTransaction(..., true, ...)`，检查实际 Owner 上下文与只读事务。任务、运行、预留、交付和候选分别读取，避免多表 join 的行数放大；返回聚合数据，不返回正文、凭据引用、lease、素材路径或原始请求。

当前没有新增 API 或 CLI 默认连接，也没有启动此函数读取日常库。将来 Dashboard 可消费 `production-metrics/v1`；若修改分母、时间或金额定义，应升级合同版本，不能静默改变历史报表含义。

## 验证与后续顺序

在从版本化 SQL 新建的专属无网络 PostgreSQL 容器中，以合成非空记录验证 Owner 隔离、测试单过滤、跨月边界、重复读取、重试/预留去重、首次与重复交付、重叠时段、未知费用及零业务写入。查询前后比较任务、尝试、预留、生产单、候选、交付和回执行内容；只读事务实际拒绝 UPDATE。不连接日常数据库，不调用供应商或校时模型。

后续先由用户决定 C 阶段需要补哪些缺口，再锁定来源写入边界、不可变 ID 和迁移编号，在同一业务事务内落实幂等采集。第15项仍搁置；本轮不因有了读模型就提前迁移组件或做产能调参。
