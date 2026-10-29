# T10 原生镜头结构与宿主契约

## 唯一编辑权威

OpenChatCut document 保存真实时间、范围、画面、音轨、字幕、关键帧和转场。`readWorkspaceShots` 只从当前原生实例投影镜头导航；数据库 `bindings` 记录来源和实例身份，不保存另一套可编辑时间线。

- `shotId` 是镜头身份，一个镜头可包含多个视觉实例。
- `clipId` 是视觉实例 UUID。旧实例使用 `shot-${shotId}-${clipId}`；原生切分/复制的 `item_<UUID>` 从实际实例 ID 推导独立 clipId，保留同一 shotId。
- 原生实例 `loopControlShot` 保存 `{workspaceId,shotId,clipId,text,provenance?}`；provenance 只有注册 ID、SHA、大小和类型，不含路径。真实来源仍是 item/asset 的 `src/sourceAssetId/sourceRevision/sourceContentHash`。原生 export 会递归识别媒体引用，因此不把第二份 `relativePath` 放进 metadata。
- `saveWorkspaceStudio` 按真实文档同步当前 bindings。删除保留素材池、原始文件、基准分镜和不可变工程版本；不会删除原始材料或重写 approved storyboard。

## 有界结构操作

`applyWorkspaceShotOperation(project,operation)` 从 live document clone 目标增量，一次 native applyDoc/undo。操作包括 insert/remove/move、remove-range、range、lock、composition、appearance。

- 插入是显式原生占位，使用新的稳定 shot/clip 身份。insert 可携带 UUID `clipId`，相同实例的失败重试不会再插一份。未提交简介按工程保存在当前浏览器 sessionStorage，成功后清除。
- 镜头简介导航支持图标增删、折叠后切换、拖放以及 `Alt+↑/↓` 排序。不能删除最后一个实际画面实例；全占位工程至少保留一个镜头。
- 排序按镜头组平移视觉实例、该镜头主声/原声/环境声与 manual caption words；独立 BGM/SFX 位置保留。native keyframes、effects、来源、源区间和其他 timelines 保留。
- 多引用采用聚合窗口。删除视觉引用会明确合缝；若结果短于完整主声或字幕，返回可操作错误，保留当前文档。不会截字、重复口播、静默延长原片或重发任务。
- 原生帧值使用当前 timeline fps，源终点 exclusive。范围按钮复用 T03 `adjustWorkspaceVideoRange` 和 `loopControlVideo.durationLocked`；填充/焦点通过实际 transform 表达；布局复用 `shotCompositionTransform`；转场使用原生 fade 字段。
- 视频 item 的 width/height 写实际视频流几何，避免继承占位画布尺寸而改变原片比例。

关闭 Studio 时可用 Owner `editWorkspaceStructure`，字段为 `{episodeId,workspaceId,expectedRevision,operation}`。活跃 Studio 只接受真实 bridge 编辑后保存；严格 Owner/session、CSRF、Origin、幂等回执、Episode 归属和 workspace CAS 边界继续生效。

## 稳定字幕与主声

字幕 lane 为 `workspace-caption-shot-${shotId}`，manual target 为 `manual:${laneId}`；证据迁移 092 使用 `(workspace_id,shot_id)`。`readWorkspaceCaptions` 每个镜头只返回一条，clipId/itemId 指向当前仍存在的真实视觉实例，durationMs 使用当前聚合窗口，供 T11 actual-used graph gate 消费。

旧 `workspace-caption-${visualItemId}` 在显式 native 保存/结构编辑时迁移。已规范 lane 不重排、不重复写；重复完整 follow_tts lanes 只保留一套完整正文/cue；独立内容按实际绝对时间合并去重。原生 track ID 仍动态解析，不硬编码迁移后的 track 名称。正文或窗口变化使旧证据过期，不制造有效核对。

