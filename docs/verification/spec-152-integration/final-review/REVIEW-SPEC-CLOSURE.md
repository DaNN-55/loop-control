# Spec 轴修复复核

固定源码：`e9d7f54fe72329bc6f11beb1b470b93beec244de`；审查 diff：`3b7da737...e9d7f54f`。

原 P2：**resolved（源码层）**。新增确定 Spec 发现：**0**。

- `src/local-app/workspaceNarration.ts:33,43,91` 现在以当前工程人工 epoch 阻止自动首次组装及旧直接采用；提交前已有编辑、在途新增编辑都会留下候选，不能因重新确认/提交而绕开保护。
- `src/local-app/workspaceCaptionsCommands.ts:63,82` 将闭态字幕保存、采用对齐计入真实内容编辑；`productionWorkspaceCommands.ts:97` 对显式 preserve 的旧原生工程初始化 epoch=1，fresh=0。底层更新仍仅在内容实际变化时增加 epoch，未改动保存不会误计。
- 结果沿现有 T08 的 `prepareWorkspaceCandidate` → `adoptWorkspaceCandidate` 路径采用，明确选择时长；`src/workspaceCandidates.ts:23-53` 保持目标实例修改，无后镜/SFX/caption 平移。准备页 `WorkspaceNarrationPanel.tsx:22` 按相同保护标识指向“剪辑工作台的口播版本”，与后端拒绝一致。
- 未编辑初稿仍允许按实际音轨组装；`workspaceNarration.ts:104-110` 保留时长锁、多个画面范围及原片不足保护。

符合原 Spec 的“preserve unrelated … timing decisions”及“Show duration impact and require a deliberate resolution when downstream timing would move”。其他本次 diff 未见确定新增的 Spec 缺失、错误实现或范围扩张；不替代 Standards 轴判断。

限制：本次仅只读源码与测试定义，未运行测试、HTTP/DB、GUI、Studio、渲染或 Provider。文档中的验证结果没有视作本审查亲验，resolved 不代表已独立证明最终提交的运行时结果或媒体质量。
