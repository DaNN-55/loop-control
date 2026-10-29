# T08 音视频候选采用边界

原生 OpenChatCut document 是唯一编辑权威。候选只引用已完成任务的不可变输入、artifact/audio track、实际 SHA/字节数/时长；候选来源展示不改变当前工程。`workspace.candidates` 从本工作空间的不可变请求/任务/音轨和追加决定投影。正文保留任务 text version，并与冻结分镜的主脚本段落显示差异。

## T09 共享接口

`src/workspaceCandidates.ts`：

- `WorkspaceCandidate`：id/kind/shotId/clipId/targetItemId/taskId/inputFingerprint/text/mainScriptText/audioTrackId/relativePath/sha256/fileSize/durationSeconds/status/currentDurationSeconds。视频 audioTrackId=null，服务端须从自己的可信本期请求和完成产物解析此对象，不能信任客户端传入 source。
- `workspaceCandidateTarget(item)` 提取稳定目标及当前源/区间身份。`WorkspaceCandidateEdit` 同时绑定该身份、新注册 source 与显式 durationPolicy。
- `applyWorkspaceCandidate(project,edit)` 从 live document 精确 clone 后只更改唯一目标实例的来源及必要时长，保留其他 items、timelines、mix、transform、effects、transitions、captions 和 target volume/fade。拒绝目标重复/缺失、输入冲突、变速/分段。新 asset 使用独立 ID，不做 pool-wide relink。
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
