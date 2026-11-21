# 当前原型

- [设置布局三方案（2026-11-21）](settings-layouts-20261121.html)：A 侧栏紧凑行、B 顶栏双区、C 单页折叠。同一个 HTML 切换，覆盖当前五分组；支持骨架/示例文字、加载/空数据/错误、编辑与保存反馈。全部使用内存模拟，不访问业务 API。
- 直接用浏览器打开 HTML，或在仓库根目录运行 `python3 -m http.server 5186 --bind 127.0.0.1 --directory docs/prototypes` 后访问 `http://127.0.0.1:5186/settings-layouts-20261121.html`。刷新清空模拟修改，URL 保留方案和分组。
- [原型验收记录](../verification/settings-layouts-20261121/REPORT.md)。用户随后选定 A，正式设置已采用侧栏紧凑行，原型保留用于比较；见[正式设置验收](../verification/settings-compact-20261121/REPORT.md)。

## 已归档的历史原型

2026-11-16，经用户批准退役。原型源码、媒体和验证信息已完整归档并逐文件校验；原预览服务已关闭。

归档与恢复位置见 [产物清理记录](../archive/project-artifacts-cleanup-20261116/README.md)。

2026-11-17，脚本确认三栏 demo 已由正式页面取代，按用户要求删除其 HTML、截图和原型计划，停止 5189 预览服务并关闭专用测试浏览器。正式代码、生产数据及 [UI 验收记录](../verification/script-confirmation-ui-20261117/REPORT.md) 保留。需要恢复时，从提交 `778c8710` 还原 `docs/prototypes/script-confirmation-ui-20261117/`。
