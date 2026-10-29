# T08 音视频候选采用边界

原生 OpenChatCut document 是唯一编辑权威。候选只引用已完成任务的不可变输入、artifact/audio track、实际 SHA/字节数/时长；候选来源展示不改变当前工程。`workspace.candidates` 从本工作空间的不可变请求/任务/音轨和追加决定投影。正文保留任务 text version，并与冻结分镜的主脚本段落显示差异。

## T09 共享接口

`src/workspaceCandidates.ts`：

- `WorkspaceCandidate`：id/kind/shotId/clipId/targetItemId/taskId/inputFingerprint/text/mainScriptText/audioTrackId/relativePath/sha256/fileSize/durationSeconds/status/currentDurationSeconds。视频 audioTrackId=null，服务端须从自己的可信本期请求和完成产物解析此对象，不能信任客户端传入 source。
- `workspaceCandidateTarget(item)` 提取稳定目标及当前源/区间身份。`WorkspaceCandidateEdit` 同时绑定该身份、新注册 source 与显式 durationPolicy。
- `applyWorkspaceCandidate(project,edit)` 从 live document 精确 clone 后只更改唯一目标实例的来源及必要时长，保留其他 items、timelines、mix、transform、effects、transitions、captions 和 target volume/fade。拒绝目标重复/缺失、输入冲突、变速/分段。新 asset 使用独立 ID，不做 pool-wide relink。原生 sourceRevision 按已安装 runtime 的 `source-sha256-${sha256}` 规范，创作输入身份另存 target.loopControlCandidate.inputFingerprint/sourceId；不得把创作指纹塞进会被原生规范化的 sourceRevision。
- `keep-target` 仅源足够长时保留目标窗口；`use-candidate` 使用完整候选时长，其他片段不移动。源从 0 开始；绝不隐式循环/变速/ripple。UI 必须显式选择策略。

`src/local-app/workspaceCandidates.ts`：

- `prepareRegisteredWorkspaceCandidate(c,root,row,project,candidate,durationPolicy)` 在 Owner transaction + workspace lock 后用 `resolveWorkspaceSource` 再验本期注册身份/文件 SHA/字节数，保存不可变 adoption token。返回 `{adoptionId,candidateId,edit}`。活跃 Studio 先把已验证 bytes 复制到会话 `/media/uploads` 并原子更新 workspace.json reverseSources；旧 target path 同样转为该会话 URL。不会关重开 Studio。候选失败/冲突至多留下未用 asset。
- `finishRegisteredWorkspaceCandidate(c,root,row,project,candidate,data)` 验 token/候选输入/当前源和时长；活跃 Studio 要求 `nativeApplied:true` 且真实 LC 保存快照匹配。闭态使用同一纯增量后 `updateWorkspaceProject` CAS。追加采用决定。调用者仍须在入口核验自己候选与当前创作输入一致，且保存自己领域的采用身份。

T09 可在自己的命令入口和读投影复用以上两个函数；不要复用 T08 的 audio-only HTTP candidate lookup。决策、adoption 表支持通用 UUID candidate identity。

## HTTP 和 live bridge

共同字段 episodeId/workspaceId/expectedRevision，沿既有 Owner/Origin/CSRF/幂等事务。

- `prepareWorkspaceCandidate`：candidateId/durationPolicy。
- `adoptWorkspaceCandidate`：candidateId/adoptionId/nativeApplied?。
- `rejectWorkspaceCandidate`：candidateId，追加拒绝，工程内容不变。

宿主顺序：`bridge.save()` → GET 当前 workspace → prepare → `bridge.applyNativeEdit('apply-candidate',{edit})` → GET 当前 workspace → adopt(nativeApplied:true)。bridge 沿现有 inspect revision+SHA 双检查，再从 live doc 增量 apply，等真实 flush ownership CAS，最后既有 Owner saveWorkspaceStudio 不可变快照/CAS。applyDoc 本身不是 CAS。裸 LC 文件路径/blob/外部 URL 不能进入 bridge candidate handler。

字幕不重建；已用音轨/源窗口变化会自然使 T07 输入指纹和核对过期；旧对齐不能通过当前指纹检查。仍须由 Owner 重新对齐或手工校时。任何冲突保留编辑器当前 doc 和本地错误，允许重新比较/重试。

