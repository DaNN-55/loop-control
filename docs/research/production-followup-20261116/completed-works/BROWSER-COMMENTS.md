# 浏览器批注调整

> 历史验收记录：其中专用只读剪辑页已按用户后续决定退役。当前入口、隔离副本与最新验收以 [STUDIO-COPY.md](STUDIO-COPY.md) 为准。


2026-11-16。按用户要求安装并采用 anthropics/skills 的 frontend-design；安装位置 `/Users/dan/.codex/skills/frontend-design`。保持现有蓝白设计和组件体系，优先内容、层次和密度。

## 改动

1. 生产单质量档去掉两处外置标题，未指定时内嵌显示“业务质量档”。保留 accessible name、低中高选项、显式保存和只读规则；创建表单保持原有字段标签。窄屏独立放置质量档，避免长标题挤成单字列。
2. 已采用记录直接显示请求概要及制作输入／实际提交／原脚本，完整参数用原生 details 展开。原素材在当前区域展开，不再打开参数弹窗。
3. 未采用为常驻分区，可按类型和真实状态筛选；点击图片、视频、声音或失败请求，在分区内展开媒体、错误和对应原文。包含原有全部记录，不再限制为三个缩略图，不新增历史或参数弹窗。筛选只影响查看，不调用业务写命令。
4. 保存配置去掉重复“画面”等小标题，压缩事实行距、内边距和区段间距；左侧成片保持、右侧独立滚动，窄屏改为上下布局。
5. 剪辑查看器收紧顶栏与播放器、按工程画幅呈现成片；优先显示镜头正文和已保存素材名，完整路径／参数及 SHA 可展开。时间线不展示空轨道，原始工程仍保留全部轨道。交付工程与最近工程读取、匹配条件和只读边界沿用原实现。
6. 补原生镜头 dialog 的显式 role 与打开时 aria-modal，兼容外层 EpisodeDetailDrawer 的 Escape 判断，关闭时移除 aria-modal。保留浏览器原生取消和焦点行为。

## 为什么旧剪辑页看起来不合适

旧实现直接使用工程 item.name 和 src，已匹配素材仍可能携带旧的“待匹配画面”名称，长路径又占据属性区。播放器为固定高度的宽栏，竖屏画面两侧留下大片背景。此次采用成片＋片段属性＋完整时间线；没有挂载原生编辑器或增加写接口。

## 验证

- 三条新增行为回归先失败，再实现通过：内嵌筛选与失败记录、质量档占位、镜头名称／文件名与成片定位。原有三种提示词区分与只读音频播放继续通过。
- 9 文件相关测试原 67 项：首次仅旧按钮名“预览”预期失败，改为“展开原素材”后该文件 39 项通过。其他 8 文件 28 项通过。之后新增 Escape 回归，使用真实 EpisodeDetailDrawer，完成态与 dialog 2 文件合计 5 项通过；合计覆盖当前 68 项相关回归，分批执行。额外 useDialogFocus 8 项通过。
- 类型检查早期通过。最后 `npm run check` 失败，7 处错误均在并行新增的 workspaceBatchAdoption.integration.test.ts、workspaceBatchAdoption.ts 和 workspaceBatchPreparation.test.ts：隐式 any、尚未导出的函数、参数数量及尚未存在模块。保留这些其他任务的工作，不把最终全仓检查记为通过。
- 真实 Chrome：复现原始弹窗／标题，验证候选就地展开、图片筛选、原生菜单 Escape、紧凑保存配置、左侧预览保持。
- 应用内 Chromium：真实视频片段定位到 3.066666s，返回保留镜头；320px 与 390px 页面宽度等于 viewport，窄屏抽屉 296px／366px；修复长标题挤窄，版本 label 48px；桌面版本控件最终 panel clientWidth=scrollWidth=1232，无内部横向溢出。重跑 Escape 后 episodeStillOpen=true、drawerCount=0。最终浏览器 error 日志为空。
- 改动相对本轮开始文件快照核对；未提交、未推送、未改共享 SDK、数据库或生成接口。

## 执行中修正

NativeSelect 拦截原生菜单并将 Popover 放在 body 中，在 native modal dialog 中无法实际操作；本轮两个筛选直接用 native select，新增默认输入未被拦截的回归，再验证真实点击。Escape 首次回归使用了错误外层夹具，后改为实际 owning component 复现并修复，未用额外键盘拦截掩盖问题。

## 证据与盲区

证据目录：`/Users/dan/.codex/visualizations/2026/11/16/01a1e3e1-f724-71a1-b7d7-6e7132f2b24a/browser-comments/`。包含 before 文件快照、changes.diff、logs、drawer-desktop.jpg、project-desktop.jpg、drawer-mobile.jpg 与 project-mobile.jpg。

本轮未重复全套单元测试、构建、数据库指纹比对或 Safari／Firefox 验证。自动化测试中的 JSDOM 有原生 search 标签与既有媒体／act 警告，未压制；真实 Chromium 错误日志为空。失败请求和组合状态筛选由组件回归覆盖，真实目标单只有两条未采用画面记录。
