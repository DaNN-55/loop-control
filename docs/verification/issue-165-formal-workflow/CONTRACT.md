# #165 正式四步契约

基线 `35102847`，替代入口决定见 [ADR-0016](../../adr/0016-formal-preparation-lineage.md)。原生工程仍是唯一时间线；本票未修改已安装 OpenChatCut SDK。

## 正式入口

1. Owner 在 `waiting_input` 上传或编辑主脚本后确认；此时允许尚无视觉素材。
2. `prepareWorkspace` 形成不可变制作依据。v2 段落沿用现有 parser；普通脚本使用冻结的 Codex Adapter、模型、Harness、预算和工具，真实 Worker 产出校验通过后才能确认匹配。允许保留画面占位进入剪辑。
3. 首次生成在素材准备中明确提交；剪辑中用相同 Provider/Worker 产生局部候选，只有明确采用改变工程。`openWorkspaceStudio` / `saveWorkspaceStudio` 保留真实 SDK ownership、只读/writable、Owner 与版本 CAS。
4. `exportWorkspace` 检查实际使用的来源和必需字幕，产生真实视频；Owner 确认确切文件身份后，由原 Worker CLI 验证五份交付产物与 manifest，才进入 `production_completed`。

普通规划的 ready/running 请求保持幂等。刷新只返回当前任务状态；失败会显示原因。`retryWorkspacePlanning` 必须携带当前脚本和最新终态任务 ID，才建立新的受配置预算及两次自动尝试约束的请求，关联 `retryOf`，保留原任务与运行记录。不把刷新变成额外模型调用，不重置旧任务尝试记录。

## 制作来源与版本

迁移 `095-formal-workflow.sql` 仅前向应用。`workspace_preparations` 保存实际计划产物和脚本修订；`workspace_shot_inputs` 的键为 workspace、preparation、shot。`resolveWorkspaceShotLineage` 是共同读取入口：`script-segment`、`planner`、`legacy-board`、`local-added`。新增镜头的不可变主脚本基准为空，局部正文单独记录；无口播的 source/none 镜头也不能把 clip.text 写成原脚本基准。

GET 对旧工程只读回退到已有真实准备产物；仅显式 mutation 持锁后补齐输入记录。旧脚本/准备版本的记录保留。任务、预算、lease、已知 ID 查询与提交不确定性的原有规则继续生效，不伪造旧分镜批准。

原生实例保留稳定 clip/shot 身份。统一持久化规范化既有 binding 元数据；旧快照只增加这些已知元数据或 selection 不废弃确认，真正来源、正文、画面、时间线变化仍改变内容版本。文件先写不可变版本，再提交数据库引用，回滚不会覆盖有效版本。

## 字幕与实际主声

显式 native route 的 followText、音轨和时间窗口来自当前实际采用版本，不来自未采用的口播草稿。手工时序与正文核对存入 `workspace_caption_evidence`，绑定当前输入与 native lane 指纹。无显式 route 的旧流程保留原 draft 确认规则。

原生声学对齐复用已安装任务协议，冻结已验证音轨与正文，不改写 draft.current_audio_track。结果取原任务的不可变输出和校验产物，采用仍需当前 workspace 输入匹配。任何 partial、trim 或 retime 的显式主声都拒绝整源对齐，手工校时继续可用；迟到结果不能恢复已变化的证据。关闭字幕须由明确的字幕设置表达，缺失必需时序不会视为关闭。

## 旧工程与迟到结果

首次发现旧 Studio 未提交工作版本时必须明确 `preserve` 或 `fresh`。两者都封存原生文档、持久 store 与 reverseSources 的可核对快照；保留模式导入最新编辑，封存模式另建初稿。封存 SHA 可通过现有 Owner 工程读取接口核对，GET 不迁移、不写恢复文件。

已切换 workspace 的旧 render/QC/publish 结果仍可登记历史文件及账务，但旧 review/approval trigger、旧发布完成函数不能提升当前 workflow。已授权且已提交的未采用候选在交付后完成，保留 task/run/费用/提交记录，不重新开启或自动覆盖已交付工程。此围栏按 workspace 存在与任务协议区分，不全局禁止 legacy。

## 运行与扩展

`lockProductionWorkspace` 是 Owner/current-script/version 共用锁边界；`updateWorkspaceProject` 负责不可变文件、CAS、版本与 lineage 同步；`readProductionWorkspace` 返回统一持久事实。生成模块复用这些入口，不能各建 SQL 时间线或复制持久化协议。视觉来源仍通过 `resolveWorkspaceSource` 校验真实登记与字节；新媒体库资产不能以未登记路径进入 Owner save。

测试 fixture 用同一个只读 exported snapshot 复制 schema 与技术 migration ledger；校验所有已应用 SHA，仅给专属新随机 DB 应用 pending 迁移。精确 083、已升级 084+、并发升级快照、SHA mismatch 均有真实 PG 覆盖。原 runtime/workerPool/testRootParent/portable media 接口保留。不得对日常库执行 fixture DDL/DML，不读取部署秘密或 Keychain。

普通 DEV 四步原型入口和命令已退役；原型源码保留在已归档分支。默认四步导航、列表、待处理筛选和只读历史使用同一持久事实，未采用失败候选不全局阻塞交付；独立 Studio 保留。
