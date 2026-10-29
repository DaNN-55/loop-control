# T05 口播接入契约

## 身份与权威

工作空间仍只有原生 OpenChatCut 工程这一份编辑权威。逐镜设置复用 `shot_preparation_drafts`、`save_episode_tts_settings` 和逐镜覆盖；Provider、不可变连接版本、声音、语速、语言、预算与 native 输出命名空间均沿用现有 TTS 路径。`workspace_narrations` 仅保存准备/确认/请求/采用身份，不保存另一份时间线。

`workspace.narration[]` 按稳定 `clipId` 返回 `mode=tts|manual|none`、正文、声音、语速、语言、`inputFingerprint`、任务状态、`taskId`、`audioTrackId`、`artifactId`、SHA/大小、实际时长、`adoptedAudioTrackId` 和音频 `itemId`。音频身份是 `workspace-narration-${clip.id}`；源 asset 身份是 `audio-track-${audioTrack.id}`。口播输入指纹绑定脚本/分镜/目标 clip UUID 与当前文本、声音、语速、语言；不会因为其他镜头的材料匹配变化而失效。

匹配确认保存目标 source 指纹作为来源记录。任务请求另记当时 `authorization_hash`、口播输入指纹与工程 SHA/唯一 `native_edit_revision`。该计数器由 T04 提供，只在真正保存原生编辑内容变化时递增；所有首次自动组装共享这一计数器。只要请求时的原生编辑版本未变化且该镜头从未采用，`refreshWorkspaceNarration` 可首次组装；手改过的结果保留为候选。Worker 从不直接修改工程。

## HTTP 命令

所有入口仍经现有 Owner/session、Origin/CSRF、字段白名单、幂等回执、Episode 可见性事务；`workspaceId/expectedRevision` 经 T02 行锁及工程 SHA 验证。

- `saveWorkspaceNarration`：`clipId,mode,text,voice?,speakingRate?,audioTrackId?`。省略覆盖沿用本期默认；人工仅选本期已登记 narration 音轨；关闭不排任务。
- `confirmWorkspaceNarration`：`clipId`。确认当前镜头匹配及口播输入，不授予生产权限。
- `generateWorkspaceNarration`：`clipId,retry?`。要求当前确认、既有已启用且脚本及能力快照一致的制作授权、可执行豆包 TTS/连接、真实 readiness。手工/关闭能力拒绝外部任务。
- `refreshWorkspaceNarration`：无 clip 字段。准备页加载、轮询、重启恢复调用；首次结果安全组装，已有手改不会被重建。
- `adoptWorkspaceNarration`：`clipId,inputFingerprint,audioTrackId`。显式采用当前成功候选；输入不一致或活跃 Studio 返回 409。后续候选改变时长需明确调整，不自动重排已编辑内容。

首次实际音轨时长经文件 hash/大小及 ffprobe 二次核对，转换为向上取整的原生帧数；占位、静帧可调整；视频必须有足够的真实源长与源入点才裁切使用。画面不足返回明确冲突；不删词、变速或循环画面。后续 item 顺移采用真实帧数，不使用旧分镜估计值。

## T04 / T08 / T07

`readWorkspaceNarrationTarget(c, root, workspaceId, clipId)` 从 `src/local-app/workspaceNarration.ts` 导出。返回 `{audioTrackId,artifactId,sha256,durationSeconds,inputFingerprint,itemId}`；只返回当前输入成功音轨，并查文件与 ffprobe；未准备或身份变化返回 409。T04 在 mode 为 tts/manual 时使用此函数冻结目标时长与音频指纹；none 可采用明确的画面时长。

T08 必须冻结 clip/item/source asset 稳定 ID、输入指纹、音轨 ID/源 artifact ID/SHA 与目标时间窗。采用之后字幕证据应由当前音频 item、正文和窗口重新派生；旧证据不能随候选自动提升为当前。不得把音轨注册为伪 material 或 blob URL。

`resolveWorkspaceSource(c,root,episodeId,path)` 是 T02 validator 的统一合法来源解析，支持本期注册 material、真实 `audio_tracks` 与匹配源 artifact、以及已完成任务的允许媒体 artifact 类型。跨期、未登记 URL/blob、损坏 hash/大小均拒绝；原始注册来源身份保留。

## 提交与迟到

`workspace_narration_requests` 为不可变历史请求记录。Worker 在 Provider HTTP 之前以 lease/attempt 验证并持久 reserve；已有提交不会重发，当前正文/声音改变或授权撤销也不能提交旧任务。只有明确 HTTP 4xx 拒绝（408 除外）允许 Owner 显式新任务重试；传输中断、已收但不完整/发布未知保持阻塞，不能换正文绕过。已运行任务可以把旧文件注册为历史，但不会替换新正文、当前音轨或工程，也不会授予交付就绪。

迁移为 087；测试需依次具有 084、086 与 087。deployment-only controlled 模块不能由浏览器命令选择。
