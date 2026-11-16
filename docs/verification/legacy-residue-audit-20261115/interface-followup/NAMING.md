# 清理后函数与接口命名清单

日期：2026-11-15，以 205 后当前源代码、298 个最终 SQL 函数及实际消费者为准。**仍存在旧词，但没有据此发现旧执行入口被重新打开。** 本轮修复调用／异步行为问题，没有批量重命名 TypeScript、SQL 或 HTTP 合同。

## 名实不够清楚，建议后续统一命名

| 当前名称 | 实际职责与消费者 | 建议 | 调整范围 |
| --- | --- | --- | --- |
| `InputRuntime` | `episodeCommands.ts:29` 定义的本机生产运行能力，供当前工作区、媒体、口播、字幕等模块使用，不是旧 Input 制作流程 | `LocalProductionRuntime` | TypeScript 类型及引用的机械改名；不改 API、DB 或运行行为。 |
| `ScriptProductionStore` | `scriptProductionStore.ts:12` 的 `read()` 读取历史保存声明，但 `alias()` 仍为当前 `importMaterial` 写素材显示别名，职责混在同一个类中 | 暂不直接改成 Reader；如后续拆清职责，再将历史读取命名为 `LegacyProductionPlanReader`、别名能力保留独立当前名称 | 不能把整个类当只读或旧代码删除。当前消费者见 `episodeCommands.ts:120`；该文件的 `productionHash` 也是当前共享指纹函数。 |
| `confirm_workspace_plan` | `productionWorkspaceCommands.ts:221` 只确认已存在的旧 planner 审核包，随后进入当前制作基准；不运行 planner | `confirm_legacy_planner_preparation` | 需前向 SQL 迁移、类型生成和后端消费者同步；已有固定运行包／恢复路径也要核对，不能只改名字。 |
| `replanWorkspace` | `useWorkspaceOperations.ts:47` 和 `productionWorkspaceCommands.ts:207` 用于已有工程的明确重新准备，保留版本／脚本基准和历史来源校验；传入旧 `planningTaskId` 会被拒绝 | `reprepareWorkspace` | HTTP 命令、逐次确认、前端调用、回执恢复、测试同时调整；旧幂等回执不能因改名失效。本轮不改 wire 名称。 |
| `DispatchScope.taskId` | `workerDispatch.ts:48` 只作为跳过 planning 扫描的唤醒标记，没有作为 SQL 定向领取条件；scheduler 中会写入 `wake`／`planned` | `skipPlanning` 或明确的 `wakeReason` | TypeScript 调度语义整理。当前行为正确，不应把此字段解释为“只执行该 task”。 |

这些是维护清晰度问题，不是本轮确认的接口漏接或执行漏洞。改名应单独保持事务／回执／恢复兼容，不和此次错误修复混在一起。

## 含旧词，但仍承担当前职责

| 名称／名称族 | 当前含义 | 处理结论 |
| --- | --- | --- |
| `recover_input_tasks`、`input_task_allowed` | 当前 Worker 的租约恢复与任务可用边界，已经包含当前 provenance gate；不是旧自动编排 | 保留。若未来统一名称，必须同步 Worker 端口及准确旧租约的终态核对。 |
| `input_task_connection`、`input_media_connection` | 当前口播／媒体 Worker 的短期凭据读取；要求 service role、准确 lease、当前请求身份和连接资格 | 保留。不能只因 `input` 一词删掉或绕过它们。 |
| `lock_owned_input_episode`、`archive_owned_input_episode`、`delete_owned_input_episode` | Owner 对已登记生产单的当前权限与生命周期控制，仍由当前路由／事务调用 | 保留；旧表名／登记模型与当前运行职责不能混为一谈。 |
| `confirm_legacy_workspace_preparation`、`read_legacy_workbench_source` | Owner 明确读取／接入历史工程的受限桥 | 名称已清楚表达历史用途，保留。 |
| `register_saved_plan_preparation`、`adoptLegacyPlan`、`importLegacyDraftInputs`、`adoptLegacyWorkspace` | 核对原声明、文件 SHA／归属与当前脚本后显式接入，保留原工程；不恢复旧规划、授权或自动生成 | 保留。`saved plan` 是保存的历史声明，不能误读为后台计划任务。 |
| `validate_historical_storyboard_receipt`、`project_historical_storyboard_receipt`、`register_historical_storyboard_receipt` | 旧已领取任务的结果验证／历史投影，不发起新制作 | 保留；历史结果核对不等于旧执行入口。 |
| `generate_a_roll`、`generate_b_roll` 与 `block_exhausted_a_roll_task`、`release_b_roll_task_lock` | 稳定任务／策略协议仍被当前统一画面执行器和完整性保护使用 | 保留内部协议；当前界面仍按“镜头／画面”表达，不以旧类别限制模型。 |
| `invalidate_revised_storyboard_dependents` 等历史约束 trigger | 保护已保存来源、失效关系和冻结证据 | 保留实际 trigger／函数依赖，不把没有普通角色 EXECUTE 当作可以删除。 |
| `Studio`、`studioRuntime`、`openWorkspaceStudio`、`openStandaloneStudio` | 当前 OpenChatCut 编辑器及会话能力 | 不是旧流程名称；与已经拒绝的 `openStudio` 旧命令区分。 |
| `LegacyProductionSteps` 文件中的 `LegacyPreparation`／`LegacyEditing`／`LegacyDelivery` | `ProductionWorkspacePanel` 使用的历史内容展示与接入面板 | 保留其历史职责，不把文件名当作仍有旧制作页可执行。 |

## 只是普通业务词，不属于旧流程残留

- `save_production_caption_input`、`save_production_narration_input`、`workspace_visual_execution_input`：`input` 表示当前冻结制作输入。
- `fingerprint_media_root_plan`：`plan` 表示文件存储迁移／盘点计划，不是内容规划。
- `preparationRevisionId` 与兼容 DTO 中的 `storyboardPackageId`、`boardId`、`storyboard/v1`：涉及来源身份和历史解码。它们不应仅为了去掉旧词而改写已保存 JSON、任务快照或 SQL 账本。

词法筛选共有 **29 个 SQL 函数**命中 `input/storyboard/legacy/plan/studio/a_roll/b_roll` 等词，完整名单和角色可调用性见 [sql-name-inventory.json](sql-name-inventory.json)。这 29 项不是“29 个待删除函数”；上表按真实职责区分了命名维护项与必要保留项。
