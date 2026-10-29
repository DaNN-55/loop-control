# T11 最终导出与精确确认契约

## Owner 边界

新命令沿 `/api/local/episode-commands`，继承 Owner/session、Origin/CSRF、幂等回执、Episode 可见性、资产根与 `lockProductionWorkspace` 的 revision CAS。必须保存并退出 Studio 后执行检查。新工作空间不进入旧 `confirmedShots`、先 QC 批准再生成 final render 的历史路径。

| 命令 | 额外字段 | 行为 |
| --- | --- | --- |
| `exportWorkspace` | 无 | 实际使用内容与必要字幕检查 → 真实原生 MP4 → 技术检查 → 不可变文件及检查证据 |
| `confirmWorkspaceExport` | `exportId,expectedExportSha256,expectedContentSha256` | 只确认当前最新导出、当前内容版本、这份文件的精确字节；再次核对来源及必要字幕 |
| `recordWorkspaceExportIssue` | `exportId?,reason` | 保留问题；未解决问题阻止确认，后续问题要求重新确认 |
| `resolveWorkspaceExportIssue` | `issueId` | 保留原问题并写解决时间 |

共同字段为 `episodeId,workspaceId,expectedRevision`。导出失败返回持久化工作空间，`exports[0].status='failed'`，保留 `checks` 诊断；200 只表示操作与诊断保存成功，不代表视频可交付。重试追加新记录，先前确认和失败仍保留。

GET workspace 增加 `exports[]` 与 `exportIssues[]`，最新记录在前。`current` 比较最新记录、持久内容版本与内容 SHA；`confirmed` 还要求精确文件可读、实际输入仍就绪、无未解决或晚于确认的问题。选择保存只改变工程字节 SHA，不改变 `revision/contentSha256`，因此保留确认；内容编辑或新导出使旧确认不可继续使用。

实际 MP4 通过现有 `/_local-artifact?episode=...&path=...&sha256=...` 读取；`episodeReads.findOwnedInputFile` 根据导出表中的精确路径/hash/size 解析，并复用 Owner、单链接普通文件、资产根、内容 hash、Range 边界。不会把临时 native outputLocation 当作生产文件。

## 实际使用内容

`usedWorkspaceContent` 从 active timeline 遍历实际播放区间及 `sequence.timelineId` 引用，检查循环与缺失序列；忽略未引用的 pool 与 unreachable timelines。嵌套裁切按 `srcInFrame/playbackRate` 传播。来源由 T05 `resolveWorkspaceSource` 解析已注册材料、匹配原产物的 audio_tracks 或已完成任务媒体；复制到 native runtime 后再次核对 SHA/大小，不能以路径存在代替指纹。

已用占位、无来源媒体、缺文件或文件变化、必要字幕无当前时序/正文证据阻塞。字幕从 `readWorkspaceCaptions` 动态读取，只检查实际已用 item 的启用字幕；不维护另一套字幕时间线或固定每个视觉 binding 的音轨数量。废弃失败候选不进入此门槛。打开/保存 workspace Studio 同样仅验证实际使用来源，未使用的坏候选不阻止继续编辑。

原生渲染 spec 同时提供完整 `project`、active `state` 与 `timelineId`；仅传 project 不满足 native `/export` 协议，仅传 active state 丢失 nested sequences。返回 bytes 被写到 `episodes/:episode/workspace-exports/:exportId/:sha256.mp4`，使用 `wx` 登记，stdout 或请求成功不作为完成证据。

## T12 消费

```ts
const {row,project}=await lockProductionWorkspace(c,root,episodeId,workspaceId,expectedRevision);
const confirmed=await requireConfirmedWorkspaceExport(c,root,row,project);
```

函数位于 `src/local-app/workspaceExportCommands.ts`。返回 `WorkspaceExport & {artifact: WorkspaceExportArtifact}`：

- `id,projectContentVersion,contentSha256`：精确导出记录与持久内容身份。
- `artifact:{relativePath,sha256,fileSize}`：最终 MP4 的实际字节身份。
- `project:{relativePath,sha256,fileSize}`：导出时的不可变完整 native project。之后 selection-only save 产生不同 project 文件 SHA 时，仍以此导出时工程为包内来源。
- `checks`：实际来源、必要字幕、技术检查、代表帧与文件登记证据。

函数拒绝旧导出、旧内容、未确认、未解决/后续问题、丢失/篡改 MP4 或工程，并重新检查当前实际来源与必要字幕。T12 直接消费已确认 MP4 与工程，包校验前应继续按精确身份读取，不得再渲染一份视频。T11 不创建发布包，不写 `production_completed`。

迁移为 `093-workspace-export.sql`。测试夹具通过 `migrations:['db/local/093-workspace-export.sql']` 显式追加，不运行日常迁移。全新隔离数据库用于迁移演进后的验收。