T05 canonical TTS 为 `workspace-narration-shot-${shotId}`，一个 shot 一份；任意视觉引用都可定位。T10 不依赖“第一个 visual clip 永远存在”。已实际验证两个范围、一份主声、完整 follow_tts 字幕，删除首引用后保留同一 task/track/item 和完整 cue，且只有一次受控 Provider 提交。

T06 source canonical 为 `workspace-source-shot-${shotId}`。结构额外识别 audio item 的 `loopControlAudio.shotId`，因此带该标记的 source/ambience 会跟随镜头移动/删除；独立 BGM/SFX 不带 shotId。路径不得放进该 metadata。

## 宿主接入与保存

`EmbeddedStudioBridge` 提供 inspect、applyCaptions、applyEdit、applyNativeEdit、save；`panels:[{id,label,render(bridge)}]` 接右侧模块。`applyNativeEdit` action union 包含 `apply-workspace-edit | apply-candidate | apply-audio-mix`；候选/音频各自提供受限 runtime handler，本票不提供任意全工程写 RPC。

增量保存顺序为 inspect → 当前观察 revision/SHA/live doc 引用检查 → native applyDoc → 原生 flush/ownership CAS → Owner `saveWorkspaceStudio` → 不可变文件 SHA/SQL CAS。Host 用同步 workspaceRef 持有最新保存回执，用 pendingRef 阻止重入；旧 bridge 闭包连续 save→apply 也读取最新 SHA。失败保留真实原生编辑器与错误，不报告成功。

Studio 启动身份固定为 workspace+scriptRevision+storyboardPackage，不含可编辑 bindings。结构保存后再次 open 复用当前 Studio，不因实例数组变化关闭/重建工程。原生选择状态不改变内容 revision 或最终文件确认。

共享持久接口签名：

```ts
updateWorkspaceProject(c, root, row, project,
  bindings = row.bindings, reason?, options: {nativeEdit?: boolean} = {})
```

第七参 `nativeEdit:true` 只在内容 SHA 实际变化时，在同一 SQL CAS 内增加 native_edit_revision。saveWorkspaceStudio 和闭态结构编辑已用此参数；自动准备/Worker 首产默认 false。T08/T06 的闭态明确采用须使用同一 flag；nativeApplied 已经由 saveWorkspaceStudio 增加，不得再加一次。

宿主工具展开前先等待原生属性折叠。Owner 再手动展开原生属性时，嵌入 adapter 让其占用布局而非盖住画面。Host grid 显式 `minmax(0,1fr)` 行，iframe 容器/aside `min-height:0`。不修改第三方 checkout，不改原生时间线缩放/平移。

## 明确交接

- **新增 shot 的 generation lineage（T08/T13）**：新增 shot 不在原 approved storyboard 中。T10 只保留新实例与原基准的可追溯关系，支持注册图片/原片编辑；不会伪造批准 shot 或改写 storyboard。旧生成 RPC 若强验 board membership，须由后票接本地工作版本 manifest/授权路径，不能为了通过 RPC 写假批准。root 最终验新增画面+局部口播闭环。
- **actual source/none 字幕解析（T06）**：T06 提供实际主声 resolver，优先可听 source/TTS，排除静音轨/零音量；visual `loopControlAudio.voiceMode` 明确区分首次未采用和 Owner 选择 none。有 explicit native route 时禁止回退旧 draft track；source 不能冒充 follow_tts 正文核对。仅无明确 native route 的早期 draft 对齐保留兼容。此有限 resolver 接线由 T06 完成，不属于本票已验证的 TTS 跨票路径。
- **候选工具性能（T08）**：真实候选组件/媒体控件的特定卡顿由 T08 闭环。T10 自身字幕工具矩阵已通过；早先“旧 Host + 短静态面板”仍加载最新 CSS，不是完整旧版对照，不能排除 auto grid row 的反馈。诊断驱动与 trace 已交 `/private/tmp/loop-152-orchestration/t10-performance-handoff/`，不将其当成候选性能通过。
