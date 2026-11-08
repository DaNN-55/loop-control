# 制作步骤栏上移

2026-11-08：移除普通制作页面的“四步制作”文字，将四个步骤和原 titleActions 合并到同一 header；更多操作在右侧，保留原导航、焦点和禁用逻辑。已有生产单标题及历史只读/已归档/制作已完成状态保留。

修改 `ProductionWorkspacePanel.tsx`、`production-workspace.css`、`production-compact.css`（均在 `src/local-app/`）；导航选择器随 DOM 层级同步，窄窗横向滚动及摘要隐藏规则保留。基线在当前对话目录 `workflow-header-baseline/`。

验证：ProductionWorkspacePanel 35 项和 legacy 9 项，共 44 项通过；类型检查与最终前端构建通过。实际页面顶部 header 为 45px，无多余标题行；更多操作能展开，Escape 关闭并返回焦点。880px 窗口下四个步骤保留、更多入口可见，页面无横向溢出。未保存业务数据、启动编辑器、重启服务或提交代码。

截图：`desktop.png`、`narrow.png`。
