# T02 后续票接入契约

## 入口与所有权

`src/productionWorkspace.ts` 只含可共享 DTO 和命令字段白名单。`productionWorkspaceFields` 加入新命令后，`LocalEpisodeCommands` 继续负责严格字段、Owner/session、Origin/CSRF、幂等回执、Episode 可见性与资产根。新票只需由集中 owner 在 `ProductionWorkspaceCommands.execute` 中接入自己的模块，不复制顶层 dispatcher 或授权逻辑。

调用新模块前使用 `lockProductionWorkspace(c,root,episodeId,workspaceId,expectedRevision)`。它在同一已授权 Owner 事务中锁当前行、校验内容 revision、历史/归档/已完成保护、脚本及分镜基准，再读取 SHA/大小验证后的实际 OpenChatCut 工程。调用方收到 `{row,project}`，不得另设可编辑时间线状态。

`updateWorkspaceProject(c,root,row,project,bindings?,reason?)` 写新的不可变 SHA 文件，再以 `row.revision + row.project_sha256` 做 SQL CAS 并记录不可变历史引用。DB 回滚只留下未引用的新快照，旧指针及文件仍可读。函数返回最新 `ProductionWorkspace`。`persistWorkspaceProject` 用于首次创建；`readWorkspaceProject` 用于已验证记录读取。

## 身份与版本

- `workspace.id` 是整期工作空间身份；`scriptRevisionId`、`storyboardPackageId` 固定当前基准。
- `clips[].id` 是片段实例 UUID，`itemId=shot-<shotId>-<clipUUID>` 是真实工程 item 身份；`shotId` 来自分镜，不能用数组下标替代。
- `clips[].source` 是注册来源与 hash/size 的追踪，不是另一套权威时间线。真实 trim、时间、变换、音轨和字幕都从 `project` 读取。T03 可扩展绑定数量，不能重写源文件。
- `project.sha256` 是精确文件字节的乐观版本，`contentSha256` 排除每个 timeline 的 `selectedId/selectedIds`；`revision` 只随内容 SHA 变化。后续批准使用内容身份与实际导出文件 SHA，不能把原生 FNV UI revision 当交付哈希。
- `readiness.deliverable=false` 是本票保守状态；T11 负责最终使用内容、字幕及真实导出检查。占位与不可用已用文件单独列明，编辑许可不等于交付许可。

## 原生 Studio

`openOpenChatCutDraftStudio(root,episodeId,project,sourcePaths,inputFingerprint,config,validateProject)` 与旧严格入口共享同一个真实启动、工程库和快照实现。未伪造 confirmedShots 或放宽旧 renderer 校验。占位是原生 text item，稳定 item ID 绑定保留；真实素材是原生 video item，源音默认静音。

本票在准备页填指定占位前要求保存并退出当前编辑器；活跃会话匹配返回 409，不会背地替换当前编辑。保存后退出经 `closeWorkspaceStudio`，再次打开复用/填充后的原生工程，保留其他 item。

后续 T08/T09 的实时局部采用应由桥把明确补丁交给真实 EditorCommands（见共享 EDITOR-SEAMS.md），先校验当前内容/输入身份，再由原生 flush 和 workspace 保存链收回；不能直接覆写活跃工程。

`validateWorkspaceProject` 当前验证已注册本期 material 来源及真实 runtime 可读性。T05/T06 可在这个集中边界接入已完成任务的 audio_tracks/artifacts 来源解析，不允许 blob/未注册 URL。外部 OpenChatCut checkout 未修改。

## HTTP 与验收

- GET `/api/local/episodes/:id/workspace` 返回 `{workspace}`，无写入；null 表示尚未明确启用。
- GET `/api/local/episodes/:id/workspace/project?sha=<sha256>` 返回 `{project}`，只读当前 Owner 可见的不可变历史版本。
- `prepareWorkspace` 明确启用；`matchWorkspaceMaterial` 只填已有占位；`open/save/closeWorkspaceStudio` 管理真实工程。
- `replanWorkspace` 只接受当前已确认的新脚本/分镜基准、旧 workspace/revision 及明确理由；保留旧版本，不在浏览导航时运行。
- `productionWorkspaceFixture(options)` 供后票使用。传 `migrations` 可追加本票之后的迁移；所有写入在随机独立 DB 和临时媒体根。环境变量 `LOOP_TEST_CONTEXT_MODULE` 只允许显式借用主项目只读 runtimeContext，`LOOP_TEST_OPENCHATCUT_ROOT` 指向已安装 runtime；不能复制或软链日常 deployment。

本票数据库迁移 084，后续票自行使用主 Agent 分配的 085 起迁移编号。所有命令必须在上层 Owner/session 事务内调用，不可将 Store 边界暴露为匿名 RPC。

## 旧版自动继续边界

显式 `production_workspaces` 存在后，旧 v2 `readContinuationSnapshot` 只读投影 `workspace_enabled`，`nextScriptProductionAction` 等待新工作台，不再安排旧 `renderScriptReview` 等动作。原有 enabled、授权、已排队任务均不撤销。执行器提交前重读快照也经过这个保护。

**T05/T13 交接：**启用前已经排队或正在运行的 legacy 任务仍可能迟到完成。它们不得写入/覆盖新 workspace 工程，也不得促成四步交付就绪；后续票须检查 Worker 回写与新工作流接入，不能把本票调度 guard 当作已取消存量任务。
