# #166 双轴审查

固定基线 `d7430b11`；被审查实现 `7e560dad`。两名独立 Agent 只读源码与既有证据；集成运行由独立 merger 执行。以下保留两个审查维度，不合并排名。

## Standards

审查固定范围：`d7430b11...7e560dad`。只读源码与现有验收证据；未另跑测试或服务，T11 尚在进行的集成验收不算通过。

1. **P2 · 文档规则违反：清空的制作选择没有保留。** `src/local-app/WorkspaceVisualPreparation.tsx:142` 的 `if(entry)change(...)` 忽略空选项；`WorkspaceVisualCandidatesPanel.tsx:90`、`WorkspaceNarrationPanel.tsx:16` 同样如此。前两处已有 T11 实际浏览器证据：清空后立即返回 A，刷新仍为 A；我独立核对了最终源码及记录。`WorkspaceAudioPanel.tsx:18,24,60` 则把清空记为 `undefined`，JSON 丢掉该字段后刷新重新合入默认值（源码推断，未另做浏览器复现）。违反 `PRODUCT.md:39`「Keep drafts」及 `DESIGN.md` Four-step production「未保存输入在镜头、素材类型及设置标签切换间保留」。**修复范围：**这四个新增选择入口，显式区分没有草稿与已清空，保存可序列化空值；默认只用于首次预填，保留不兼容输入；验证清空、切镜头和刷新均不恢复旧值。

2. **P3 · 文档规则违反：新规划表单重复展示不可修改的实现身份。** `WorkspacePlanningSelection.tsx:17` 内嵌 `ConfigurationForms.tsx:100`，连续显示禁用 Provider=codex 与只读 Adapter=codex；模型与 Harness 被推到下方，已核对窄窗截图。违反 `/Users/dan/.codex/AGENTS.md:40,42`「避免…重复描述」「文案只保留帮助理解、决策或操作的内容」。**修复范围：**仅新 inline preparation 表单隐藏两项固定输入，保留简短 Codex 上下文及内部固定值、验证；历史管理弹窗不扩大修改。

3. **P3 · 启发式 possible Duplicated Code，并非硬违规。** `WorkspaceVisualPreparation.tsx:142` 与 `WorkspaceVisualCandidatesPanel.tsx:90` 重复 `flatMap(service=>service.models.map(...)).find(x=>x.key===e.target.value);if(entry)...`，同一空选项缺陷随复制出现。**建议范围：**随第 1 项修复提取小型 service/model 选项解析函数，统一返回明确空值；不扩展为通用表单框架。其余 11 项 smell baseline 未发现值得单独报告的问题；未将仓库认可的历史兼容层和按渠道冻结逻辑当作违规。

合计：2 项文档规则违反，1 项非阻断启发式建议；最高 P2。

## Spec

Review pin: `d7430b1136b9109df7b10287b952061dd8fb5003...7e560dad7d7f1ff678f535c6b50bd6ee0fdd488d`。只读审查代码、规格与现有证据；未运行测试、服务或写入业务数据。

## 发现

**P2 — 当前选择无法清空，清空草稿也会被默认值复活。**

规格原文：#168:18「本期默认 / 镜头选择与未提交参数按已有草稿策略在切换和刷新后保留；默认值不限制可选项。」#166 用户故事26「本期默认选择只是预填且可被镜头覆盖」。

`src/local-app/WorkspaceVisualPreparation.tsx:142` 的图片、视频 `onChange` 仅在找到 `entry` 时更新。保存默认 A 后选择空白选项，状态仍为 A；Owner 无法撤回当前工具选择。T11 实际浏览器证据 `T11-browser-preparation-cleared.txt:58-60` 与 `T11-browser-preparation-refreshed.txt:58-60` 均仍选中 A，代码独立确认其原因。

同因存在于 `src/local-app/WorkspaceVisualCandidatesPanel.tsx:90`、`src/local-app/WorkspaceNarrationPanel.tsx:16`、`src/local-app/WorkspacePexelsSearch.tsx:20`。音频 `src/local-app/WorkspaceAudioPanel.tsx:60` 虽写入 `selection:undefined`，但 `:24` 的 JSON 序列化会移除此字段，刷新后 `:18` 又合入已保存默认；这部分为明确代码路径，未另跑浏览器。

修复范围：上述新制作选择控件应接受空值；草稿持久化区分“尚无草稿”与“明确清空”，只在前者使用初始默认。保留不兼容输入及现有显式提交、验证和冻结边界。验证保存默认 A→清空→切镜→返回→刷新后仍空，且没有新任务。

## 其余结论

未发现额外的确定缺项、越界行为或错误实现。已核查按次冻结/重试/未知提交、兼容性拒绝、多连接、原生明确采用、账号根隔离、迁移与备份恢复、Pexels 迁移后真实导出/交付/删除回滚、历史 ID/策略保留和审核退役边界。ADR0018 已批准的 Codex 规划归属调整不构成新增 Provider 或范围扩张。T11 当前23套110例记录与源测试相符；本审查不冒充独立运行通过。

## 修复回读

同一名新的实施者以 `6fd02cbe` 修复全部发现，独立合并者将其合入 `1f8525d6`。Standards 的两项规则问题、重复代码建议与 Spec 的清空选择问题均已关闭：明确空值持久化，准备 / 原生 / 语音 / 音频 / Pexels 控件可清空；默认只预填；共用小型模型选项解析；仅新规划表单隐藏固定身份字段，并保留实际可见的 Harness 标签与正常滚动。

最终集成还复现并修复了同会话连续保存回执与数据库指纹分裂。现在仅规范临时内容比较副本，不重排持久化 SDK 字节；原始回执连续保存、采用候选后再保存、严格成片确认和真实编辑失效均通过。修复者及最终合并者分别记录 red / green；根 Agent 已回读源码、完整结果、真实 HTTP 回执和桌面 / 窄屏截图。

最终实际集成 23 套 /110 项、零跳过；完整默认 174 文件 /1144 项、类型、构建、运行完整性检查通过。见 [最终合并报告](evidence/final-merge.md) 与 [修复报告](evidence/reviewfix-handoff.md)。没有遗留未修复的审查发现。

Standards：2 项规则问题、1 项非阻断启发式建议，最高 P2，均已修复。Spec：1 项问题，最高 P2，已修复。
