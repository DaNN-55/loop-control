# T05 口播接入契约

## 身份与权威

工作空间仍只有原生 OpenChatCut 工程这一份编辑权威。逐镜设置复用 `shot_preparation_drafts`、`save_episode_tts_settings` 和逐镜覆盖；Provider、不可变连接版本、声音、语速、语言、预算与 native 输出命名空间均沿用现有 TTS 路径。`workspace_narrations` 仅保存准备/确认/请求/采用身份，不保存另一份时间线。

`workspace.narration[]` 按稳定 `shotId` 返回 `mode=tts|manual|none`、正文、声音、语速、语言、`inputFingerprint`、任务状态、`taskId`、`audioTrackId`、`artifactId`、SHA/大小、实际时长、`adoptedAudioTrackId` 和音频 `itemId`。音频身份是 `workspace-narration-shot-${shotId}`；源 asset 身份是 `audio-track-${audioTrack.id}`。口播输入指纹绑定脚本/分镜/目标 shotId 与当前文本、声音、语速、语言；不会因为其他镜头的材料匹配变化而失效。

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

## 最终 canonical 镜头身份（T03 合入后的覆盖契约）

`shotId` 是主声的业务身份，visual `clipId/itemId` 是可删除的范围实例。087 的状态表唯一键为 `(workspace_id,shot_id)`，请求冻结 `shot_id`；`clip_id` 仅保留当时定位上下文。每个 shot 只返回一项 `workspace.narration`；该项 `clipId` 是当前可用于 HTTP 定位的某个 visual 引用，不是主声身份。

canonical 音轨 item 为 **`workspace-narration-shot-${shotId}`**，素材池 asset 仍为 `audio-track-${audioTrackId}`。任意当前 visual clip 的 `readWorkspaceNarrationTarget` 都先解析到 shot 并返回同一实际主声。口播输入指纹绑定 workspace 固定脚本/分镜、shotId 与实际声音输入，删除或重排首 visual range 不改变正文/任务/音轨身份，也不再次提交 Provider。尚在测试环境使用早期 checkpoint 087 的消费者须新建 fresh fixture，不能当作旧表已自动升级。

初次组装按同一 timeline 的 shot visual items 聚合 `[min(start),max(end))`。单范围可按足够的真实源长安全裁切；多范围只在聚合时长等于完整主声时绑定一条音轨，时长不符明确返回 409。已采用后若范围改变导致不符，读投影返回 `status=duration_conflict` 与具体提示，保留唯一主声和原正文；不得为了消除提示重发 TTS、截词或给每个范围复制整段音频。

T04 的 `workspace_image_requests.duration_seconds` 为原生实际使用窗口，`provider_duration_seconds` 为符合现有注册 Provider 上下限的整数生成窗口；`narration_target` 冻结音轨 ID、artifact ID、SHA、输入指纹及实测时长。回填再次核对当前主声身份。UI 在提交前显示“使用 2.40 秒 · 生成 4 秒”；超过服务上限明确阻塞，音轨保持原速和完整正文。

## T10 / T13 明确接续边界

T07 现已优先识别上述 canonical 主声，并兼容旧 `workspace-narration-${state.clip_id ?? clip.id}`；跟随整段主声时读取同 shot 的聚合画面窗口。其 caption lane/evidence/live bridge 仍以 visual item 为目标，因此本票**没有宣称多范围整段字幕已闭环**。

暂时在 `workspaceCaptionsCommands.ts` 对 `follow_tts && shotItems.length>1` 的新保存/对齐采用返回明确 409，保留原 lane/正文；不把全段 cues 截到单 range，也不复制一遍到每个 visual。T10 已接手：稳定 `workspace-caption-shot-${shotId}` lane/证据/live bridge 迁移、旧 visual lane 去重与删除首 range 后无幽灵字幕，以及去掉此临时阻塞。T13 整体验收须包含两个 visual range、一条完整主声、完整跟随字幕和删除首 range 的场景。
