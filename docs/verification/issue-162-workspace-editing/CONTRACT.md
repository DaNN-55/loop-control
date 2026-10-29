# T10 原生结构与宿主扩展契约（进行中）

`workspaceShots.ts` 从真实 native instances 投影镜头。实例保存 `loopControlShot:{workspaceId,shotId,clipId,text,source}`；旧实例在 open 时根据 bindings 补齐。`applyWorkspaceShotOperation` clone 当前 live doc，只编辑明确目标；移除不删除 pool/source，排序平移镜头实例、所属主声和 manual caption words。

宿主 `EmbeddedStudioBridge.applyEdit(operation)` 使用 inspect → revision/SHA/live doc 预检 → native applyDoc → 原生 flush/CAS → 既有 Owner `saveWorkspaceStudio`。`applyNativeEdit(action,payload)` 提供 T08 可复用的相同链，action 仅 `apply-workspace-edit | apply-candidate`；T08 在 runtime bridge 新增其有界 candidate handler，不重建本票处理链。Host `panels:[{id,label,render(bridge)}]` 允许候选、声音等右侧模块接入，不必重写 Host；原 `captionEditor` 保留。

`editWorkspaceStructure` 是关闭 Studio 的同一有界编辑器操作入口；活跃工程要求 bridge。`saveWorkspaceStudio` 根据真实文档同步当前 bindings；不可变版本保存来源/基准历史，不把 bindings 当第二套 timeline。

T10 继续拥有 Host/bridge 接线。跨票字幕身份将从可删 visual clip 迁移 shot，完成后更新本契约。
