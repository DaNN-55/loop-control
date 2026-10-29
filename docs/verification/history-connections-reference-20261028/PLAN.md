# 历史资料与外部连接按原型改造 · 2026-10-28

用户已认可两个页面，明确授权子Agent执行真实页面修改；主流程继续讨论，不迁移生产节点。保持未提交，不写真实业务数据。

- [x] 保存相关文件起点。
- [x] 连接Agent：原型列表/搜索/筛选/新建与编辑弹窗；保留Keychain、版本、测试、引用、权限和原事件合同。
- [x] 历史Agent：原型页签/筛选/表格/详情；保留资料来源、精度、下载、归档恢复和清理预览边界。
- [x] 主Agent核对差异、类型/相关回归、真实只读浏览，右侧交付真实页面。

分工文件不重叠：连接负责ConnectionWorkspace/LocalConnectionsPanel/新连接CSS及连接测试；历史负责LocalHistory/HistorySources/新历史CSS及历史测试。全局maintenance.css/foundation.css/LocalCatalogApp由主Agent协调，worker不得并写。

验收完成：主 Agent 复核 11 文件 / 83 项测试、类型、独立目录 Vite 构建、真实 5174 只读浏览与浅深色截图；修正旧样式覆盖、筛选按钮重叠、长标题越列、选中下划线颜色。生产节点仍在方案讨论，不迁移。
