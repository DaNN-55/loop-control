# T12 精确导出交付契约

## Owner 命令

所有命令沿 `/api/local/episode-commands`，继承 Owner/session、Origin/CSRF、字段白名单、幂等回执及 `lockProductionWorkspace` revision CAS。

| 命令 | 额外字段 | 行为 |
| --- | --- | --- |
| `prepareWorkspaceDelivery` | `exportId,expectedExportSha256,expectedContentSha256,title,description,tags,coverBase64` | 调用 T11 `requireConfirmedWorkspaceExport`，冻结已确认视频、导出时完整工程、交付输入和证据，排真实持久 Worker 任务 |
| `retryWorkspaceDelivery` | `deliveryId` | 仅重试当前相同已确认导出的 failed/blocked 交付；新建任务目录，保留原输入和旧文件 |

共同字段为 `episodeId,workspaceId,expectedRevision`。返回工作空间 `deliveries[]`，最新在前；每项包含 `id,exportId,taskId,status,error,verified,artifacts,createdAt`。HTTP 200、ready、running 均不代表生产完成。

`requireConfirmedWorkspaceExport` 返回的 `artifact/project/projectContentVersion/contentSha256/checks` 是唯一包输入。保存选择状态导致当前工程字节变化时，仍使用导出时 `confirmed.project`；任何不同导出都必须重新确认。交付 Worker 没有渲染或外部社媒发布路径。

## 包版本与下载

历史 `publish-package/v1` 的四类产物及固定路径验证保持原行为。新 `publish-package/v2` 必须恰有 `final_render,editable_project,cover,metadata,final_qc_report` 五项，清单作为第六类下载文件。清单 `identity` 绑定工作空间、exportId、内容版本/SHA 和确切视频/工程路径、SHA、大小。新清单使用任务的不可变 `episodes/:episode/workspace-deliveries/:taskId/manifest.json`，不会复用旧包。

生产者与 `verifyPublishPackage` 同步识别 v2：核对全部普通单链接文件的存在、大小、SHA 和 Episode 归属，实际解码封面，检查完整 native project、元数据、通过的技术证据及证据引用的实际来源/代表帧。少工程、封面或元数据、文件变化均失败。完整工程和所有包文件通过现有 Owner `/_local-artifact` 入口取得；不会公开临时 native outputLocation。

元数据按已确认工程中实际使用的主声音轨解析 `audio_tracks` 和不可变任务正文。T08 `workspace_candidate_decisions` 存在时，采用记录须匹配实际 trackId、SHA，原生 candidate marker 存在时还须匹配 inputFingerprint；`text_version/main_script_text` 为采用正文和基线。未采用的 mutable draft 不参与。无采用正文的人工音轨明确保留 `null/not_recorded`。

每项口播保留 `baselineText,sourceText,adoptedText,textSource,textCoverage,sourceDiffersFromBaseline,differsFromBaseline` 及实际来源/track/SHA。`windows` 记录实际源入点、使用时长、源覆盖时长、播放速率和 fps，传播嵌套序列裁切/速率。只有单个可听、原速、完整源窗口才把来源正文作为确定 `adoptedText`；部分、变速、静音或无法核验时为 `partial_or_retimed_unverified` 或 `no_recorded_text`。这不是语音识别逐词证明。

## 持久 Worker 与完成状态

迁移为 `094-workspace-delivery.sql`；沿现有 `prepare_publish_package` 任务、原 claimant、lease、task_runs 与结果协议执行独立 CLI Worker。`local_identity.workspace_deliveries` 只连接不可变交付身份与真实任务。Owner 命令不插入伪 completed 任务。

Worker 生成并验证 v2 包后报告真实结果，数据库在同一事务再次检查最新已确认导出、当前内容/脚本/分镜及未解决或后续问题，核对冻结输入与报告身份，再登记结果、产物、`production_completed`、state transition 和 `publish_package_verified` 审计。旧导出的晚到报告只能失败，不能切换成新视频。租约过期沿原恢复路径，显式重试仍冻结原输入。

刷新读取时重新验证已完成包；外部丢失或破坏文件会显示 `verified=false` 和错误，不抹掉历史已完成任务/审计，也不假装文件仍可交付。

## 隔离验收

`productionWorkspaceFixture` 的 migration union 去重并追加 094。真实 Owner HTTP、随机 PostgreSQL、原生工程存储/渲染、Worker CLI 与文件成功/失败链见 REPORT。CLI 测试的短时 loopback 随机 TCP 转发在 startup 层只接受本次确切随机 DB 和 `loop_worker`，拒绝其他角色、库和启动选项，finally 关闭；不读日常密码，不改角色、pg_hba 或集群认证。
