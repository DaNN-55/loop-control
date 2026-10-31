# Standards

审查固定范围：`d7430b11...7e560dad`。只读源码与现有验收证据；未另跑测试或服务，T11 尚在进行的集成验收不算通过。

1. **P2 · 文档规则违反：清空的制作选择没有保留。** `src/local-app/WorkspaceVisualPreparation.tsx:142` 的 `if(entry)change(...)` 忽略空选项；`WorkspaceVisualCandidatesPanel.tsx:90`、`WorkspaceNarrationPanel.tsx:16` 同样如此。前两处已有 T11 实际浏览器证据：清空后立即返回 A，刷新仍为 A；我独立核对了最终源码及记录。`WorkspaceAudioPanel.tsx:18,24,60` 则把清空记为 `undefined`，JSON 丢掉该字段后刷新重新合入默认值（源码推断，未另做浏览器复现）。违反 `PRODUCT.md:39`「Keep drafts」及 `DESIGN.md` Four-step production「未保存输入在镜头、素材类型及设置标签切换间保留」。**修复范围：**这四个新增选择入口，显式区分没有草稿与已清空，保存可序列化空值；默认只用于首次预填，保留不兼容输入；验证清空、切镜头和刷新均不恢复旧值。

2. **P3 · 文档规则违反：新规划表单重复展示不可修改的实现身份。** `WorkspacePlanningSelection.tsx:17` 内嵌 `ConfigurationForms.tsx:100`，连续显示禁用 Provider=codex 与只读 Adapter=codex；模型与 Harness 被推到下方，已核对窄窗截图。违反 `/Users/dan/.codex/AGENTS.md:40,42`「避免…重复描述」「文案只保留帮助理解、决策或操作的内容」。**修复范围：**仅新 inline preparation 表单隐藏两项固定输入，保留简短 Codex 上下文及内部固定值、验证；历史管理弹窗不扩大修改。

3. **P3 · 启发式 possible Duplicated Code，并非硬违规。** `WorkspaceVisualPreparation.tsx:142` 与 `WorkspaceVisualCandidatesPanel.tsx:90` 重复 `flatMap(service=>service.models.map(...)).find(x=>x.key===e.target.value);if(entry)...`，同一空选项缺陷随复制出现。**建议范围：**随第 1 项修复提取小型 service/model 选项解析函数，统一返回明确空值；不扩展为通用表单框架。其余 11 项 smell baseline 未发现值得单独报告的问题；未将仓库认可的历史兼容层和按渠道冻结逻辑当作违规。

合计：2 项文档规则违反，1 项非阻断启发式建议；最高 P2。
