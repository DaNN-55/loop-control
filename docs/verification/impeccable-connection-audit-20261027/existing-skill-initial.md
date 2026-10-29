# 现有 skill 首轮审查（detector 运行前固定）
依据：web-design-guidelines 最新规则、Dan UI visual contract。
范围：ConnectionWorkspace 的连接管理部分（133–247 行）、ConnectionTestButton、LocalConnectionsPanel、LocalMaintenancePanel 及其实际命中的样式。ExternalConnectionPicker 不计入本轮。

- B1 / P2 候选：ConnectionWorkspace.tsx:164–168、227：切换操作对象直接覆盖名称/说明并清空秘密草稿，没有未保存提示。需以非秘密合成草稿验证真实交互。
- B2 / P3：ConnectionWorkspace.tsx:227–240：表单字段和搜索缺少 name；搜索也未设置 autocomplete。原生控件已有嵌套 label 或 aria-label，不能报成缺失可访问名称。
- B3 / P3 候选：Dan UI 约定常规按钮与输入高度为 40px、正文13px；当前控件 CSS 为40px但按钮沿用全局规则。需读取实际计算样式后确认尺寸/字体差异，不先认定缺陷。
- B4 / P3 候选：ConnectionWorkspace.tsx:241–244：搜索筛选列表，但分组括号仍显示总数，未显示匹配数；零匹配已有空状态。需渲染后确认影响。

明确不机械报告：React 受控输入本身不是性能缺陷；26条连接不需要因为 map 就虚拟化；按钮40px不等于违反WCAG；中文不用机械套英文Title Case。
未进行本轮真实Provider验证、业务写入或页面修改。
