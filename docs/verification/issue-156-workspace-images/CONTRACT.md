# 工作台图片契约

`WorkspaceImageMatch` 复用本期材料注册入口上传原图，并在同一镜头匹配入口选择静帧、本地推拉或 AI 视频。上传、匹配和生成都是明确的 Owner 操作，刷新与导航不会发起任务。

## 来源与原生工程

- `matchWorkspaceImage` 仅填入本期当前工程的未匹配占位，接收 `materialRevisionId`、`usage=still|pan-zoom`、`durationSeconds`、`fit=contain|cover`、`focusX/focusY`（画布百分比）。
- `WorkspaceClip.image` 是首次准备的来源/变换记录；后续实际时间、构图、关键帧由原生工程持有，不由此字段回写。
- 原生 `asset.kind` 和 `item.kind` 为 `image`。item 保留稳定 ID、`sourceAssetId/sourceRevision/sourceContentHash/sourceFilename`，源文件不重写。
- per-image fit 通过原生 transform 相对 timeline fit 计算。本地推拉为原生 item-local `scale/x` 关键帧，首尾帧明确，无外部任务、无视频代理。
- 静帧、推拉与 AI 首次请求准备时先确定占位时长；仅准备操作移动后续初稿片段。AI 结果收取只替换原占位来源，不重新安排后续时间线。

## 首次 AI 视频

`generateWorkspaceImage` 复用 `executeWanCommand`。根据已选择的当前镜头执行配置调用原有 Wan 或官方视频路径；保留已验证连接、Provider/model、Worker readiness、预算及提交授权。缺失配置保持阻塞，不回退其他供应商。

迁移 `086-workspace-images.sql` 添加不可变 `workspace_image_requests`，绑定 workspace/clip/item、原图 revision/hash、目标时长、请求时工程 SHA 与 `native_edit_revision`。原有 task、lease、预算 reservation 和 material revision 持有执行结果，不另造媒体任务。

Worker 完成只登记不可变结果。Owner 用 `fillWorkspaceImageResult` 明确收取首次结果；仅在初次请求身份仍有效、原占位仍在、时长不变、输入原图和输出视频指纹通过、且未人工保存后才填入。结果不会自动覆盖人工编辑；后续显式候选采用由后续票负责。

`production_workspaces.native_edit_revision` 从 0 开始。只有 `saveWorkspaceStudio` 收回的真实原生内容 SHA 发生变化才递增；选择状态和未变化保存不递增，首次自动组装不递增。因此多个首次图片/旁白结果不会因完成顺序互相阻塞。该 counter 仅用于人工保存边界，不能替代来源、模式、文件或目标检查。

## 错误与交付

非法使用方式、时长、构图或引用 ID 返回 400；不可见来源返回 404；原图缺失/变指纹、工程并发变化、活跃编辑会话和迟到结果返回明确 409。旧来源、历史工程和任务结果保留。

沿用 Owner/session、Origin/CSRF、Episode ownership、命令幂等和工作台 CAS。`readiness.deliverable=false` 保持保守，最终已用媒体与导出验收由 T11 完成。


## T05 交叉接线

当前本票 AI 时长取 Owner 明确输入。按主 Agent 分工，T05 随其合入使用 `readWorkspaceNarrationTarget` 为 tts/manual 冻结真实主声音时长与输入身份，再把目标原生时长和 Provider 请求整数时长区分保存；未就绪必须 409，不能回退旧估算。none 不要求口播。该交叉行为在本票单独验证之外，见 REPORT。
