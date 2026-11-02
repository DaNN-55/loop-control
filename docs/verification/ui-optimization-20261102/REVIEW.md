# 全界面优化双轴审查

审查基点：`b047f61d` → `b7a059d3`。两个全新上下文只读审查分别核对项目标准与已批准的 83 项范围；下述发现保留原轴，不相互抵消。实现后的修复与复验另记。

## Standards

冻结范围：`b047f61d6bf2c5dea8e223df31555834d0356947...b7a059d39d5cef4a7baf100f1eb308beb7235076`；已读取指定 38 个提交。此报告只审查标准，不替代 root 的全量检查和 Spec 审查。未修改仓库、Git、服务，未调用真实凭据或 Provider。

## Hard

- **[P3] 校验恢复草稿的实际内容，再交给口播表单。** `src/local-app/workspaceSettingsDraft.ts:3–4`：只比较 `baseline`，直接将 JSON 的 `stored.value` 当作 `T` 返回；匹配基线但 `value:null`、缺字段或字段类型错误时不会回退。`WorkspaceNarrationPanel.tsx:22–24` 随后读取 `value.selection`、`value.languageCode`，可使整个口播面板渲染失败。规则来源：本次用户提供的 AGENTS.md「外部输入在接收边界完成校验；内部复用已有类型和约束」。建议在本存储读取边界校验 Settings 和嵌套选择的结构，不合格就回退已保存值；`readWorkspaceLegacySettingsDraft` 同样不能让错误类型覆盖默认字段。无需为每个内部使用点重复校验。

  复现：Node 24 直接导入真实 `workspaceSettingsDraft.ts`；将 `sessionStorage.getItem` 设为返回 `JSON.stringify({baseline:workspaceSettingsFingerprint(initial),value:null})`。真实 helper 返回 `null`；访问 `restored.selection` 抛出 `TypeError: Cannot read properties of null (reading 'selection')`。这是合法 JSON，不会进入现有 catch。

## Judgment

- **[P3，非阻断] Duplicated Code / Repeated Switches。** `src/local-app/WorkspaceVisualRecord.tsx:30,32` 逐字重复视频设置的标签映射与布尔值／镜头结构格式化；`WorkspaceVisualPreparation.tsx:242` 又维护一份标签映射。以后增加或改名一个生成参数容易造成候选、未产出任务、错误说明三处不一致。可只提取同文件的设置事实渲染块，并复用现有视频领域的标签定义；不建议借此重构页面。

其余指定气味（Mysterious Name、Feature Envy、Data Clumps、Primitive Obsession、Shotgun Surgery、Divergent Change、Speculative Generality、Message Chains、Middle Man、Refused Bequest）未发现需要独立整改的具体新增问题。已审查 Owner 输入／恢复／存储／连接边界、导航与草稿、音视频与原生编辑器适配、只读记录及关联 UI diff；抽查真实 HTTP／PG／SDK 集成测试与浏览器证据记录。未重新执行浏览器或全量测试；工具已能发现的类型、格式和测试失败未重复列为标准发现。

## Spec

范围：`b047f61d6bf2c5dea8e223df31555834d0356947...b7a059d39d5cef4a7baf100f1eb308beb7235076`；已读 38 提交清单、规格／工单／状态以及相关集成实现。以下为确定的产品缺口，不以工单 32 尚待统一验收作为缺陷。

1. **[P2] 普通全局搜索未进入导航状态，刷新丢失关键词。** 规格 `docs/specs/ui-full-audit-20261102-tickets.md:211–212`：「为已纳入规格的页面、选中对象、标签、关键词、筛选和分页建立一致的导航恢复行为」「直接打开、刷新与浏览器前进后退保持上下文」。`src/local-app/WorkspaceSearchPanel.tsx:33` 输入仅更新组件 state；只有分类／翻页的 `change`（:28）及打开结果（:29）写入导航。输入关键词并停留首八项后直接刷新，`searchQ` 仍为空，搜索丢失。应在实际搜索生效边界保存关键词及打开状态，并补公开 UI 刷新回归。

2. **[P2] 两条口播采用路径绕过采用前影响核对。** 规格同文件 `:428`：「采用前显示当前与候选时长、差值和受影响片段，处理策略与实际原生时间线结果一致」。`src/local-app/WorkspaceCandidatesPanel.tsx:21` prepare 后直接原生应用／adopt；`:24` 只显示旧差值及相交数量。`src/local-app/WorkspaceNarrationPanel.tsx:48` 也 prepare→adopt 一次完成。服务端 `src/local-app/workspaceCandidateAdoption.ts:37–40` 已为音频返回实际 `impact`，两个入口均丢弃它。延长口播跨入后续镜头时，用户不能先核对具体受影响片段。应接入现有影响核对组件，再明确确认采用。

3. **[P2] 原生剪辑器「口播版本」遗漏未知结果和恢复入口。** 规格同文件 `:451–453`：「页面读取并显示持久任务、供应商提交和原生产物发布保护的真实状态」「未知提交和未知发布结果保留明确核对路径及禁止重复提交的约束」。`src/local-app/WorkspaceCandidatesPanel.tsx:17,20,22` 仅处理 ready/running 和通用 error，完全不读取 `narration.generationTask`；遇到 `submissionUnknown` 或 `publicationAttempt` 时看不到核对／恢复操作，生成按钮也不据此禁用（后端仍阻止重发）。应复用素材准备区已有状态与原产物核对入口。

未发现可确认的范围膨胀。以上为代码路径核查；本只读审查未启动服务或执行浏览器验收。未确认草稿 reset 的独立可报告缺陷。

Standards：2 项，最严重为 P3 恢复草稿缺少结构校验；Spec：3 项，最严重为 P2 搜索恢复、口播采用与未知任务恢复缺口。

## 修复与验证

单一全新上下文实施 Agent 已完成五项审查修复；另以公开表单复现并修复旧标签页放弃／关闭覆盖新草稿的问题。最后六文件、42 项定向检查通过；全量检查和最终浏览器结果另记。详细红绿与文件范围见 [修复记录](review-fixes.md)。
