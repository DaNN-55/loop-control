# 输入区与画面生成结构对齐

2026-11-08。用户纠正前一轮对“不要外边框”的理解，并提供视频生成框截图。本次将口播和字幕调整为相同的两层结构：复用 workspace-generation-composer 白底圆角外壳，上方是独立浅底输入框，配置和生成/保存按钮位于内框外的下方。保留整体外框与输入边界，工具栏不再与正文处在同一个输入框中。

修改仅涉及 WorkspaceNarrationPanel.tsx、WorkspaceNarrationCaptions.tsx、workspace-narration-settings.css 和 PLAN.md。人工文件槽随输入区同步移动；控制逻辑、来源、字幕跟随与独立保存、开关、草稿、候选和业务数据均不改动。

验证：41 项口播组件/阅读回归、npm run check 和 Vite 前端构建（emptyOutDir:false）通过。真实 5174 页面在 1490×953、1152×790 检查 AI、人工文件槽和字幕；无页面横向溢出。宽屏输入与工具栏为同级节点，间距 8px；输入底色 rgb(247,249,252)。截图 voice.png 和 captions.png。窄窗下镜头表格旧列宽较挤，本次未修改无关表格。未保存日常配置/字幕、导入、采用、撤销或付费生成；验证标签关闭并恢复默认 viewport。无需后端重启或迁移，未提交推送。