## T12 实际采用正文

`readUsedWorkspaceNarrationVersions(c,row,project)` 只按实际 native canonical/兼容主声 item.src 解析本期 narration audio track。优先同 workspace+candidate_id(audioTrackId)+decision='adopted'+source_sha256=track.sha256 的不可变记录；native 有 loopControlCandidate.inputFingerprint 时再核同一创作输入。记录 text_version 和 main_script_text 均为正文 string，input_fingerprint 为创作指纹，project_sha256 为采用后工程快照。首次 TTS/人工口播采用也写此表。

无决定记录的历史 TTS 回退到该实际 track.source_task_id 对应不可变 task.input_snapshot.media.narration.text。没有已记录正文的人工轨返回 text=null/provenance=not_recorded，仍保留实际 track/task/SHA/item 身份。不能用当前 draft.tts_text、未采用候选或候选准备 token 填写交付正文。T12 Worker 可按同一 SQL 契约读表，避免导入 Owner 模块。

## 保存竞态与失败恢复

Owner Studio snapshot 在注册来源验证后调用 `validateWorkspaceCandidateUses`。尚未进入已提交工程的候选 relink 必须有匹配当前工程 SHA 的准备 token；canonical 主声还须匹配当前 TTS 输入和当前实际候选 track。prepare 之后改正文时，旧候选的 native 本地编辑可保留供撤销，但 Owner 保存返回409，已提交工程不推进。既有已提交来源及曾明确采用的版本仍可正常编辑/原生 undo；不把正常撤销误判为迟到候选。

原生保存成功、最后决定回执失败时，候选投影标记 pendingConfirmation，界面提供「确认采用」。重启后可按真实已存源/输入/时长找回准备 token，再确认已有版本，不重新生成、不重建工程。音视频共用 token/project/source fence，只有 canonical 主声应用 TTS 当前输入校验；T09/T06 仍负责自己域的输入有效性。

## T10/T13 新增镜头接续缺口

2026-10-29 的随机夹具真实 Owner 检查：`editWorkspaceStructure(insert)` 返回200；该 `added-*` 镜头随后 `saveWorkspaceNarration` 返回400「配置校验未通过。」；原 scriptRevisionId/storyboardPackageId 均未变化。087 wrapper 仍调用旧 `public.save_shot_preparation_draft` 的冻结分镜 membership 门槛。T08 本次 existing-shot 候选测试不能证明新增 workspace-local shot 的首次 TTS。T13 须用受控的 workspace 局部 shot 输入/版本接原 Provider/授权/Worker fence，不可改写旧批准分镜或伪造旧审批。

## 显式切换为口播主声

source/none 下，准备候选仍不改变项目、实际路由或人工 epoch。Owner 必须点击「采用为口播主声」并选择时长政策；采用才创建或恢复 canonical TTS、解除主声静音、切换唯一实际主声。T06 的 BGM/SFX/ducking 和已有环境声实例保留。当前实际 TTS 已可听时，增益、淡入淡出及其它 native 属性原样保留；切换原声时沿用当前实际主声的 volume，none 时启用正常音量。

共享 edit 的可选 mainVoice 保存准备时的 canonical 声音/音量/轨道静音和实际画面窗口身份。live payload 将该身份内的本期路径映射为已注册会话 URL；Owner token 保留相应 LC 身份。路由或窗口已变化时必须重新比较，不能借采用覆盖另一标签的新决定。新建 TTS 使用 `applyWorkspaceAudioMix` 的仅内部 `narrationDurationInFrames` 选项；普通 mixer 首次整窗检查不放宽。

keep-target 对口播使用目标窗口与真实候选长度的较小值；超长明确裁尾，较短按真实音频结束，剩余画面无该段口播。use-candidate 使用完整真实音频长度。两者都不移动其它画面或补词、循环、变速。视频/非主声音频的通用 keep-target 仍拒绝短于目标的源。界面显示时差、目标窗口、短口播空余或完整口播延伸影响；字幕和交付元数据继续按实际已用 range/coverage 核对。
