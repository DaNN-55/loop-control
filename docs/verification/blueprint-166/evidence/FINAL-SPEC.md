# Spec review — #166

Review pin: `d7430b1136b9109df7b10287b952061dd8fb5003...7e560dad7d7f1ff678f535c6b50bd6ee0fdd488d`。只读审查代码、规格与现有证据；未运行测试、服务或写入业务数据。

## 发现

**P2 — 当前选择无法清空，清空草稿也会被默认值复活。**

规格原文：#168:18「本期默认 / 镜头选择与未提交参数按已有草稿策略在切换和刷新后保留；默认值不限制可选项。」#166 用户故事26「本期默认选择只是预填且可被镜头覆盖」。

`src/local-app/WorkspaceVisualPreparation.tsx:142` 的图片、视频 `onChange` 仅在找到 `entry` 时更新。保存默认 A 后选择空白选项，状态仍为 A；Owner 无法撤回当前工具选择。T11 实际浏览器证据 `T11-browser-preparation-cleared.txt:58-60` 与 `T11-browser-preparation-refreshed.txt:58-60` 均仍选中 A，代码独立确认其原因。

同因存在于 `src/local-app/WorkspaceVisualCandidatesPanel.tsx:90`、`src/local-app/WorkspaceNarrationPanel.tsx:16`、`src/local-app/WorkspacePexelsSearch.tsx:20`。音频 `src/local-app/WorkspaceAudioPanel.tsx:60` 虽写入 `selection:undefined`，但 `:24` 的 JSON 序列化会移除此字段，刷新后 `:18` 又合入已保存默认；这部分为明确代码路径，未另跑浏览器。

修复范围：上述新制作选择控件应接受空值；草稿持久化区分“尚无草稿”与“明确清空”，只在前者使用初始默认。保留不兼容输入及现有显式提交、验证和冻结边界。验证保存默认 A→清空→切镜→返回→刷新后仍空，且没有新任务。

## 其余结论

未发现额外的确定缺项、越界行为或错误实现。已核查按次冻结/重试/未知提交、兼容性拒绝、多连接、原生明确采用、账号根隔离、迁移与备份恢复、Pexels 迁移后真实导出/交付/删除回滚、历史 ID/策略保留和审核退役边界。ADR0018 已批准的 Codex 规划归属调整不构成新增 Provider 或范围扩张。T11 当前23套110例记录与源测试相符；本审查不冒充独立运行通过。
