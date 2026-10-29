# 共享界面组件

本目录保存已采用的 React Aria 控件、表单、弹窗和相关工具。当前视觉与布局以根 DESIGN.md、src/ui/impeccable/ 及页面样式为准，目录名不代表继续使用旧紫色设计。

Button、Input、Select、Dropdown、Modal、Tooltip 等仍被现行页面引用，不能作为退役 UI 整目录删除。UPSTREAM.json 和许可文件保留组件来源。

styles/scoped.css 由 `npm run ui:build` 生成；不要直接改生成规则。composition.css/product.css 与主题负责共享语义，页面的连接和历史样式分别归到 connections/connections.css 与 local-app/history.css。共享视图操作由本地应用注入，未配置的契约不会发出网络请求。
