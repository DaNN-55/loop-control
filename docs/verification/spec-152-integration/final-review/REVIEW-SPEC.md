# Spec 轴最终审查

固定 HEAD：`3b7da737779b59dbfa9da85ec8f4b9f0efa73d1f`；基点：`8ec17edfe331b5610b2bdd0eb62bf25710ffee89`。

确定发现：1（P1：0，P2：1）。

- **P2 — 迟到的首次口播仍可绕过候选时长决策并移动无关编辑。** `src/local-app/workspaceNarration.ts:68-69` 的 `adoptWorkspaceNarration` 直接调用 `adopt(...,true)`；`:104-109` 只要首次音轨时长与画面不同，就改目标画面长度并移动所有后续实例。触发：首镜口播尚未完成时进入真实编辑器，手动调整后镜位置、音效或字幕并保存；任务完成后返回素材准备，点击“采用口播”。自动刷新虽被 `native_edit_revision` 挡住，此显式入口仍无时长差异决策，后镜和绝对位置音效被平移，字幕 lane 的绝对时间则没有同步移动。原 Spec §First assembly 要求“do not … discard manual edits to fit a duration”；§Incremental candidates 要求“preserve unrelated … timing decisions”及“Show duration impact and require a deliberate resolution when downstream timing would move”。应在已有原生编辑后将首次结果也交给候选采用契约，或拒绝此自动组装入口，要求明确解决时长。

其余已读主链未确认新的 Spec 缺失或范围扩张。检查涵盖普通脚本规划、工作空间版本、素材来源、音轨/字幕身份、候选采用、已用内容就绪判断、确切导出确认、交付校验和历史隔离。按本次权限仅做源码审查；未运行测试、HTTP/DB、GUI、真实 Studio、渲染或 Provider，不能据此确认运行时、付费提交或 ASR 质量。
