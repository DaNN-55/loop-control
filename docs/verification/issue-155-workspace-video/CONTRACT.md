# 工作台视频区间契约

`saveWorkspaceVideoRanges` 只准备指定 `shotId` 的初稿视频引用，接受 `{episodeId,workspaceId,expectedRevision,shotId,ranges}`。`ranges` 为 1–50 项，每项包含 `{clipId?,materialRevisionId,sourceInFrame,durationInFrames,durationLocked}`。所有帧值使用目标原生 timeline 的 fps；区间为 `[sourceInFrame, sourceInFrame + durationInFrames)`，结束帧不包含在内。

已有引用必须携带其 `clipId`，继续使用相同的原生 `itemId=shot-<shotId>-<clipUUID>`；新项获得 UUID。相同材料可在同一镜头或不同镜头重复出现，一个镜头可组合多个注册来源。原生素材池按材料 revision 去重；item 写入原生 `srcInFrame/durationInFrames/sourceAssetId/sourceRevision/sourceContentHash/sourceFilename`。绑定仅记录原始来源，后续真实时间、构图、音频与区间从原生工程读取。

所有材料经过原有 `importMaterial` Owner/路径/归属/类型/不可变 SHA 边界；本命令再验证本期注册 MP4、文件 SHA/大小和 ffprobe 真实时长。区间不能超出原片。删除某引用只移除此 item/绑定，保留 pool asset、共享原片和其他引用的源区间。准备阶段时长改变会平移后续 item 的 timeline 起点，不改变它们的源起点/帧长。

## 锁长与单帧操作

原生 `item.loopControlVideo.durationLocked:boolean` 是操作语义，经过原生读取/保存保留。它不改变渲染速度，不增加源代理，也不作为禁止原生手动裁切的校验门槛。

`src/workspaceVideo.ts` 导出 `adjustWorkspaceVideoRange(range,edge,deltaFrames,sourceDurationInFrames)`，供准备界面与后续真实编辑器补丁控件复用：

- `edge='in'` 且锁长：整体移动源窗口，时长不变；源边界处夹紧。
- `edge='out'` 且锁长：保持原区间，界面终点操作禁用。
- 未锁长：起点移动保留原终点，终点移动保留起点，至少保留 1 帧。
- `deltaFrames=±1` 为精确单帧，范围由源真实帧数限定。原生 item 对应字段为 `srcInFrame`，helper DTO 字段为 `sourceInFrame`。

准备页以原生快照初始化草稿，不存第二套可编辑时间线。保存需当前 workspace revision、关闭 Studio、`native_edit_revision=0`。人工保存后返回明确 409，准备页视频区间只读；T08/T10 在 live native doc 中对目标稳定 item 做局部命令，不能将此整镜初稿入口用作人工编辑后的覆盖入口。

## 版本和边界

沿用 Owner/session、Origin/CSRF、Episode ownership、幂等回执、workspace 行锁、脚本基准、不可变工程版本与 CAS。无效范围/字段为 400，不可见/错误类型材料为 404，失效版本、活动编辑器、人工保存、文件篡改为 409。

未新建 SQL 表或迁移：现有 JSON bindings、原生 SHA 快照与 workspace versions 已持久保存所需审计。085 为预留编号，无需空迁移。构图/音频继续由各自票和原生工程管理。本票不改 bridge/EmbeddedStudioHost；T10 消费上述锁长 helper 和 native 字段。
