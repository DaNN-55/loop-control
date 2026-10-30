# 固定800px与字幕拖动修复

2026-10-30，PC端。

## 结果

- 四个节点普通主工作区固定800px。移除滚动位置到窗口高度的插值及滚动写样式，不再因上下滚动放大/缩小；保留滚动条边距补偿及外层标题滚动。手动“专注剪辑”仍是明确的全屏入口。
- 原生属性栏在较窄预览容器内原本变为绝对定位浮层，可能遮挡字幕命中区域；嵌入模式改为并排布局。
- 原生拖动原本只在字幕小命中框上接收移动/松开，捕获丢失时鼠标移到浮动工具栏便不提交位置。新增按当前pointerId绑定的窗口级补充接收；捕获正常时不重复处理，松开只提交一次，取消/窗口失焦/组件卸载均清理监听。
- 使用本仓库既有Vite适配层应用兼容修复，未修改已安装OpenChatCut源码、未添加依赖。未知SDK接点会明确拒绝，不静默跳过。

## 复现与验证

- 高度回归先失败再通过：`logs/height-red.log` → `logs/height-green.log`；模拟953px窗口和多次上下滚动，捕获旧插值行为，修复后固定800px。
- 真实一次性订单中，原生属性栏覆盖字幕时点击仍落入属性区域；并排修复后字幕可选中。临时pointer诊断记录显示移动/松开会落到`cc-capedit-btn`，原命中框不再收到事件；修复后实际位置改变。诊断代码已从源码移除，记录保存在`pointer-diagnostic.json`。
- 真实浏览器鼠标拖动45px向右、40px向上：原生水平偏移从0变为0.2459016393442623，垂直从-0.1变为-0.22307692307692306。一次撤销恢复0/-0.1，重做后保存、关闭、重开保持新位置。不是通过修改位置输入框代替拖动验证。
- 原生属性计算样式为`position:static`、宽260px，不覆盖预览。普通鼠标按住字幕拖动；双击仍进入文字编辑。
- 脚本、素材、检查交付页均实际测得800px；剪辑页在scrollTop 100/200的上下滚动中仍为800px。见`four-page-height.json`、`browser-verification.json`。

## 检查

- 15项定向测试通过：高度稳定、拖动连续接收、单次提交、指针隔离、正常捕获不重复、失焦取消、未知SDK失败及原生宿主回归。
- 170文件、1156项普通回归全部通过。
- TypeScript、`npm run build`、本机运行包准备与完整性检查通过；既有bundle体积告警保留。
- 源文件`git diff --check`通过。

隔离地址为`http://localhost:55370`，真实HTTP/数据库/原生编辑器，使用合成测试媒体。未操作真实订单、未提交生成或交付；临时服务、数据库和媒体已清理（`cleanup.json`）。日志及截图保留。

本轮没有重启日常5174。高度通过前端更新生效；当前已经打开的原生编辑器需先保存并返回生产单，再打开剪辑工作台以加载新版嵌入适配。不替用户关闭未保存的工程。未提交或推送代码。

## 截图

### 字幕拖动后的实际位置

![字幕拖动后的实际位置](/Users/dan/Programs/loop-control/docs/verification/workspace-height-caption-drag-20261030/screenshots/02-caption-dragged.jpg)

### 保存重开保留位置，属性栏与预览并排

![保存重开保留位置，属性栏与预览并排](/Users/dan/Programs/loop-control/docs/verification/workspace-height-caption-drag-20261030/screenshots/03-reopened-drag-position.jpg)

### 固定高度的主工作区

![固定高度的主工作区](/Users/dan/Programs/loop-control/docs/verification/workspace-height-caption-drag-20261030/screenshots/04-fixed-workspace.jpg)
